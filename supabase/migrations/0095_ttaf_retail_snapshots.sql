-- 0095_ttaf_retail_snapshots.sql
-- Daily retail (non-membership, non-recharge sales) for the morning email.
-- The dashboard only computes true retail (TTAF's retail_dollars) monthly, so
-- we get an accurate DAILY figure by snapshotting the month-to-date retail each
-- morning and reporting the day-over-day increase. One row per account per day.

create table if not exists public.ttaf_retail_snapshots (
  account_id uuid not null references public.accounts(id) on delete cascade,
  snapshot_date date not null,
  month_key text not null,
  retail_mtd numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (account_id, snapshot_date)
);

alter table public.ttaf_retail_snapshots enable row level security;
create policy ttaf_retail_snapshots_select on public.ttaf_retail_snapshots
  for select using (account_id = public.auth_account_id());
