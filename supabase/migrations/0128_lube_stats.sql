-- Lube Shop (site 19) daily statistics archive. The Lube Shop dashboard pulls
-- live from DRB, and a daily job also upserts each day here so the history
-- persists (and long ranges stay fast) even if DRB rolls off old data. Kept
-- entirely separate from wash-site performance. Manager+ read; the sync writes
-- with the service role.

create table if not exists public.lube_stats_days (
  account_id uuid not null references public.accounts(id) on delete cascade,
  site_number int not null default 19,
  date date not null,
  tickets int not null default 0,
  net_sales numeric not null default 0,
  tax numeric not null default 0,
  synced_at timestamptz not null default now(),
  primary key (account_id, date)
);

alter table public.lube_stats_days enable row level security;

drop policy if exists lube_stats_days_read on public.lube_stats_days;
create policy lube_stats_days_read on public.lube_stats_days
  for select
  using (account_id = auth_account_id() and auth_is_manager_plus());
