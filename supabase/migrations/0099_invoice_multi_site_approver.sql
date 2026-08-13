-- Invoice Approval: multiple sites and multiple approvers per invoice, plus the
-- per-site dollar split the approver enters at approval, and the AI-extracted
-- invoice number.
--
-- The legacy single columns (location_id, assigned_to, assigned_to_name) are
-- kept and still written (first site / first approver) so existing readers
-- (notify function, older rows, QB export fallback) keep working. New code reads
-- the arrays when present and falls back to the singles otherwise.
alter table ops_invoices
  add column if not exists location_ids uuid[] not null default '{}',
  add column if not exists approver_ids uuid[] not null default '{}',
  add column if not exists approver_names text[] not null default '{}',
  -- [{ location_id, name, amount }] entered by the approver when an invoice
  -- spans more than one site. QB export emits one line per allocation.
  add column if not exists site_allocations jsonb not null default '[]'::jsonb,
  add column if not exists invoice_number text;
