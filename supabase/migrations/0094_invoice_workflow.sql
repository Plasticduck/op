-- 0094_invoice_workflow.sql
-- Invoice Approval workflow: track who exported an invoice to accounting and
-- when. Assignment (assigned_to/_name, assigned_at), decisions (decided_by/
-- _name/_at, decision_reason), site (location_id), and edit fields (vendor_name,
-- amount, invoice_date, gl_code) already exist from 0020/0028. Status is a free
-- text column driving the tabs: unassigned -> queue -> assigned ->
-- approved -> exported, with needs_attention and cancelled off to the side.

alter table public.ops_invoices
  add column if not exists exported_at timestamptz,
  add column if not exists exported_by uuid references public.users(id) on delete set null,
  add column if not exists exported_by_name text;
