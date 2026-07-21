-- 0065_site_performance_flag.sql
-- The Site Performance feed proxies the Mighty Wash live-ops dashboard, so the
-- per-site dashboard card only makes sense for that account. Flag it per-account.
alter table public.accounts
  add column if not exists site_performance_enabled boolean not null default false;

update public.accounts set site_performance_enabled = true where name = 'Mighty Wash';
