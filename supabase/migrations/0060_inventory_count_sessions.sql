-- 0060_inventory_count_sessions.sql
-- "New Count": a saved, resumable inventory count for a site + division. The
-- session is the batch; one line per catalog item holds the counted quantity.
-- Kept separate from inventory_counts (the quick single-item log) so a whole
-- count can be filled on-device, saved, and reopened later.

create table if not exists public.inventory_count_sessions (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  location_id     uuid not null references public.locations(id) on delete cascade,
  division        text,
  note            text,
  created_by      uuid references public.users(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists inventory_count_sessions_acct_idx
  on public.inventory_count_sessions (account_id, created_at desc);

create table if not exists public.inventory_count_lines (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.inventory_count_sessions(id) on delete cascade,
  item_id    uuid not null references public.inventory_items(id) on delete cascade,
  quantity   numeric,
  updated_at timestamptz not null default now(),
  unique (session_id, item_id)
);

alter table public.inventory_count_sessions enable row level security;
alter table public.inventory_count_lines enable row level security;

create policy inventory_count_sessions_select on public.inventory_count_sessions
  for select using (account_id = auth_account_id());
create policy inventory_count_sessions_insert on public.inventory_count_sessions
  for insert with check (account_id = auth_account_id() and auth_is_manager_plus());
create policy inventory_count_sessions_update on public.inventory_count_sessions
  for update using (account_id = auth_account_id() and auth_is_manager_plus())
  with check (account_id = auth_account_id() and auth_is_manager_plus());
create policy inventory_count_sessions_delete on public.inventory_count_sessions
  for delete using (account_id = auth_account_id() and auth_is_manager_plus());

create policy inventory_count_lines_select on public.inventory_count_lines
  for select using (exists (
    select 1 from public.inventory_count_sessions s
    where s.id = session_id and s.account_id = auth_account_id()
  ));
create policy inventory_count_lines_write on public.inventory_count_lines
  for all using (exists (
    select 1 from public.inventory_count_sessions s
    where s.id = session_id and s.account_id = auth_account_id() and auth_is_manager_plus()
  ))
  with check (exists (
    select 1 from public.inventory_count_sessions s
    where s.id = session_id and s.account_id = auth_account_id() and auth_is_manager_plus()
  ));
