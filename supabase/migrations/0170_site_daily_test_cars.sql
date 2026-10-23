-- Site Performance leaves DRB "Test Car" washes out of Cars (requested
-- 2026-10-23). The dashboard's official car count includes them, so the daily
-- table now also stores each site's Test Car washes (SiteWatch Carwashes item
-- "Test Car", net of refunds), filled by sync-site-daily from 2026-01-01 on.
-- Earlier days have none stored, so they still include test cars.
alter table public.site_daily_metrics add column if not exists drb_test_cars numeric;

create or replace function public.site_daily_totals(p_start date, p_end date)
returns table (site_number int, cars numeric, sales numeric, recharge numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select m.site_number,
    sum(coalesce(m.drb_cars, 0) - coalesce(m.drb_test_cars, 0) + coalesce(m.flex_cars, 0)),
    sum(coalesce(m.drb_sales, 0) + coalesce(m.flex_sales, 0)),
    sum(coalesce(m.drb_recharge, 0) + coalesce(m.flex_recharge, 0))
  from public.site_daily_metrics m
  where m.date between p_start and p_end
  group by m.site_number
$$;
