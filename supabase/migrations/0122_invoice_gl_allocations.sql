-- Approvers can split an invoice across multiple GL codes with per-code amounts.
-- Stored as [{ "gl_code": text, "amount": number }, ...]. gl_code stays populated
-- (joined list / single code) for display and the QuickBooks export fallback.
alter table public.ops_invoices add column if not exists gl_allocations jsonb;
