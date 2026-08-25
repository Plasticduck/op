-- Managers can still delete non-exported invoices (e.g. Needs Attention), but
-- deleting an EXPORTED invoice is restricted to a single admin (kevan@washlyfe.com)
-- so an export that already reached accounting can't be removed by anyone else.
drop policy if exists ops_invoices_delete on public.ops_invoices;
create policy ops_invoices_delete on public.ops_invoices
  for delete using (
    account_id = auth_account_id()
    and auth_is_manager_plus()
    and (
      status <> 'exported'
      or lower(coalesce(auth.jwt() ->> 'email', '')) = 'kevan@washlyfe.com'
    )
  );
