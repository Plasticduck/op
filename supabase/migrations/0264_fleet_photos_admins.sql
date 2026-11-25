-- Truck photos can also be added and changed from Fleet Management's vehicle edit
-- (Kevan, 2026-11-25). Fleet Management is for every Admin of the account, so the
-- photos are open to them as well as to the Fleet Map's people (migration 0263).

create or replace function public.fleet_photos_can_use()
returns boolean
language sql stable set search_path = public as $$
  select public.fleet_map_can_use() or public.auth_role() = 'owner'
$$;
revoke all on function public.fleet_photos_can_use() from public, anon;
grant execute on function public.fleet_photos_can_use() to authenticated;

drop policy fleet_vehicle_photos_select on public.fleet_vehicle_photos;
create policy fleet_vehicle_photos_select on public.fleet_vehicle_photos for select
  using (account_id = auth_account_id() and public.fleet_photos_can_use());
drop policy fleet_vehicle_photos_insert on public.fleet_vehicle_photos;
create policy fleet_vehicle_photos_insert on public.fleet_vehicle_photos for insert
  with check (account_id = auth_account_id() and public.fleet_photos_can_use()
              and path like account_id::text || '/%');
drop policy fleet_vehicle_photos_update on public.fleet_vehicle_photos;
create policy fleet_vehicle_photos_update on public.fleet_vehicle_photos for update
  using (account_id = auth_account_id() and public.fleet_photos_can_use())
  with check (account_id = auth_account_id() and public.fleet_photos_can_use()
              and path like account_id::text || '/%');
drop policy fleet_vehicle_photos_delete on public.fleet_vehicle_photos;
create policy fleet_vehicle_photos_delete on public.fleet_vehicle_photos for delete
  using (account_id = auth_account_id() and public.fleet_photos_can_use());

drop policy if exists "fleet photos read" on storage.objects;
create policy "fleet photos read" on storage.objects for select
  using (bucket_id = 'fleet-photos' and (storage.foldername(name))[1] = auth_account_id()::text and public.fleet_photos_can_use());
drop policy if exists "fleet photos write" on storage.objects;
create policy "fleet photos write" on storage.objects for insert
  with check (bucket_id = 'fleet-photos' and (storage.foldername(name))[1] = auth_account_id()::text and public.fleet_photos_can_use());
drop policy if exists "fleet photos delete" on storage.objects;
create policy "fleet photos delete" on storage.objects for delete
  using (bucket_id = 'fleet-photos' and (storage.foldername(name))[1] = auth_account_id()::text and public.fleet_photos_can_use());
