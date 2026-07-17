-- 0055_gm_bonus.sql
-- GM / AGM monthly bonus automation. Enabled per-account via a flag (Mighty Wash
-- only for now). Two tables, both owner-only and account-scoped:
--   gm_bonus_base   one resettable baseline snapshot per site
--   gm_bonus_months one row of inputs per site per month
-- Bonus amounts are computed in the client (see src/lib/gmBonus.ts) from these
-- inputs plus the prior month's row, so the math stays in one place.

alter table public.accounts
  add column if not exists gm_bonus_enabled boolean not null default false;

update public.accounts set gm_bonus_enabled = true where name = 'Mighty Wash';

create table if not exists public.gm_bonus_base (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  location_id  uuid not null references public.locations(id) on delete cascade,
  base_date    date not null,
  mighty_count int not null default 0,
  super_count  int not null default 0,
  wonder_count int not null default 0,
  avg_mos      numeric not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (location_id)
);

create table if not exists public.gm_bonus_months (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  location_id    uuid not null references public.locations(id) on delete cascade,
  period         date not null,
  mighty_count   int not null default 0,
  super_count    int not null default 0,
  wonder_count   int not null default 0,
  avg_mos        numeric not null default 0,
  churn_pct      numeric not null default 0,
  conversion_pct numeric not null default 0,
  source         text not null default 'manual',
  submitted_by   uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (location_id, period)
);

create index if not exists gm_bonus_months_loc_period_idx
  on public.gm_bonus_months (location_id, period);

alter table public.gm_bonus_base enable row level security;
alter table public.gm_bonus_months enable row level security;

-- Compensation data: owners (Admin) of the account only.
create policy gm_bonus_base_all on public.gm_bonus_base
  for all
  using (account_id = auth_account_id() and auth_role() = 'owner')
  with check (account_id = auth_account_id() and auth_role() = 'owner');

create policy gm_bonus_months_all on public.gm_bonus_months
  for all
  using (account_id = auth_account_id() and auth_role() = 'owner')
  with check (account_id = auth_account_id() and auth_role() = 'owner');
