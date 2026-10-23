-- Official daily cars / gross sales / recharge $ per site, DRB and FlexWash kept
-- as separate parts (2026-10-23).
--
-- Site Performance History used to ask the dashboard's guided_query for each
-- range, which (a) now leaves every FlexWash site out of its default roster and
-- only knows their DRB side when named, and (b) is too slow for long ranges
-- (a single site's Jan-Sep revenue timed out). This table holds one row per site
-- per day, filled by the sync-site-daily function:
--   drb_*  : the dashboard's guided cars / revenue / recharge for that one day,
--            every site named explicitly (official numbers, fast for one day)
--   flex_* : FlexWash for converted sites from their cutover day on: cars =
--            single + member washes, sales = all revenue buckets, recharge =
--            membershipsRebilled revenue
-- History adds the two parts (site_daily_totals): FlexWash only exists from the
-- cutover day, and DRB keeps legacy member billing (plus a few stray washes)
-- after it, which the official monthly car count sheet counts too.
create table if not exists public.site_daily_metrics (
  account_id    uuid not null references public.accounts(id) on delete cascade,
  site_number   int not null,
  date          date not null,
  drb_cars      numeric,
  drb_sales     numeric,
  drb_recharge  numeric,
  flex_cars     numeric,
  flex_sales    numeric,
  flex_recharge numeric,
  updated_at    timestamptz not null default now(),
  primary key (account_id, date, site_number)
);

alter table public.site_daily_metrics enable row level security;

-- Same read access as site_performance_days; writes are service-role only.
create policy site_daily_metrics_select on public.site_daily_metrics
  for select using (account_id = auth_account_id() and auth_is_manager_plus());

-- Keep it current: yesterday + today every hour (Central dates), and the
-- trailing week once a night to pick up late corrections.
select cron.schedule(
  'sync-site-daily-hourly',
  '20 * * * *',
  $$
  select net.http_post(
    url := 'https://ppwjqifyyihesuoubixk.supabase.co/functions/v1/sync-site-daily',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weather_service_key')
    ),
    body := jsonb_build_object(
      'start', to_char((now() at time zone 'America/Chicago')::date - 1, 'YYYY-MM-DD'),
      'end', to_char((now() at time zone 'America/Chicago')::date, 'YYYY-MM-DD')
    ),
    timeout_milliseconds := 120000
  );
  $$
);

select cron.schedule(
  'sync-site-daily-week',
  '40 9 * * *',
  $$
  select net.http_post(
    url := 'https://ppwjqifyyihesuoubixk.supabase.co/functions/v1/sync-site-daily',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weather_service_key')
    ),
    body := jsonb_build_object(
      'start', to_char((now() at time zone 'America/Chicago')::date - 8, 'YYYY-MM-DD'),
      'end', to_char((now() at time zone 'America/Chicago')::date - 1, 'YYYY-MM-DD')
    ),
    timeout_milliseconds := 300000
  );
  $$
);
