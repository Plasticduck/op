-- QuickBooks Enterprise (Desktop) sync, first piece: approved invoices go
-- into QuickBooks as bills (2026-10-30, Kevan only for now).
--
-- QuickBooks Desktop has no cloud API. Intuit's Web Connector, installed on
-- the PC that has QuickBooks, checks in with the `qbwc` edge function on a
-- schedule: it logs in with the account's Web Connector user name and
-- password, asks for work, runs it against the company file, and posts the
-- results back. Work waits here until then, so the PC doesn't have to be on
-- when an invoice is sent.
--
--   qb_connections  one per account: the Web Connector login (password hashed
--                   with bcrypt, shown once), what it last reported, and the
--                   current session.
--   qb_list_items   the vendors, accounts and classes in QuickBooks, refreshed
--                   by the Web Connector, so bills can be checked before they
--                   go and sent by QuickBooks' own ids.
--   qb_jobs         one bill per approved invoice: queued -> sent -> posted, or
--                   failed (QuickBooks said why), or unknown (sent but no answer
--                   came back; check QuickBooks before sending it again). An
--                   invoice can only have one live job, so it can't be entered
--                   twice. A posted bill marks the invoice exported.

create table if not exists public.qb_connections (
  account_id          uuid primary key references public.accounts(id) on delete cascade,
  username            text not null unique,
  password_hash       text,
  -- Ids the .qwc file carries; QuickBooks remembers the app by them.
  owner_id            uuid not null default gen_random_uuid(),
  file_id             uuid not null default gen_random_uuid(),
  company_file        text,
  qbxml_version       text,
  last_contact_at     timestamptz,
  last_error          text,
  lists_requested_at  timestamptz,
  lists_synced_at     timestamptz,
  session_ticket      text,
  session_stage       text check (session_stage in ('lists', 'bills')),
  session_started_at  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references public.users(id) on delete set null default auth.uid()
);
create trigger qb_connections_touch before update on public.qb_connections
  for each row execute function public.it_touch();

create table if not exists public.qb_list_items (
  account_id     uuid not null references public.accounts(id) on delete cascade,
  list_type      text not null check (list_type in ('vendor', 'account', 'class')),
  list_id        text not null,
  name           text not null,
  full_name      text not null,
  account_number text,
  account_type   text,
  is_active      boolean not null default true,
  synced_at      timestamptz not null default now(),
  primary key (account_id, list_type, list_id)
);

create table if not exists public.qb_jobs (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  kind        text not null default 'bill' check (kind in ('bill')),
  invoice_id  uuid references public.ops_invoices(id) on delete set null,
  -- The bill as it goes to QuickBooks: vendor, dates, bill number, memo and
  -- lines, each with QuickBooks' ListID and the name it was matched by.
  payload     jsonb not null,
  status      text not null default 'queued'
              check (status in ('queued', 'sent', 'posted', 'failed', 'unknown', 'canceled')),
  ticket      text,
  attempts    integer not null default 0,
  qb_txn_id   text,
  error       text,
  sent_at     timestamptz,
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.users(id) on delete set null default auth.uid()
);
create index if not exists qb_jobs_account_idx on public.qb_jobs (account_id, created_at desc);
create unique index if not exists qb_jobs_live_invoice on public.qb_jobs (invoice_id)
  where status in ('queued', 'sent', 'posted', 'unknown');
create trigger qb_jobs_touch before update on public.qb_jobs
  for each row execute function public.it_touch();

-- People may queue, cancel and retry, and say an unanswered bill did go in
-- (they found it in QuickBooks); everything else is the Web Connector's
-- (service role, no auth.uid()).
create or replace function public.qb_jobs_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'queued' or new.qb_txn_id is not null or new.ticket is not null then
      raise exception 'New bills start queued';
    end if;
    if not exists (select 1 from public.ops_invoices i
                    where i.id = new.invoice_id and i.account_id = new.account_id and i.status = 'approved') then
      raise exception 'Only approved invoices that haven''t been exported can go to QuickBooks';
    end if;
    return new;
  end if;
  if new.payload is distinct from old.payload or new.invoice_id is distinct from old.invoice_id
     or new.account_id is distinct from old.account_id or new.qb_txn_id is distinct from old.qb_txn_id then
    raise exception 'Only the Web Connector changes a sent bill';
  end if;
  if not ((old.status = 'queued' and new.status = 'canceled')
       or (old.status in ('failed', 'unknown') and new.status in ('queued', 'canceled'))
       or (old.status = 'unknown' and new.status = 'posted')) then
    raise exception 'That bill can''t be changed now';
  end if;
  if new.status = 'posted' then
    new.error := null;
    new.done_at := now();
  end if;
  if new.status = 'queued' then
    new.error := null;
    new.ticket := null;
  end if;
  return new;
end $$;
create trigger qb_jobs_guard_trg before insert or update on public.qb_jobs
  for each row execute function public.qb_jobs_guard();

-- ---- Access: Admins of the account ------------------------------------------------
alter table public.qb_connections enable row level security;
create policy qb_connections_select on public.qb_connections
  for select using (account_id = auth_account_id() and auth_role() = 'owner');
-- The password hash and the session never leave the server.
revoke all on public.qb_connections from anon, authenticated;
grant select (account_id, username, owner_id, file_id, company_file, qbxml_version, last_contact_at, last_error,
              lists_requested_at, lists_synced_at, created_at, updated_at)
  on public.qb_connections to authenticated;

alter table public.qb_list_items enable row level security;
create policy qb_list_items_select on public.qb_list_items
  for select using (account_id = auth_account_id() and auth_role() = 'owner');
revoke insert, update, delete on public.qb_list_items from anon, authenticated;

alter table public.qb_jobs enable row level security;
create policy qb_jobs_select on public.qb_jobs
  for select using (account_id = auth_account_id() and auth_role() = 'owner');
create policy qb_jobs_insert on public.qb_jobs
  for insert with check (account_id = auth_account_id() and auth_role() = 'owner');
create policy qb_jobs_update on public.qb_jobs
  for update using (account_id = auth_account_id() and auth_role() = 'owner')
  with check (account_id = auth_account_id() and auth_role() = 'owner');
revoke delete on public.qb_jobs from anon, authenticated;

-- ---- The Web Connector login --------------------------------------------------------
-- A new password for the account's Web Connector, shown once (only the hash is
-- kept). Sets up the connection the first time. Admins only.
create or replace function public.qb_new_password()
returns table (username text, password text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  acct  uuid := auth_account_id();
  uname text;
  pw    text;
  n     integer := 0;
begin
  if acct is null or auth_role() is distinct from 'owner' then
    raise exception 'Only an admin can set up QuickBooks' using errcode = '42501';
  end if;
  select c.username into uname from public.qb_connections c where c.account_id = acct;
  if uname is null then
    select left(lower(regexp_replace(a.name, '[^a-zA-Z0-9]', '', 'g')), 16) || '-qb' into uname
      from public.accounts a where a.id = acct;
    while exists (select 1 from public.qb_connections c where c.username = uname) loop
      n := n + 1;
      uname := regexp_replace(uname, '[0-9]*-qb$', '') || n::text || '-qb';
    end loop;
  end if;
  -- 20 characters people can type: no 0/O or 1/l/I.
  select string_agg(substr('abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                           1 + (get_byte(b, i) % 55), 1), '')
    into pw
    from (select gen_random_bytes(20) as b) r, generate_series(0, 19) as i;
  insert into public.qb_connections (account_id, username, password_hash)
  values (acct, uname, crypt(pw, gen_salt('bf')))
  on conflict (account_id) do update set password_hash = excluded.password_hash,
    session_ticket = null, session_stage = null;
  return query select uname, pw;
end $$;
revoke execute on function public.qb_new_password() from public, anon;
grant execute on function public.qb_new_password() to authenticated;

-- Ask for fresh lists at the next check-in. Admins only.
create or replace function public.qb_request_lists()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth_role() is distinct from 'owner' then
    raise exception 'Only an admin can do this' using errcode = '42501';
  end if;
  update public.qb_connections set lists_requested_at = now() where account_id = auth_account_id();
end $$;
revoke execute on function public.qb_request_lists() from public, anon;
grant execute on function public.qb_request_lists() to authenticated;

-- For the qbwc function only: which account a Web Connector login belongs to.
create or replace function public.qb_check_login(p_username text, p_password text)
returns uuid language sql security definer set search_path = public, extensions as $$
  select c.account_id from public.qb_connections c
   where c.username = lower(btrim(p_username)) and c.password_hash is not null
     and c.password_hash = crypt(p_password, c.password_hash)
$$;
revoke execute on function public.qb_check_login(text, text) from public, anon, authenticated;
grant execute on function public.qb_check_login(text, text) to service_role;

-- For the qbwc function only: replace one cached list with what QuickBooks sent.
create or replace function public.qb_replace_list(p_account uuid, p_type text, p_items jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  delete from public.qb_list_items where account_id = p_account and list_type = p_type;
  insert into public.qb_list_items (account_id, list_type, list_id, name, full_name, account_number, account_type, is_active)
  select p_account, p_type, x ->> 'list_id', x ->> 'name', coalesce(x ->> 'full_name', x ->> 'name'),
         nullif(x ->> 'account_number', ''), nullif(x ->> 'account_type', ''), coalesce((x ->> 'is_active')::boolean, true)
    from jsonb_array_elements(p_items) x
   where coalesce(x ->> 'list_id', '') <> '' and coalesce(x ->> 'name', '') <> ''
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.qb_replace_list(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.qb_replace_list(uuid, text, jsonb) to service_role;
