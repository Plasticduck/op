-- Work Request portal: a shareable form (public, no login) where staff submit
-- issues that land as pending requests. A manager reviews and approves a request
-- into a work order, or declines it. Public reads/writes go through the
-- work-request-portal edge function (service role), so no anon RLS is needed here.

create table if not exists public.work_request_portals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  name text not null default 'Work Requests',
  location_id uuid references public.locations(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists work_request_portals_account_idx on public.work_request_portals (account_id);
alter table public.work_request_portals enable row level security;
drop policy if exists work_request_portals_all on public.work_request_portals;
create policy work_request_portals_all on public.work_request_portals for all
  using (account_id = auth_account_id() and auth_is_manager_plus())
  with check (account_id = auth_account_id() and auth_is_manager_plus());

create table if not exists public.work_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  title text not null,
  description text,
  priority text not null default 'none',
  equipment_id uuid references public.equipment(id) on delete set null,
  requester_name text,
  requester_email text,
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  work_order_id uuid references public.work_orders(id) on delete set null,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists work_requests_account_status_idx on public.work_requests (account_id, status, created_at desc);
alter table public.work_requests enable row level security;

drop policy if exists work_requests_select on public.work_requests;
drop policy if exists work_requests_insert on public.work_requests;
drop policy if exists work_requests_write on public.work_requests;
-- Managers (and technicians) review requests for their sites.
create policy work_requests_select on public.work_requests for select
  using (account_id = auth_account_id() and auth_has_location(location_id));
-- Any logged-in account member can file one internally.
create policy work_requests_insert on public.work_requests for insert
  with check (account_id = auth_account_id() and auth_has_location(location_id));
create policy work_requests_write on public.work_requests for all
  using (account_id = auth_account_id() and auth_is_manager_plus())
  with check (account_id = auth_account_id() and auth_is_manager_plus());
