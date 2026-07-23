-- Daily archive of the Mighty Wash site-performance feed. The live dashboard only
-- exposes ~30 trailing days, so to answer "last quarter / last year" we store each
-- day's per-site numbers here and let them accumulate. Populated by the
-- sync-site-performance edge function (daily cron + a one-time ~30-day backfill).
create table if not exists public.site_performance_days (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  site          text not null,        -- feed's site name, e.g. "MightyWash 001"
  site_number   int,                  -- parsed number, for region grouping/matching
  date          date not null,
  cars          numeric,
  hours         numeric,
  cars_per_hour numeric,
  sales         numeric,
  labor_cost    numeric,
  labor_pct     numeric,
  recharge      numeric,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (account_id, site, date)
);
create index if not exists site_perf_days_acct_date_idx
  on public.site_performance_days (account_id, date desc);
create index if not exists site_perf_days_num_idx
  on public.site_performance_days (account_id, site_number, date);

alter table public.site_performance_days enable row level security;

-- Same access as the live Site Performance page: owners/managers see the account's
-- sites. Writes come only from the service-role sync job.
create policy site_performance_days_select on public.site_performance_days
  for select using (account_id = auth_account_id() and auth_is_manager_plus());
