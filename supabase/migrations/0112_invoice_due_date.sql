-- Optional payment due date for an invoice, set by AP while it is unassigned so
-- approvers/payers can prioritize. Plain date; nullable (not every invoice has one).
alter table public.ops_invoices add column if not exists due_date date;
