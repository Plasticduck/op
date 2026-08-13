-- Date-parameterized overload of mw_daily_summary so the digest email can be
-- reproduced for a specific past reporting day (backfill / re-send). The no-arg
-- version (0088) still drives the scheduled send off the last complete day; this
-- overload just pins rday to the caller-supplied date and computes the same blob.
create or replace function public.mw_daily_summary(p_day date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rday date := p_day;
  m_latest date;
  m_prev date;
  result jsonb;
begin
  select max(period) into m_latest from public.gm_bonus_months;
  select max(period) into m_prev from public.gm_bonus_months where period < m_latest;

  select jsonb_build_object(
    'reporting_date', rday,
    'day',      (select jsonb_build_object('cars', coalesce(sum(cars),0), 'sales', coalesce(sum(sales),0), 'recharge', coalesce(sum(recharge),0), 'sites', count(*) filter (where cars > 0)) from public.site_performance_days where date = rday),
    'prev_day', (select jsonb_build_object('cars', coalesce(sum(cars),0), 'sales', coalesce(sum(sales),0), 'recharge', coalesce(sum(recharge),0)) from public.site_performance_days where date = rday - 1),
    'last_week',(select jsonb_build_object('cars', coalesce(sum(cars),0), 'sales', coalesce(sum(sales),0), 'recharge', coalesce(sum(recharge),0)) from public.site_performance_days where date = rday - 7),
    'avg4_cars',(select avg(d) from (select sum(cars) d from public.site_performance_days where date in (rday-7, rday-14, rday-21, rday-28) group by date) x),
    'mtd', jsonb_build_object(
      'cars',  (select coalesce(sum(cars),0)  from public.site_performance_days where date >= date_trunc('month', rday)::date and date <= rday),
      'sales', (select coalesce(sum(sales),0) from public.site_performance_days where date >= date_trunc('month', rday)::date and date <= rday),
      'prev_cars',  (select coalesce(sum(cars),0)  from public.site_performance_days where date >= date_trunc('month', (rday - interval '1 month'))::date and date <= (rday - interval '1 month')::date),
      'prev_sales', (select coalesce(sum(sales),0) from public.site_performance_days where date >= date_trunc('month', (rday - interval '1 month'))::date and date <= (rday - interval '1 month')::date)
    ),
    'sites', (
      select jsonb_agg(jsonb_build_object(
        'site', s.site, 'n', s.site_number, 'cars', s.cars, 'sales', s.sales, 'recharge', s.recharge, 'cph', s.cars_per_hour,
        'cars_lw', (select w.cars from public.site_performance_days w where w.site_number = s.site_number and w.date = rday - 7)
      ) order by s.cars desc nulls last)
      from public.site_performance_days s where s.date = rday
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
end $$;

revoke all on function public.mw_daily_summary(date) from public, authenticated;
grant execute on function public.mw_daily_summary(date) to service_role;
