-- Maps FlexWash car wash IDs to Operator site numbers. FlexWash runs a subset of
-- sites (MW17, MW18, soon MW30); their daily numbers are archived into
-- site_performance_days keyed by these site numbers, so they line up with the
-- SiteWatch sites in the History view and region grouping. Add a new site by
-- inserting a row here.
create table if not exists public.flexwash_sites (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  site_number int not null,
  car_wash_id text not null,
  name        text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (account_id, car_wash_id)
);
alter table public.flexwash_sites enable row level security;
create policy flexwash_sites_select on public.flexwash_sites
  for select using (account_id = auth_account_id() and auth_is_manager_plus());

-- Seed the known FlexWash sites for the site-performance-enabled account.
insert into public.flexwash_sites (account_id, site_number, car_wash_id, name)
select id, 17, '352', 'Mighty Wash #17' from public.accounts where site_performance_enabled
on conflict (account_id, car_wash_id) do nothing;
insert into public.flexwash_sites (account_id, site_number, car_wash_id, name)
select id, 18, '350', 'Mighty Wash #18' from public.accounts where site_performance_enabled
on conflict (account_id, car_wash_id) do nothing;
