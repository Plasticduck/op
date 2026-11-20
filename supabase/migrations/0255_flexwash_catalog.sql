-- Operator AI's FlexWash catalog, kept current automatically (Kevan, 2026-11-20:
-- "Always keep that as current as possible").
--
-- flexwash-catalog-sync reads FlexWash's published partner API docs every 6 hours
-- and builds the catalog of read endpoints (_shared/flexwash_catalog_build.ts).
-- Each version that differs from the last is a new row; ask-operator reads the
-- newest one and falls back to the copy bundled with it when this is empty.
-- New endpoints whose names don't say they only read are held back (`held`) for a
-- person to review. `changes` records what moved since the version before, and
-- `breaking` lists inputs that became required or endpoints that went away (on
-- 2026-11-20 two reports Operator's own pages use started requiring `limit`).
--
-- Service role only: no policies.

create table if not exists public.flexwash_catalog (
  id             bigint generated always as identity primary key,
  fetched_at     timestamptz not null default now(),
  checked_at     timestamptz not null default now(),
  docs_sha256    text not null,
  endpoint_count int not null,
  endpoints      jsonb not null,
  held           jsonb not null default '[]'::jsonb,
  changes        jsonb not null default '{}'::jsonb
);
alter table public.flexwash_catalog enable row level security;
create index if not exists flexwash_catalog_fetched_idx on public.flexwash_catalog (fetched_at desc);

select cron.unschedule('flexwash-catalog-sync')
where exists (select 1 from cron.job where jobname = 'flexwash-catalog-sync');

select cron.schedule(
  'flexwash-catalog-sync',
  '20 */6 * * *',
  $$
  select net.http_post(
    url := 'https://ppwjqifyyihesuoubixk.supabase.co/functions/v1/flexwash-catalog-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weather_service_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
