-- Monthly car counts for sites that have no daily car source (2026-10-23).
--
-- site_performance_days is daily and fed by the dashboard sync, which writes
-- cars = null for a site the dashboard has no POS data for (MW33). The only
-- record of those sites' cars is the monthly "Update Car Counts" sheet, so its
-- totals are stored here as whole months. Site Performance History counts a
-- month from this table only when the range covers the whole month and the
-- dashboard has no cars for the site in that range. Nothing syncs into it.
create table if not exists public.site_performance_months (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  site_number int not null,
  site        text not null,            -- e.g. "MightyWash 033"
  month       date not null check (extract(day from month) = 1),
  cars        numeric not null,
  source      text,                     -- where the number came from
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (account_id, site_number, month)
);

alter table public.site_performance_months enable row level security;

-- Same read access as site_performance_days; writes are service-role only.
create policy site_performance_months_select on public.site_performance_months
  for select using (account_id = auth_account_id() and auth_is_manager_plus());

-- MW33 from the "Update Car Counts.xlsx" 2026 tab (kjowers@mighty-wash.com).
-- Jan-May are 0 on the sheet (before the site opened) and Oct-Dec are blank,
-- so only the months with real counts are loaded.
insert into public.site_performance_months (account_id, site_number, site, month, cars, source)
select '54f3e299-1f61-4ed2-9921-3d02160b72e6', 33, 'MightyWash 033', v.m::date, v.cars, 'Update Car Counts.xlsx'
from (values ('2026-06-01', 3013), ('2026-07-01', 3043), ('2026-08-01', 2562), ('2026-09-01', 1776)) as v(m, cars)
on conflict (account_id, site_number, month) do update set cars = excluded.cars, source = excluded.source, updated_at = now();
