-- 0057_account_brand_logo.sql
-- Optional per-account brand logo shown at the top of the dashboards. Set for
-- Mighty Wash; other accounts leave it null and show no logo.
alter table public.accounts
  add column if not exists brand_logo_url text;

update public.accounts set brand_logo_url = '/mighty-wash-logo.png' where name = 'Mighty Wash';
