-- Artwork deletion is now handled exclusively by the signage-artwork-remove edge
-- function (service role), which is locked to a single admin (kevan@washlyfe.com)
-- and also clears the storage file + order references. Drop the client-facing
-- manager+ delete policy so no one can delete library rows directly; with no
-- DELETE policy, RLS denies all deletes except the service role.
drop policy if exists signage_artwork_lib_delete on public.signage_artwork;
