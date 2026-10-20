-- Public "view published schedules" portal: a hidden, link-only page (no login)
-- that shows an account's PUBLISHED schedules per site. One portal per account;
-- the unguessable token is in the URL. The public page reads through a service-
-- role edge function (public-schedules), so no anon RLS is exposed.
create table if not exists public.schedule_portals (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  token      uuid not null default gen_random_uuid() unique,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists schedule_portals_account_idx on public.schedule_portals (account_id);

alter table public.schedule_portals enable row level security;
-- Managers+ manage their own account's portal (create it / read the link).
drop policy if exists schedule_portals_all on public.schedule_portals;
create policy schedule_portals_all on public.schedule_portals for all
  using (account_id = public.auth_account_id() and public.auth_is_manager_plus())
  with check (account_id = public.auth_account_id() and public.auth_is_manager_plus());
