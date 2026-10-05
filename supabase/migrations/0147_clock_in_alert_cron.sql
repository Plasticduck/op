-- Daily "unusual clock-ins" email at 6:00 AM Central. pg_cron fires at both 11:00
-- and 12:00 UTC (6 AM CDT and 6 AM CST); the clock-in-alert-email function's time
-- guard (chicagoHour === 6) lets exactly one of them proceed, so it stays correct
-- across daylight-saving changes. Reuses the service-key vault secret for auth.
select cron.schedule(
  'clock-in-alert-email-6am-central',
  '0 11,12 * * *',
  $$
  select net.http_post(
    url := 'https://ppwjqifyyihesuoubixk.supabase.co/functions/v1/clock-in-alert-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weather_service_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
