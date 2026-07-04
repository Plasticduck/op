-- 0047_locations_delete_policy.sql
-- Locations were archive-only, so no DELETE policy existed and hard deletes were
-- silently blocked by RLS (0 rows, no error). Allow owners to delete locations,
-- matching the owner-only update policy. Deletion cascades to related rows.

create policy locations_delete on public.locations
  for delete using (account_id = public.auth_account_id() and public.auth_role() = 'owner');
