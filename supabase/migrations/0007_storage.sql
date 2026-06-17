-- 0007_storage.sql — Storage buckets + object policies.
-- Path convention for scoped buckets: "{location_id}/{filename}". The first
-- path segment is the location uuid, used to mirror table RLS.

insert into storage.buckets (id, name, public)
values
  ('documents', 'documents', false),
  ('avatars', 'avatars', true),
  ('injury-evidence', 'injury-evidence', false)
on conflict (id) do nothing;

-- documents: read by anyone with access to the location; write manager+ -------
create policy documents_read on storage.objects
  for select using (
    bucket_id = 'documents'
    and public.auth_has_location(((storage.foldername(name))[1])::uuid)
  );
create policy documents_write on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and public.auth_has_location(((storage.foldername(name))[1])::uuid)
    and public.auth_is_manager_plus()
  );
create policy documents_modify on storage.objects
  for update using (
    bucket_id = 'documents'
    and public.auth_has_location(((storage.foldername(name))[1])::uuid)
    and public.auth_is_manager_plus()
  );
create policy documents_delete on storage.objects
  for delete using (
    bucket_id = 'documents'
    and public.auth_has_location(((storage.foldername(name))[1])::uuid)
    and public.auth_is_manager_plus()
  );

-- avatars: public read (bucket is public); authenticated users write ----------
create policy avatars_write on storage.objects
  for insert with check (bucket_id = 'avatars' and auth.uid() is not null);
create policy avatars_modify on storage.objects
  for update using (bucket_id = 'avatars' and auth.uid() is not null);

-- injury-evidence: manager+ only, scoped by location -------------------------
create policy injury_read on storage.objects
  for select using (
    bucket_id = 'injury-evidence'
    and public.auth_has_location(((storage.foldername(name))[1])::uuid)
    and public.auth_is_manager_plus()
  );
create policy injury_write on storage.objects
  for insert with check (
    bucket_id = 'injury-evidence'
    and public.auth_has_location(((storage.foldername(name))[1])::uuid)
    and public.auth_is_manager_plus()
  );
