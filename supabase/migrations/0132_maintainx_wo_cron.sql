-- Keep MaintainX work orders live: run the incremental sync-maintainx every hour
-- so the dashboard's open-work-orders per site stay current. Mirrors the other
-- sync-* cron jobs; reuses the service-key vault secret for auth.

select cron.schedule(
  'sync-maintainx-hourly',
  '30 * * * *',
  $$
  select net.http_post(
    url := 'https://ppwjqifyyihesuoubixk.supabase.co/functions/v1/sync-maintainx',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weather_service_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
