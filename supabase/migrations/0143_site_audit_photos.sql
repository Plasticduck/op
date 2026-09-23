-- Site Audit photos: a private bucket so an auditor can attach photos to any
-- item on a site audit. Path: {account_id}/{draft_id}/{item_id}/{uuid}.{ext};
-- the photo storage paths are kept on the audit's section columns (per item).
-- Mirrors the site-review-photos bucket (account-scoped by the first path
-- segment). Replaces the old base64-in-DB approach, which capped out ~5 MB.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-audit-photos', 'site-audit-photos', false, 15 * 1024 * 1024,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;

create policy "site audit photos read" on storage.objects for select
  using (
    bucket_id = 'site-audit-photos'
    and (storage.foldername(name))[1]::uuid = public.auth_account_id()
  );
create policy "site audit photos write" on storage.objects for insert
  with check (
    bucket_id = 'site-audit-photos'
    and (storage.foldername(name))[1]::uuid = public.auth_account_id()
  );
create policy "site audit photos delete" on storage.objects for delete
  using (
    bucket_id = 'site-audit-photos'
    and (storage.foldername(name))[1]::uuid = public.auth_account_id()
  );
