-- Per-site totals over a date range from site_daily_metrics: cars, gross sales
-- and recharge $ are each DRB + FlexWash, every day. FlexWash is only stored
-- from a site's cutover day (sync-site-daily), so before it this is DRB alone;
-- after it, DRB still carries legacy member billing and a few stray washes,
-- which the official monthly car count sheet also includes (checked Sept 2025
-- and Sept 2026 site by site). security invoker, so the table's RLS (manager+
-- of the account) applies.
create or replace function public.site_daily_totals(p_start date, p_end date)
returns table (site_number int, cars numeric, sales numeric, recharge numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select m.site_number,
    sum(coalesce(m.drb_cars, 0) + coalesce(m.flex_cars, 0)),
    sum(coalesce(m.drb_sales, 0) + coalesce(m.flex_sales, 0)),
    sum(coalesce(m.drb_recharge, 0) + coalesce(m.flex_recharge, 0))
  from public.site_daily_metrics m
  where m.date between p_start and p_end
  group by m.site_number
$$;

-- Earliest and latest stored day, so History knows how far back totals (and
-- vs-last-year comparisons) are complete.
create or replace function public.site_daily_bounds()
returns table (min_date date, max_date date)
language sql
stable
security invoker
set search_path = public
as $$
  select min(date), max(date) from public.site_daily_metrics
$$;

grant execute on function public.site_daily_totals(date, date) to authenticated;
grant execute on function public.site_daily_bounds() to authenticated;
