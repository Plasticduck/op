-- Maintenance Inventory: the two schedules. Neither sends a text until an admin turns
-- texts on (mi_settings.sms_enabled, off by default).
--   Every minute, only while an alert is waiting: mi-alerts dispatch.
--   Nightly at 03:30 Central (09:30 UTC in standard time): reorder points, overdue
--   tools, scheduled counts and the low-stock digest. An hour's drift across daylight
--   saving doesn't matter for a nightly check.
select cron.schedule(
  'mi-alerts-dispatch',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://ppwjqifyyihesuoubixk.supabase.co/functions/v1/mi-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weather_service_key')
    ),
    body := '{"action": "dispatch"}'::jsonb,
    timeout_milliseconds := 55000
  )
  where exists (select 1 from public.mi_alerts where status = 'pending')
  $$
);

select cron.schedule(
  'mi-nightly',
  '30 9 * * *',
  $$
  select net.http_post(
    url := 'https://ppwjqifyyihesuoubixk.supabase.co/functions/v1/mi-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weather_service_key')
    ),
    body := '{"action": "nightly"}'::jsonb,
    timeout_milliseconds := 120000
  )
  $$
);
