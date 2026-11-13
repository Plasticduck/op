-- site_hourly_summary (0235) failed for 'typical_week': its per-weekday day count
-- was a correlated subquery on an expression Postgres won't match to the GROUP BY.
-- Same results, with the weekday worked out once and day counts joined in.
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
    select case when p_combine then null else c.site_number end as sn, c.date as d,
      extract(isodow from c.date)::int as wd, c.hour::int as h, sum(c.cars) as n
    from public.site_hourly_car_counts c
    where c.date between p_start and p_end and (p_sites is null or c.site_number = any(p_sites))
    group by 1, 2, 3, 4
  ),
  -- Days the site (or the sites together) had any cars: what averages divide by.
  open_days as (select b.sn, b.d, b.wd from base b group by b.sn, b.d, b.wd having sum(b.n) <> 0),
  days_all as (select o.sn, count(*)::int as k from open_days o group by o.sn),
  days_wd as (select o.sn, o.wd, count(*)::int as k from open_days o group by o.sn, o.wd)
  select x.sn, x.d, x.wd, x.h, x.n, x.days, x.avg_n
  from (
    select b.sn, b.d, b.wd, b.h, b.n, 1 as days, b.n as avg_n
    from base b where p_view = 'hours'
    union all
    select b.sn, null::date, null::int, b.h, sum(b.n), max(da.k), round(sum(b.n) / nullif(max(da.k), 0), 1)
    from base b left join days_all da on da.sn is not distinct from b.sn
    where p_view = 'by_hour'
    group by b.sn, b.h
    union all
    select b.sn, null::date, b.wd, b.h, sum(b.n), max(dw.k), round(sum(b.n) / nullif(max(dw.k), 0), 1)
    from base b left join days_wd dw on dw.sn is not distinct from b.sn and dw.wd = b.wd
    where p_view = 'typical_week'
    group by b.sn, b.wd, b.h
  ) x
  order by x.sn nulls first, x.d nulls first, x.wd nulls first, x.h;
end;
$$;
