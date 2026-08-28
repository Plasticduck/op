-- Site Review photos: a private bucket so a reviewer can attach photos to any
-- item on a site review. Path: {account_id}/{draft_id}/{item_id}/{uuid}.{ext};
-- the photo storage paths are kept on the review's answers JSON. Mirrors the
-- asset-photos bucket policy (account-scoped by the first path segment).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-review-photos', 'site-review-photos', false, 15 * 1024 * 1024,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;

create policy "site review photos read" on storage.objects for select
  using (
    bucket_id = 'site-review-photos'
    and (storage.foldername(name))[1]::uuid = public.auth_account_id()
  );
create policy "site review photos write" on storage.objects for insert
  with check (
    bucket_id = 'site-review-photos'
    and (storage.foldername(name))[1]::uuid = public.auth_account_id()
  );
create policy "site review photos delete" on storage.objects for delete
  using (
    bucket_id = 'site-review-photos'
    and (storage.foldername(name))[1]::uuid = public.auth_account_id()
  );
