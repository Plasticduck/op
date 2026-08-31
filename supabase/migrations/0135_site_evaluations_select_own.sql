-- 0135_site_evaluations_select_own.sql — RM Site Reviews are personal to the
-- Regional Manager who filled them out. A reviewer sees only the reviews they
-- submitted; only Admins (owner) can see every review in the account. The other
-- Ops Suite tables keep their account-wide read policy from 0020.
--
-- submitted_by references public.users(id), which equals auth.uid(), so the
-- ownership check is a direct comparison.

drop policy if exists site_evaluations_select on public.site_evaluations;
create policy site_evaluations_select on public.site_evaluations for select
  using (
    account_id = public.auth_account_id()
    and (public.auth_role() = 'owner' or submitted_by = auth.uid())
  );
