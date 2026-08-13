-- Slack-style Messages: emoji reactions, threads, pins, channel topics.
-- Reactions and pins are separate tables (not columns on messages) because the
-- messages UPDATE policy is author-only; any member must be able to react/pin.

-- Emoji reactions -----------------------------------------------------------
create table if not exists message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);
create index if not exists message_reactions_msg_idx on message_reactions(message_id);
alter table message_reactions enable row level security;
create policy message_reactions_select on message_reactions
  for select using (auth_in_conversation(conversation_id));
create policy message_reactions_insert on message_reactions
  for insert with check (user_id = auth.uid() and auth_in_conversation(conversation_id));
create policy message_reactions_delete on message_reactions
  for delete using (user_id = auth.uid());

-- Pins (any member of the conversation can pin/unpin) ------------------------
create table if not exists message_pins (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  pinned_by uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (message_id)
);
create index if not exists message_pins_conv_idx on message_pins(conversation_id);
alter table message_pins enable row level security;
create policy message_pins_select on message_pins
  for select using (auth_in_conversation(conversation_id));
create policy message_pins_insert on message_pins
  for insert with check (pinned_by = auth.uid() and auth_in_conversation(conversation_id));
create policy message_pins_delete on message_pins
  for delete using (auth_in_conversation(conversation_id));

-- Threaded replies: a reply points at its parent message --------------------
alter table messages add column if not exists parent_id uuid references messages(id) on delete cascade;
create index if not exists messages_parent_idx on messages(parent_id);

-- Channel topic/description --------------------------------------------------
alter table conversations add column if not exists topic text;

-- Realtime for the new tables ------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='message_reactions') then
    alter publication supabase_realtime add table message_reactions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='message_pins') then
    alter publication supabase_realtime add table message_pins;
  end if;
end $$;

-- Original filename for non-image attachments (upload path is a uuid).
alter table messages add column if not exists attachment_name text;
