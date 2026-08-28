-- Daily archive of the HQ (site 98) central sales line into site_performance_days
-- (as the standalone "HQ" row), so company sales totals stay current. Re-persists
-- the trailing few days each morning. Mirrors the other sync-* cron jobs.

select cron.schedule(
  'sync-hq-sales-daily',
  '10 10 * * *',
  $$
  select net.http_post(
    url := 'https://ppwjqifyyihesuoubixk.supabase.co/functions/v1/sync-hq-sales',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weather_service_key')
    ),
    body := jsonb_build_object(
      'start', to_char((current_date - 4), 'YYYY-MM-DD'),
      'end', to_char(current_date, 'YYYY-MM-DD')
    )
  );
  $$
);
