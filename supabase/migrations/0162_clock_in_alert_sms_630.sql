-- Unusual Clock-Ins: texts move to 6:30 AM Central, the email stays at 6:00.
-- The function now takes { phase: 'email' | 'sms' }. Each phase is scheduled at
-- both UTC hours (11 and 12) so one call lands in the 6 AM Central hour across
-- daylight saving; the function's hour guard drops the other.
-- Apply together with the function deploy that understands `phase`, or the
-- old function would treat both calls as full runs and send twice.

select cron.unschedule('clock-in-alert-email-6am-central')
where exists (select 1 from cron.job where jobname = 'clock-in-alert-email-6am-central');

select cron.unschedule('clock-in-alert-sms-630am-central')
where exists (select 1 from cron.job where jobname = 'clock-in-alert-sms-630am-central');

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
    body := '{"phase":"email"}'::jsonb
  );
  $$
);

select cron.schedule(
  'clock-in-alert-sms-630am-central',
  '30 11,12 * * *',
  $$
  select net.http_post(
    url := 'https://ppwjqifyyihesuoubixk.supabase.co/functions/v1/clock-in-alert-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weather_service_key')
    ),
    body := '{"phase":"sms"}'::jsonb
  );
  $$
);
