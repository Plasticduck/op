-- 0098_ttaf_snapshot_persite.sql
-- Store per-site month-to-date TTAF (recharge + retail) in the daily snapshot so
-- the email's per-site Sales column can be shown on an actual-money basis (the
-- same day-over-day delta as the headline, but per site). Keyed site_number -> ttaf.
alter table public.ttaf_retail_snapshots add column if not exists site_ttaf jsonb;
