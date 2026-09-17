-- Restrict invoice deletion to a single admin (kevan@washlyfe.com). Everyone
-- else uses the "Request delete" flow, which emails kevan a link to the invoice
-- (invoice-delete-request edge function). Previously managers could hard-delete
-- non-exported invoices.
drop policy if exists ops_invoices_delete on public.ops_invoices;
create policy ops_invoices_delete on public.ops_invoices
  for delete
  using (
    account_id = auth_account_id()
    and lower(coalesce(auth.jwt() ->> 'email', '')) = 'kevan@washlyfe.com'
  );
