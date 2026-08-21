-- Allow re-categorizing library artwork (upsert of sign_category). Without an
-- UPDATE policy the "Add from library" upsert's conflict-update path is denied by
-- RLS. Scoped to the caller's account, matching the insert policy.
create policy signage_artwork_lib_update on public.signage_artwork
  for update using (account_id = auth_account_id())
  with check (account_id = auth_account_id());
