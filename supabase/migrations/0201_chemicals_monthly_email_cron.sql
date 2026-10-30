-- Chemicals wash-package report by email (Kevan, 2026-10-30): the
-- chemicals-monthly-email edge function on the 1st of every month at 8 AM
-- Central, sending last month's PDF to kjowers@, justin.gamboa@ and
-- josh.roberts@mighty-wash.com. Scheduled at both UTC hours (13 and 14) on the
-- 1st so one call lands at 8 AM Central across daylight saving; the function's
-- 1st-at-8 guard drops the other. The run takes ~30-60 s (FlexWash per site).
-- Deploy the function first: npx supabase functions deploy chemicals-monthly-email

select cron.unschedule('chemicals-monthly-email')
where exists (select 1 from cron.job where jobname = 'chemicals-monthly-email');

select cron.schedule(
  'chemicals-monthly-email',
  '0 13,14 1 * *',
  $$
  select net.http_post(
    url := 'https://ppwjqifyyihesuoubixk.supabase.co/functions/v1/chemicals-monthly-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weather_service_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
