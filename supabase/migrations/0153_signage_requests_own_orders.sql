-- Signage order visibility: a user should see only the orders THEY placed. The
-- single admin (kevan@washlyfe.com) sees every order in the account (the order
-- tracker / fulfillment views). Previously any account member could see all
-- orders for the sites they had access to.
--
-- Note: this only affects order rows. The shared artwork library/catalog is
-- backed by public.signage_artwork (account-wide SELECT), so galleries are
-- unaffected; non-admins additionally keep seeing artwork from their own orders.
drop policy if exists signage_requests_select on public.signage_requests;
create policy signage_requests_select on public.signage_requests
  for select using (
    account_id = auth_account_id()
    and (
      requested_by = auth.uid()
      or lower(coalesce(auth.jwt() ->> 'email', '')) = 'kevan@washlyfe.com'
    )
  );
