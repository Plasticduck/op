-- Keep Operator's schedulable roster in sync with iSolved nightly: pull active
-- staff into `employees` (as schedulable labor) and deactivate anyone no longer
-- active. Runs at 10:00 UTC (early morning Central). Reuses the service-key vault
-- secret for auth (same pattern as the other syncs); the function recognizes the
-- service-role JWT.
select cron.schedule(
  'isolved-roster-sync-nightly',
  '0 10 * * *',
  $$
  select net.http_post(
    url := 'https://ppwjqifyyihesuoubixk.supabase.co/functions/v1/isolved-roster-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weather_service_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
