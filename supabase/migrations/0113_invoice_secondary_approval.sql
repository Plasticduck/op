-- Optional two-level approval. Accounting can name a second-level approver when
-- assigning an invoice. After the first approver signs off, the invoice stays in
-- the Assigned queue but re-targets the secondary approver (awaiting_secondary),
-- shown as "Secondary approval required"; the secondary approval then finalizes
-- it to Approved. When no secondary approver is set, the first approval finalizes
-- as before.
alter table public.ops_invoices add column if not exists secondary_approver_ids uuid[] not null default '{}';
alter table public.ops_invoices add column if not exists secondary_approver_names text[] not null default '{}';
alter table public.ops_invoices add column if not exists awaiting_secondary boolean not null default false;
alter table public.ops_invoices add column if not exists first_approved_by uuid;
alter table public.ops_invoices add column if not exists first_approved_by_name text;
alter table public.ops_invoices add column if not exists first_approved_at timestamptz;
