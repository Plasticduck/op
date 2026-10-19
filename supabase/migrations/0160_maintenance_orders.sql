-- Maintenance (equipment) orders — mirrors signage_requests: one row per order,
-- a simple status workflow, and own-orders visibility. Catalog is a placeholder
-- for now (free-text item); the flow (place order -> admin tracker -> status) is
-- real. location_id is nullable (null = all sites / unspecified).
create table if not exists public.maintenance_orders (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  location_id        uuid references public.locations(id) on delete set null,
  requested_by       uuid references public.users(id) on delete set null,
  requester_name     text,
  item               text not null,
  quantity           numeric not null default 1,
  notes              text,
  status             text not null default 'ordered',
  tracking_number    text,
  status_updated_at  timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists maintenance_orders_acct_idx
  on public.maintenance_orders (account_id, created_at desc);

alter table public.maintenance_orders enable row level security;

-- A user sees only the orders they placed; kevan@washlyfe.com (the single admin
-- while this is pre-launch) sees every order in the account for the tracker.
create policy maintenance_orders_select on public.maintenance_orders
  for select using (
    account_id = auth_account_id()
    and (
      requested_by = auth.uid()
      or lower(coalesce(auth.jwt() ->> 'email', '')) = 'kevan@washlyfe.com'
    )
  );
create policy maintenance_orders_insert on public.maintenance_orders
  for insert with check (
    account_id = auth_account_id()
    and (location_id is null or auth_has_location(location_id))
  );
create policy maintenance_orders_update on public.maintenance_orders
  for update using (account_id = auth_account_id() and auth_is_manager_plus())
  with check (account_id = auth_account_id() and auth_is_manager_plus());
create policy maintenance_orders_delete on public.maintenance_orders
  for delete using (account_id = auth_account_id() and auth_is_manager_plus());
