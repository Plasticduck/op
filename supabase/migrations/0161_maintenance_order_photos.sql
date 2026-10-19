-- Photo attachments on maintenance orders. Paths point into a private bucket
-- (files live under <account_id>/...). Stored as an array on the order row and
-- written at INSERT time by the placer (order UPDATE is manager-only, so there
-- is no post-insert edit path for a regular user).
alter table public.maintenance_orders
  add column if not exists photo_paths text[];

insert into storage.buckets (id, name, public)
values ('maintenance-order-photos', 'maintenance-order-photos', false)
on conflict (id) do nothing;

create policy maintenance_photos_read on storage.objects
  for select using (
    bucket_id = 'maintenance-order-photos'
    and (storage.foldername(name))[1] = auth_account_id()::text
  );
create policy maintenance_photos_insert on storage.objects
  for insert with check (
    bucket_id = 'maintenance-order-photos'
    and (storage.foldername(name))[1] = auth_account_id()::text
  );
