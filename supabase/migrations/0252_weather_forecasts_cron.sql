-- Save each morning's forecast (sync-weather-forecasts). The 12Z National Blend
-- run is out around 13-14Z, so it runs at 15:00 UTC, with 18:00 UTC to pick up
-- anything that wasn't out yet. Each run only fetches mornings it doesn't have.

select cron.unschedule('sync-weather-forecasts')
where exists (select 1 from cron.job where jobname = 'sync-weather-forecasts');

select cron.schedule(
  'sync-weather-forecasts',
  '0 15,18 * * *',
  $$
  select net.http_post(
    url := 'https://ppwjqifyyihesuoubixk.supabase.co/functions/v1/sync-weather-forecasts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weather_service_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
