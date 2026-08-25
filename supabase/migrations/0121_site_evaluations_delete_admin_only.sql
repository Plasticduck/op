-- Restrict deleting monthly site reviews to a single admin (kevan@washlyfe.com),
-- not every owner. Replaces the owner-wide delete policy.
drop policy if exists site_evaluations_delete on public.site_evaluations;
create policy site_evaluations_delete on public.site_evaluations
  for delete using (
    account_id = auth_account_id()
    and lower(coalesce(auth.jwt() ->> 'email', '')) = 'kevan@washlyfe.com'
  );
