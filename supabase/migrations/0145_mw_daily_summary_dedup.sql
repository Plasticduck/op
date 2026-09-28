-- Fix: the daily summary email (mw_daily_summary) crashed with "more than one
-- row returned by a subquery used as an expression" when site_performance_days
-- had two rows for the same (site_number, date). That happens for sites that
-- converted to FlexWash (12/13/24/31): the DRB sync writes a row named
-- "MightyWash 0NN" and the FlexWash sync writes one named "Mighty Wash #NN" for
-- the same site_number+date. The unique index is on (account_id, site, date)
-- where site is the NAME string, so both rows persist; the RPC keys its per-site
-- "last week" subquery on site_number, hit two rows, and the whole email failed
-- with 500 data_failed.
--
-- These are NOT duplicate money: after a site converts, DRB keeps recharging the
-- old membership plans while FlexWash takes the new retail/washes, so revenue
-- flows through BOTH systems for a while. So the fix COMBINES the two rows per
-- (account_id, site_number, date): one car count (max -- both POS report the same
-- day's cars) with sales and recharge SUMMED across the systems. Days/sites with a
-- single row are unchanged. Rows with a null site_number pass through untouched.

create or replace function public.mw_daily_summary()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  rday date;
  m_latest date;
  m_prev date;
  result jsonb;
begin
  select max(date) into rday from public.site_performance_days
    where date < (now() at time zone 'America/Chicago')::date and cars > 0;
  if rday is null then
    select max(date) into rday from public.site_performance_days where cars > 0;
  end if;
  select max(period) into m_latest from public.gm_bonus_months;
  select max(period) into m_prev from public.gm_bonus_months where period < m_latest;

  with spd as (
    select account_id, site_number, date,
      max(site) as site, max(cars) as cars, max(hours) as hours,
      max(cars_per_hour) as cars_per_hour, sum(sales) as sales, sum(recharge) as recharge
    from public.site_performance_days
    where site_number is not null
    group by account_id, site_number, date
    union all
    select account_id, site_number, date, site, cars, hours, cars_per_hour, sales, recharge
    from public.site_performance_days
    where site_number is null
  )
  select jsonb_build_object(
    'reporting_date', rday,
    'day',      (select jsonb_build_object('cars', coalesce(sum(cars),0), 'sales', coalesce(sum(sales),0), 'recharge', coalesce(sum(recharge),0), 'sites', count(*) filter (where cars > 0)) from spd where date = rday),
    'prev_day', (select jsonb_build_object('cars', coalesce(sum(cars),0), 'sales', coalesce(sum(sales),0), 'recharge', coalesce(sum(recharge),0)) from spd where date = rday - 1),
    'last_week',(select jsonb_build_object('cars', coalesce(sum(cars),0), 'sales', coalesce(sum(sales),0), 'recharge', coalesce(sum(recharge),0)) from spd where date = rday - 7),
    'avg4_cars',(select avg(d) from (select sum(cars) d from spd where date in (rday-7, rday-14, rday-21, rday-28) group by date) x),
    'mtd', jsonb_build_object(
      'cars',  (select coalesce(sum(cars),0)  from spd where date >= date_trunc('month', rday)::date and date <= rday),
      'sales', (select coalesce(sum(sales),0) from spd where date >= date_trunc('month', rday)::date and date <= rday),
      'prev_cars',  (select coalesce(sum(cars),0)  from spd where date >= date_trunc('month', (rday - interval '1 month'))::date and date <= (rday - interval '1 month')::date),
      'prev_sales', (select coalesce(sum(sales),0) from spd where date >= date_trunc('month', (rday - interval '1 month'))::date and date <= (rday - interval '1 month')::date)
    ),
    'sites', (
      select jsonb_agg(jsonb_build_object(
        'site', s.site, 'n', s.site_number, 'cars', s.cars, 'sales', s.sales, 'recharge', s.recharge, 'cph', s.cars_per_hour,
        'cars_lw', (select w.cars from spd w where w.site_number = s.site_number and w.date = rday - 7)
      ) order by s.cars desc nulls last)
      from spd s where s.date = rday
    ),
    'membership', (
      select jsonb_build_object('period', m_latest, 'mighty', coalesce(sum(mighty_count),0), 'super', coalesce(sum(super_count),0), 'wonder', coalesce(sum(wonder_count),0), 'churn', round(avg(churn_pct)::numeric, 2), 'conversion', round(avg(conversion_pct)::numeric, 2))
      from public.gm_bonus_months where period = m_latest
    ),
    'membership_prev', (
      select jsonb_build_object('mighty', coalesce(sum(mighty_count),0), 'super', coalesce(sum(super_count),0), 'wonder', coalesce(sum(wonder_count),0), 'churn', round(avg(churn_pct)::numeric, 2), 'conversion', round(avg(conversion_pct)::numeric, 2))
      from public.gm_bonus_months where period = m_prev
    )
  ) into result;
  return result;
end $function$;

create or replace function public.mw_daily_summary(p_day date)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  rday date := p_day;
  m_latest date;
  m_prev date;
  result jsonb;
begin
  select max(period) into m_latest from public.gm_bonus_months;
  select max(period) into m_prev from public.gm_bonus_months where period < m_latest;

  with spd as (
    select account_id, site_number, date,
      max(site) as site, max(cars) as cars, max(hours) as hours,
      max(cars_per_hour) as cars_per_hour, sum(sales) as sales, sum(recharge) as recharge
    from public.site_performance_days
    where site_number is not null
    group by account_id, site_number, date
    union all
    select account_id, site_number, date, site, cars, hours, cars_per_hour, sales, recharge
    from public.site_performance_days
    where site_number is null
  )
  select jsonb_build_object(
    'reporting_date', rday,
    'day',      (select jsonb_build_object('cars', coalesce(sum(cars),0), 'sales', coalesce(sum(sales),0), 'recharge', coalesce(sum(recharge),0), 'sites', count(*) filter (where cars > 0)) from spd where date = rday),
    'prev_day', (select jsonb_build_object('cars', coalesce(sum(cars),0), 'sales', coalesce(sum(sales),0), 'recharge', coalesce(sum(recharge),0)) from spd where date = rday - 1),
    'last_week',(select jsonb_build_object('cars', coalesce(sum(cars),0), 'sales', coalesce(sum(sales),0), 'recharge', coalesce(sum(recharge),0)) from spd where date = rday - 7),
    'avg4_cars',(select avg(d) from (select sum(cars) d from spd where date in (rday-7, rday-14, rday-21, rday-28) group by date) x),
    'mtd', jsonb_build_object(
      'cars',  (select coalesce(sum(cars),0)  from spd where date >= date_trunc('month', rday)::date and date <= rday),
      'sales', (select coalesce(sum(sales),0) from spd where date >= date_trunc('month', rday)::date and date <= rday),
      'prev_cars',  (select coalesce(sum(cars),0)  from spd where date >= date_trunc('month', (rday - interval '1 month'))::date and date <= (rday - interval '1 month')::date),
      'prev_sales', (select coalesce(sum(sales),0) from spd where date >= date_trunc('month', (rday - interval '1 month'))::date and date <= (rday - interval '1 month')::date)
    ),
    'sites', (
      select jsonb_agg(jsonb_build_object(
        'site', s.site, 'n', s.site_number, 'cars', s.cars, 'sales', s.sales, 'recharge', s.recharge, 'cph', s.cars_per_hour,
        'cars_lw', (select w.cars from spd w where w.site_number = s.site_number and w.date = rday - 7)
      ) order by s.cars desc nulls last)
      from spd s where s.date = rday
    ),
    'membership', (
      select jsonb_build_object('period', m_latest, 'mighty', coalesce(sum(mighty_count),0), 'super', coalesce(sum(super_count),0), 'wonder', coalesce(sum(wonder_count),0), 'churn', round(avg(churn_pct)::numeric, 2), 'conversion', round(avg(conversion_pct)::numeric, 2))
      from public.gm_bonus_months where period = m_latest
    ),
    'membership_prev', (
      select jsonb_build_object('mighty', coalesce(sum(mighty_count),0), 'super', coalesce(sum(super_count),0), 'wonder', coalesce(sum(wonder_count),0), 'churn', round(avg(churn_pct)::numeric, 2), 'conversion', round(avg(conversion_pct)::numeric, 2))
      from public.gm_bonus_months where period = m_prev
    )
  ) into result;
  return result;
end $function$;
