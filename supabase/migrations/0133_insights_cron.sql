-- Nightly refresh of the AI Insights for Mighty Wash, now that they are based on
-- live MaintainX work orders. Each run archives the prior active insights and
-- regenerates. Uses the service-role path on generate-insights (account_id in the
-- body); reuses the service-key vault secret for auth.

select cron.schedule(
  'generate-insights-nightly',
  '0 11 * * *',
  $$
  select net.http_post(
    url := 'https://ppwjqifyyihesuoubixk.supabase.co/functions/v1/generate-insights',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weather_service_key')
    ),
    body := jsonb_build_object('account_id', '54f3e299-1f61-4ed2-9921-3d02160b72e6')
  );
  $$
);
