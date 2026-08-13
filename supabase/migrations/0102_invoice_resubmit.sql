-- Needs Attention -> back to Unassigned flow: when a manager returns a sent-back
-- invoice to Unassigned they leave a note (why / what they fixed) that the
-- approver sees once it's re-assigned. Also allow managers (not just owners) to
-- hard-delete an invoice from Needs Attention.
alter table ops_invoices
  add column if not exists resubmit_note text,
  add column if not exists resubmit_by_name text;

drop policy if exists ops_invoices_delete on ops_invoices;
create policy ops_invoices_delete on ops_invoices
  for delete using (account_id = auth_account_id() and auth_is_manager_plus());
