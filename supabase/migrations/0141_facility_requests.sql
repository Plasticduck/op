-- Facilities service board: internal requests-for-service tracker (distinct from
-- the MaintainX Work Orders). Anyone in the account can submit a request; the
-- facilities team (manager+/technician) works it and posts progress updates.
create table if not exists public.facility_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  title text not null,
  description text,
  category text not null default 'General',
  priority text not null default 'normal',
  status text not null default 'new',
  requested_by uuid references public.users(id) on delete set null,
  requested_by_name text,
  assigned_to uuid references public.users(id) on delete set null,
  assigned_to_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.facility_requests enable row level security;
create policy facility_requests_select on public.facility_requests for select
  using (account_id = auth_account_id() and (location_id is null or auth_has_location(location_id)));
create policy facility_requests_insert on public.facility_requests for insert
  with check (account_id = auth_account_id());
create policy facility_requests_update on public.facility_requests for update
  using (account_id = auth_account_id() and auth_is_manager_plus());
create policy facility_requests_delete on public.facility_requests for delete
  using (account_id = auth_account_id() and auth_is_manager_plus());
create index if not exists facility_requests_account_status_idx on public.facility_requests(account_id, status);

create table if not exists public.facility_request_updates (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.facility_requests(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  author_id uuid references public.users(id) on delete set null,
  author_name text,
  note text not null,
  status text,
  created_at timestamptz not null default now()
);
alter table public.facility_request_updates enable row level security;
create policy fru_select on public.facility_request_updates for select
  using (account_id = auth_account_id());
create policy fru_insert on public.facility_request_updates for insert
  with check (account_id = auth_account_id());
create index if not exists fru_request_idx on public.facility_request_updates(request_id, created_at);
