-- Daily archive of Lube Shop (store 019) stats into lube_stats_days. Re-persists
-- the trailing few days each morning (idempotent upsert) so late-posting
-- corrections are captured. Mirrors the other sync-* cron jobs; reuses the
-- service-key vault secret for auth.

select cron.schedule(
  'sync-lube-stats-daily',
  '0 10 * * *',
  $$
  select net.http_post(
    url := 'https://ppwjqifyyihesuoubixk.supabase.co/functions/v1/lube-stats',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weather_service_key')
    ),
    body := jsonb_build_object(
      'persist', true,
      'start', to_char((current_date - 4), 'YYYY-MM-DD'),
      'end', to_char(current_date, 'YYYY-MM-DD')
    )
  );
  $$
);
