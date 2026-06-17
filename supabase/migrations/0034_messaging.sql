-- 0034_messaging.sql
-- Team messaging: 1:1 DMs + per-site group chats (GroupMe-style).
--
-- conversations -- a chat room. kind = 'dm' (two users), 'group' (ad-hoc), or
--                  'site' (auto-created per location, holds the location_id).
-- conversation_members -- who's in the room + last_read_at for unread counts.
-- messages -- the actual chat lines.
--
-- Auto-seeding: every existing location gets one 'site' conversation; every
-- user gets added to the site rooms they can see (owners see all sites in their
-- account, others see only sites listed in their users.location_ids array).
-- A trigger keeps this in sync as locations and users change.

create table public.conversations (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  kind        text not null check (kind in ('dm','group','site')),
  location_id uuid references public.locations(id) on delete cascade,
  name        text,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  last_message_at timestamptz
);
create index on public.conversations (account_id, kind);
create unique index conversations_one_per_site on public.conversations (location_id) where kind = 'site';

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index on public.conversation_members (user_id);

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.users(id) on delete cascade,
  body            text not null,
  edited_at       timestamptz,
  created_at      timestamptz not null default now()
);
create index on public.messages (conversation_id, created_at);

-- ---- Security-definer membership check ------------------------------------
-- Using exists inside a policy on conversation_members against itself causes
-- infinite recursion. Wrap the lookup in a SECURITY DEFINER function so RLS
-- on conversation_members doesn't reapply during the check.

create or replace function public.auth_in_conversation(conv uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = conv and user_id = auth.uid()
  )
$$;

-- ---- RLS ------------------------------------------------------------------

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

create policy conversations_select on public.conversations for select
  using (account_id = public.auth_account_id() and public.auth_in_conversation(id));
create policy conversations_insert on public.conversations for insert
  with check (account_id = public.auth_account_id());
create policy conversations_update on public.conversations for update
  using (public.auth_in_conversation(id))
  with check (account_id = public.auth_account_id());

create policy conv_members_select on public.conversation_members for select
  using (public.auth_in_conversation(conversation_id));
-- Insert is performed by triggers (SECURITY DEFINER), by the owner of a fresh
-- DM, or by an existing member adding someone to a group.
create policy conv_members_insert on public.conversation_members for insert
  with check (
    -- Adding myself when the conversation has no members yet (the creator).
    user_id = auth.uid()
    or public.auth_in_conversation(conversation_id)
  );
create policy conv_members_update on public.conversation_members for update
  using (user_id = auth.uid())  -- only my own last_read_at, etc.
  with check (user_id = auth.uid());
create policy conv_members_delete on public.conversation_members for delete
  using (user_id = auth.uid() or public.auth_in_conversation(conversation_id));

create policy messages_select on public.messages for select
  using (public.auth_in_conversation(conversation_id));
create policy messages_insert on public.messages for insert
  with check (sender_id = auth.uid() and public.auth_in_conversation(conversation_id));
create policy messages_update on public.messages for update
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());
create policy messages_delete on public.messages for delete
  using (sender_id = auth.uid());

-- ---- last_message_at bookkeeping ------------------------------------------

create or replace function public.bump_conversation_last_message()
returns trigger
language plpgsql
as $$
begin
  update public.conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_bump_last
after insert on public.messages
for each row execute function public.bump_conversation_last_message();

-- ---- Per-site groups: auto-create + membership sync -----------------------

-- Who should be in the 'site' chat for a given location?
-- - All owners of the same account (owners see every site)
-- - Any user whose users.location_ids array contains this location
create or replace function public.users_for_site(loc uuid)
returns table (user_id uuid)
language sql
stable
as $$
  select u.id
  from public.users u
  join public.locations l on l.id = loc
  where u.account_id = l.account_id
    and (u.role = 'owner' or loc = any(u.location_ids))
$$;

-- When a location is inserted: create its site chat + seed members.
create or replace function public.create_site_chat_for_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_id uuid;
begin
  insert into public.conversations (account_id, kind, location_id, name)
  values (new.account_id, 'site', new.id, new.name || ' Team')
  on conflict (location_id) where kind = 'site' do update set name = excluded.name
  returning id into conv_id;

  if conv_id is null then
    select id into conv_id from public.conversations where location_id = new.id and kind = 'site';
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  select conv_id, u.user_id from public.users_for_site(new.id) u
  on conflict do nothing;

  return new;
end;
$$;

create trigger locations_create_site_chat
after insert on public.locations
for each row execute function public.create_site_chat_for_location();

-- When a user's role or location_ids changes, refresh their site-chat memberships.
create or replace function public.sync_user_site_memberships()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Remove the user from site chats they no longer belong to.
  delete from public.conversation_members cm
   using public.conversations c
   where cm.conversation_id = c.id
     and c.kind = 'site'
     and cm.user_id = new.id
     and c.account_id = new.account_id
     and not (
       new.role = 'owner'
       or c.location_id = any(new.location_ids)
     );

  -- Add them to the site chats they should be in but aren't.
  insert into public.conversation_members (conversation_id, user_id)
  select c.id, new.id
    from public.conversations c
   where c.kind = 'site'
     and c.account_id = new.account_id
     and (new.role = 'owner' or c.location_id = any(new.location_ids))
  on conflict do nothing;

  return new;
end;
$$;

create trigger users_sync_site_memberships
after insert or update of role, location_ids on public.users
for each row execute function public.sync_user_site_memberships();

-- ---- Backfill for existing data -------------------------------------------

-- Create site chats for every existing location.
insert into public.conversations (account_id, kind, location_id, name)
select l.account_id, 'site', l.id, l.name || ' Team'
from public.locations l
left join public.conversations c
  on c.location_id = l.id and c.kind = 'site'
where c.id is null;

-- Seed members for every site chat.
insert into public.conversation_members (conversation_id, user_id)
select c.id, u.id
from public.conversations c
join public.locations l on l.id = c.location_id
join public.users u on u.account_id = l.account_id
where c.kind = 'site'
  and (u.role = 'owner' or l.id = any(u.location_ids))
on conflict do nothing;

-- ---- Realtime --------------------------------------------------------------
-- Push to the existing supabase_realtime publication so the client can
-- subscribe to new messages without polling.
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversation_members;
