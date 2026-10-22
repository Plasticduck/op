-- FlexWash rollout to more Mighty Wash sites (2026-10-22).
--
-- flexwash_sites has been doing two jobs: "include this site in the FlexWash
-- reports" (Sales/Deposit/Chemicals/Interior/Tips/Commissions/Chargebacks) and
-- "FlexWash replaces this site's dashboard numbers" (the site-performance overlay,
-- the archive skip in sync-site-performance, and the sync-flexwash archive write).
-- The dashboard now folds FlexWash in for converted sites on its own (its daily
-- cars match FlexWash exactly from cutover), so newly converted sites only need
-- the first job. dashboard_source = false means reporting-only: the dashboard
-- overlay and archive jobs leave the site alone. Existing rows keep today's
-- behavior (true).
alter table public.flexwash_sites
  add column if not exists dashboard_source boolean not null default true;

-- Cutover dates (first day the site ran washes in FlexWash). Reports that combine
-- SiteWatch and FlexWash count SiteWatch before this date and FlexWash from it on.
-- Before these dates FlexWash had no data for the site, so the overlay/sync jobs
-- that already honor start_date behave the same as before. MW29 keeps its date.
update public.flexwash_sites fs
set start_date = d.sd::date
from (values (12, '2026-09-14'), (13, '2026-09-15'), (17, '2026-02-21'), (18, '2026-04-19'),
             (24, '2026-09-08'), (30, '2026-07-28'), (31, '2026-08-25')) as d(n, sd)
where fs.site_number = d.n and fs.start_date is null;

-- Newly live FlexWash sites (car wash IDs confirmed one by one). MW9 hasn't run a
-- wash in FlexWash yet, so it has no cutover date until it does.
insert into public.flexwash_sites (account_id, site_number, car_wash_id, name, start_date, dashboard_source)
select '54f3e299-1f61-4ed2-9921-3d02160b72e6', v.n, v.cw, v.nm, v.sd::date, false
from (values
  (1,  '416', 'Mighty Wash #1',  '2026-10-20'),
  (2,  '443', 'Mighty Wash #2',  '2026-10-07'),
  (4,  '438', 'Mighty Wash #4',  '2026-09-30'),
  (6,  '439', 'Mighty Wash #6',  '2026-10-12'),
  (8,  '444', 'Mighty Wash #8',  '2026-09-22'),
  (9,  '419', 'Mighty Wash #9',  null),
  (11, '421', 'Mighty Wash #11', '2026-10-21'),
  (15, '445', 'Mighty Wash #15', '2026-09-21'),
  (22, '446', 'Mighty Wash #22', '2026-09-28'),
  (25, '447', 'Mighty Wash #25', '2026-09-29')
) as v(n, cw, nm, sd)
on conflict (account_id, car_wash_id) do nothing;
