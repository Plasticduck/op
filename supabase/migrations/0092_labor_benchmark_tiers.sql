-- Editable, per-site earned-labor-hours benchmark for the Labor Dashboard.
-- Maps a forecast-cars band to a maximum benchmark labor-hours value. A row with
-- location_id = null is the account default; a row with a location_id overrides
-- the default for that site. max_cars = null means "and up".
create table if not exists public.labor_benchmark_tiers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  min_cars integer not null,
  max_cars integer,
  max_hours numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists labor_benchmark_tiers_lookup
  on public.labor_benchmark_tiers (account_id, location_id, min_cars);

alter table public.labor_benchmark_tiers enable row level security;

drop policy if exists lbt_select on public.labor_benchmark_tiers;
create policy lbt_select on public.labor_benchmark_tiers
  for select using (account_id = auth_account_id());
drop policy if exists lbt_write on public.labor_benchmark_tiers;
create policy lbt_write on public.labor_benchmark_tiers
  for all using (account_id = auth_account_id() and auth_is_manager_plus())
  with check (account_id = auth_account_id() and auth_is_manager_plus());

-- Seed the Mighty Wash account default (the exterior-sites table from the mockup).
insert into public.labor_benchmark_tiers (account_id, location_id, min_cars, max_cars, max_hours)
select '54f3e299-1f61-4ed2-9921-3d02160b72e6'::uuid, null, t.min_cars, t.max_cars, t.max_hours
from (values
  (0, 250, 42), (251, 300, 47), (301, 350, 52), (351, 400, 57),
  (401, 450, 58), (451, 500, 63), (501, 550, 69), (551, null, 75)
) as t(min_cars, max_cars, max_hours)
where not exists (
  select 1 from public.labor_benchmark_tiers
  where account_id = '54f3e299-1f61-4ed2-9921-3d02160b72e6' and location_id is null
);
