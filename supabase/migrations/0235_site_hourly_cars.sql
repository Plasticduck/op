-- Cars washed per site per HOUR of the day (site-local time), DRB and FlexWash
-- kept as separate rows (2026-11-13). Filled by sync-site-hourly from 2026-01-01
-- (counting in _shared/hourly_cars.ts):
--   drb  : SiteWatch Carwashes category lines (net of refunds) by the hour on the
--          ticket; per site and day these equal the official daily car count.
--          test_cars = the "Test Car" washes inside cars.
--   flex : FlexWash single + member washes by hour, from each site's cutover day,
--          moved into the site's real timezone.
-- A FlexWash site keeps a few stray DRB washes after cutover; both count, as in
-- site_daily_totals.
create table if not exists public.site_hourly_cars (
  account_id  uuid not null references public.accounts(id) on delete cascade,
  date        date not null,
  site_number int not null,
  hour        smallint not null check (hour between 0 and 23),
  source      text not null check (source in ('drb', 'flex')),
  cars        numeric not null default 0,
  test_cars   numeric not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (account_id, date, site_number, hour, source)
);
create index if not exists site_hourly_cars_site_date on public.site_hourly_cars (account_id, site_number, date);

alter table public.site_hourly_cars enable row level security;

-- Same read access as site_daily_metrics; writes are service-role only.
create policy site_hourly_cars_select on public.site_hourly_cars
  for select using (account_id = auth_account_id() and auth_is_manager_plus());

-- Cars per site, date and hour the way Site Performance counts them: DRB + FlexWash,
-- DRB test cars left out. Runs as the caller, so the table's RLS applies.
create or replace view public.site_hourly_car_counts with (security_invoker = true) as
  select account_id, date, site_number, hour,
    sum(cars - test_cars) as cars,
    sum(case when source = 'drb' then cars - test_cars else 0 end) as drb_cars,
    sum(case when source = 'flex' then cars else 0 end) as flex_cars,
    sum(test_cars) as test_cars
  from public.site_hourly_cars
  group by account_id, date, site_number, hour;

grant select on public.site_hourly_car_counts to authenticated;

-- Hourly cars over a date range, shaped for Operator AI's hourly_cars tool:
--   p_view 'hours'        : each date and hour
--   p_view 'by_hour'      : each hour of day, total over the range and the average
--                           per day the site(s) had cars
--   p_view 'typical_week' : each weekday (ISO, 1 = Monday) and hour, averaged over
--                           the days of that weekday the site(s) had cars
-- p_sites limits the sites (null = all the caller can read); p_combine adds the
-- sites together (site_number comes back null).
create or replace function public.site_hourly_summary(
  p_start date, p_end date, p_sites int[] default null, p_view text default 'hours', p_combine boolean default true
)
returns table (site_number int, date date, weekday int, hour int, cars numeric, days int, avg_cars numeric)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  return query
  with base as (
    select case when p_combine then null else c.site_number end as sn, c.date as d, c.hour::int as h, sum(c.cars) as n
    from public.site_hourly_car_counts c
    where c.date between p_start and p_end and (p_sites is null or c.site_number = any(p_sites))
    group by 1, 2, 3
  ),
  open_days as (
    select b.sn, b.d from base b group by b.sn, b.d having sum(b.n) <> 0
  )
  select x.sn, x.d, x.wd, x.h, x.n, x.days, x.avg_n
  from (
    select b.sn, b.d, extract(isodow from b.d)::int as wd, b.h, b.n, 1 as days, b.n as avg_n
    from base b where p_view = 'hours'
    union all
    select b.sn, null::date, null::int, b.h, sum(b.n),
      (select count(*)::int from open_days o where o.sn is not distinct from b.sn),
      round(sum(b.n) / nullif((select count(*) from open_days o where o.sn is not distinct from b.sn), 0), 1)
    from base b where p_view = 'by_hour'
    group by b.sn, b.h
    union all
    select b.sn, null::date, extract(isodow from b.d)::int, b.h, sum(b.n),
      (select count(*)::int from open_days o where o.sn is not distinct from b.sn and extract(isodow from o.d) = extract(isodow from b.d)),
      round(sum(b.n) / nullif((select count(*) from open_days o where o.sn is not distinct from b.sn and extract(isodow from o.d) = extract(isodow from b.d)), 0), 1)
    from base b where p_view = 'typical_week'
    group by b.sn, extract(isodow from b.d), b.h
  ) x
  order by x.sn nulls first, x.d nulls first, x.wd nulls first, x.h;
end;
$$;

grant execute on function public.site_hourly_summary(date, date, int[], text, boolean) to authenticated;

-- Keep it current: yesterday + today every hour (Central dates, after the daily
-- sync at :20), and the trailing week once a night for late corrections.
select cron.schedule(
  'sync-site-hourly-hourly',
  '25 * * * *',
  $$
  select net.http_post(
    url := 'https://ppwjqifyyihesuoubixk.supabase.co/functions/v1/sync-site-hourly',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weather_service_key')
    ),
    body := jsonb_build_object(
      'start', to_char((now() at time zone 'America/Chicago')::date - 1, 'YYYY-MM-DD'),
      'end', to_char((now() at time zone 'America/Chicago')::date, 'YYYY-MM-DD')
    ),
    timeout_milliseconds := 150000
  );
  $$
);

select cron.schedule(
  'sync-site-hourly-week',
  '50 9 * * *',
  $$
  select net.http_post(
    url := 'https://ppwjqifyyihesuoubixk.supabase.co/functions/v1/sync-site-hourly',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weather_service_key')
    ),
    body := jsonb_build_object(
      'start', to_char((now() at time zone 'America/Chicago')::date - 8, 'YYYY-MM-DD'),
      'end', to_char((now() at time zone 'America/Chicago')::date - 1, 'YYYY-MM-DD'),
      'maxDays', 8
    ),
    timeout_milliseconds := 300000
  );
  $$
);
