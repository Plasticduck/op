-- flexwash-site-watch (Kevan, 2026-11-02): every morning, adds any store that has
-- started running washes in FlexWash to flexwash_sites. MW5 and MW10 went live on
-- 2026-10-27 and nothing told Operator, so every report built from that list missed
-- them. Its first run added them, and MW7, which went live 2026-11-02.
-- 09:10 UTC is before sync-site-daily-week (09:40), sync-flexwash-daily (09:50) and
-- the daily summary email.
-- Deploy the function first: npx supabase functions deploy flexwash-site-watch

select cron.unschedule('flexwash-site-watch')
where exists (select 1 from cron.job where jobname = 'flexwash-site-watch');

select cron.schedule(
  'flexwash-site-watch',
  '10 9 * * *',
  $$
  select net.http_post(
    url := 'https://ppwjqifyyihesuoubixk.supabase.co/functions/v1/flexwash-site-watch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weather_service_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
