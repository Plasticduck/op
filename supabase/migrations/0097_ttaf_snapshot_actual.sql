-- 0097_ttaf_snapshot_actual.sql
-- Track month-to-date TTAF (recharge + retail = actual money) alongside retail
-- in the daily snapshot, so the email's Sales can be shown on an actual-money
-- basis (member-wash value removed) via the same day-over-day delta.
alter table public.ttaf_retail_snapshots add column if not exists ttaf_mtd numeric;
