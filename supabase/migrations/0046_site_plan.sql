-- 0046_site_plan.sql
-- Account "site plan" chosen at signup: 'single' (one location) or 'multi'
-- (multiple locations). Single-site accounts are blocked from adding a second
-- location and must upgrade. Defaults to 'multi' so existing accounts are
-- unrestricted. Set by the owner (accounts_update RLS already gates writes).

alter table public.accounts
  add column if not exists site_plan text not null default 'multi'
    check (site_plan in ('single', 'multi'));
