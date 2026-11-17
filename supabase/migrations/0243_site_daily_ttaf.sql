-- TTAF (Total To Account For) per site per day, DRB and FlexWash kept apart
-- (2026-11-17). Presentation mode shows each site's TTAF for the year to date
-- against the same dates last year.
--   drb_ttaf  : SiteWatch ledger, the General Sales Report's "Total To Account
--               For" (tenders + deposits, branches 001008 / 001005), per store
--   flex_ttaf : FlexWash get-accounting, cash + card + gift card + fleet unpaid
--               (the FlexWash Sales Reports page's Total to Account For), from
--               the site's cutover day on
-- A converted site has both for a while: DRB keeps billing legacy members after
-- the cutover, so a site's TTAF is the two added together.
-- Filled by sync-site-daily (its hourly and nightly crons), backfilled from
-- 2025-01-01. Kept out of site_daily_metrics so History's totals don't change.
create table if not exists public.site_daily_ttaf (
  account_id  uuid not null references public.accounts(id) on delete cascade,
  site_number int not null,
  date        date not null,
  drb_ttaf    numeric,
  flex_ttaf   numeric,
  updated_at  timestamptz not null default now(),
  primary key (account_id, date, site_number)
);

alter table public.site_daily_ttaf enable row level security;

-- Same read access as site_daily_metrics; writes are service-role only.
create policy site_daily_ttaf_select on public.site_daily_ttaf
  for select using (account_id = auth_account_id() and auth_is_manager_plus());

-- Year-to-date TTAF per site plus the same dates last year. Runs through
-- p_through (default: yesterday, Central), or the last day stored if the sync is
-- behind, so a missed sync can't make this year look short against a full last
-- year. Feb 29 compares with Feb 28.
create or replace function public.site_ttaf_ytd(p_through date default null)
returns table (
  site_number int,
  drb numeric,
  flex numeric,
  drb_ly numeric,
  flex_ly numeric,
  through date
)
language sql
stable
security invoker
set search_path = public
as $$
  with asked as (
    select coalesce(p_through, (now() at time zone 'America/Chicago')::date - 1) as d
  ),
  b as (
    select least(asked.d, coalesce(
      (select max(t.date) from public.site_daily_ttaf t
        where t.date between date_trunc('year', asked.d)::date and asked.d
          and (t.drb_ttaf is not null or t.flex_ttaf is not null)),
      asked.d)) as y1
    from asked
  ),
  r as (
    select date_trunc('year', b.y1)::date as y0, b.y1,
      (date_trunc('year', b.y1) - interval '1 year')::date as l0,
      (b.y1 - interval '1 year')::date as l1
    from b
  )
  select t.site_number,
    coalesce(sum(t.drb_ttaf) filter (where t.date >= r.y0), 0),
    coalesce(sum(t.flex_ttaf) filter (where t.date >= r.y0), 0),
    coalesce(sum(t.drb_ttaf) filter (where t.date <= r.l1), 0),
    coalesce(sum(t.flex_ttaf) filter (where t.date <= r.l1), 0),
    r.y1
  from public.site_daily_ttaf t, r
  where (t.date between r.y0 and r.y1) or (t.date between r.l0 and r.l1)
  group by t.site_number, r.y1
$$;

grant execute on function public.site_ttaf_ytd(date) to authenticated;
