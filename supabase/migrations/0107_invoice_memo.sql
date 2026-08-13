-- Memo for QuickBooks export (required before export; maps to the CSV Memo column).
alter table ops_invoices add column if not exists memo text;
