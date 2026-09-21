-- Cars washed total for Interior Reporting: sums the official daily cars
-- (site_performance_days) for a set of site numbers over a date range. Runs as
-- the caller (security invoker) and is scoped to the caller's account, so RLS on
-- site_performance_days still applies. Aggregating server-side avoids the
-- PostgREST row cap when a wide range spans many site-days.
create or replace function public.interior_cars_washed(
  p_site_numbers integer[],
  p_start date,
  p_end date
)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(spd.cars), 0)
  from public.site_performance_days spd
  where spd.account_id = auth_account_id()
    and spd.site_number = any(p_site_numbers)
    and spd.date >= p_start
    and spd.date <= p_end
$$;

grant execute on function public.interior_cars_washed(integer[], date, date) to authenticated;
