-- The nightly checklist email (checklist-daily-email) at 8pm Central.
-- pg_cron runs in UTC, so it fires at 01:00 and 02:00 UTC and the function only
-- sends when it's 8pm in America/Chicago: one email whether CDT or CST. The
-- function claims the day before sending, so the two runs can't both send.

select cron.unschedule('checklist-daily-email')
where exists (select 1 from cron.job where jobname = 'checklist-daily-email');

select cron.schedule(
  'checklist-daily-email',
  '0 1,2 * * *',
  $$
  select net.http_post(
    url := 'https://ppwjqifyyihesuoubixk.supabase.co/functions/v1/checklist-daily-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weather_service_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
