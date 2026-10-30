-- IT Inventory reminders (2026-10-30): the it-reminders edge function at 8 AM
-- Central. Scheduled at both UTC hours (13 and 14) so one call lands at 8 AM
-- Central across daylight saving; the function's hour guard drops the other.
-- Accounts are skipped until an admin turns reminders on in IT Inventory
-- settings (it_settings.reminders_enabled).
-- Deploy the function first: npx supabase functions deploy it-reminders

select cron.unschedule('it-reminders-8am-central')
where exists (select 1 from cron.job where jobname = 'it-reminders-8am-central');

select cron.schedule(
  'it-reminders-8am-central',
  '0 13,14 * * *',
  $$
  select net.http_post(
    url := 'https://ppwjqifyyihesuoubixk.supabase.co/functions/v1/it-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weather_service_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
