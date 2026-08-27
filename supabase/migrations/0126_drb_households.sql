-- Household Finder: DRB/SiteWatch customers grouped into likely households.
-- Populated by the `sync-drb-households` edge function, which clusters the live
-- SiteWatch CUSTOMER table by shared residential address and maps each household
-- to a region from its ZIP. Admin (owner) only: this holds customer PII, so both
-- tables are locked to the owner of the owning account via RLS. The sync runs
-- with the service role and bypasses RLS by design.

create table if not exists public.drb_households (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  cluster_key text not null,
  match_type text not null default 'address',
  region text,
  address text,
  city text,
  state text,
  zip text,
  member_count int not null default 0,
  synced_at timestamptz not null default now(),
  unique (account_id, cluster_key)
);
create index if not exists drb_households_account_region_idx
  on public.drb_households (account_id, region);

create table if not exists public.drb_household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.drb_households(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  customer_objid text,
  first_name text,
  last_name text,
  full_name text,
  phone text,
  email text,
  address text,
  city text,
  state text,
  zip text
);
create index if not exists drb_household_members_household_idx
  on public.drb_household_members (household_id);
create index if not exists drb_household_members_account_idx
  on public.drb_household_members (account_id);

alter table public.drb_households enable row level security;
alter table public.drb_household_members enable row level security;

drop policy if exists drb_households_owner_all on public.drb_households;
create policy drb_households_owner_all on public.drb_households
  for all
  using (account_id = auth_account_id() and auth_role() = 'owner')
  with check (account_id = auth_account_id() and auth_role() = 'owner');

drop policy if exists drb_household_members_owner_all on public.drb_household_members;
create policy drb_household_members_owner_all on public.drb_household_members
  for all
  using (account_id = auth_account_id() and auth_role() = 'owner')
  with check (account_id = auth_account_id() and auth_role() = 'owner');
