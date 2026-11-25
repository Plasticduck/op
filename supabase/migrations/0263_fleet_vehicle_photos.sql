-- Truck photos for the Fleet Map list (Kevan, 2026-11-25). Reveal keeps a Picture
-- per vehicle but doesn't share it through its API, so Operator keeps its own: one
-- photo per Reveal vehicle number, in the private fleet-photos bucket under the
-- account's folder. Seen and changed by whoever can use the Fleet Map (the super
-- admin, or anyone granted the page), the same people reveal-fleet lets in.

create or replace function public.fleet_map_can_use()
returns boolean
language sql stable set search_path = public as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'kevan@washlyfe.com'
      or public.auth_page_granted('/app/fleet-map')
$$;
revoke all on function public.fleet_map_can_use() from public, anon;
grant execute on function public.fleet_map_can_use() to authenticated;

create table public.fleet_vehicle_photos (
  account_id uuid not null references public.accounts(id) on delete cascade,
  vehicle_number text not null check (btrim(vehicle_number) <> ''),
  path text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  primary key (account_id, vehicle_number)
);

alter table public.fleet_vehicle_photos enable row level security;

create policy fleet_vehicle_photos_select on public.fleet_vehicle_photos for select
  using (account_id = auth_account_id() and public.fleet_map_can_use());
create policy fleet_vehicle_photos_insert on public.fleet_vehicle_photos for insert
  with check (account_id = auth_account_id() and public.fleet_map_can_use()
              and path like account_id::text || '/%');
create policy fleet_vehicle_photos_update on public.fleet_vehicle_photos for update
  using (account_id = auth_account_id() and public.fleet_map_can_use())
  with check (account_id = auth_account_id() and public.fleet_map_can_use()
              and path like account_id::text || '/%');
create policy fleet_vehicle_photos_delete on public.fleet_vehicle_photos for delete
  using (account_id = auth_account_id() and public.fleet_map_can_use());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fleet-photos', 'fleet-photos', false, 5 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Files live under <account id>/, so a person only ever touches their account's.
drop policy if exists "fleet photos read" on storage.objects;
create policy "fleet photos read" on storage.objects for select
  using (bucket_id = 'fleet-photos' and (storage.foldername(name))[1] = auth_account_id()::text and public.fleet_map_can_use());
drop policy if exists "fleet photos write" on storage.objects;
create policy "fleet photos write" on storage.objects for insert
  with check (bucket_id = 'fleet-photos' and (storage.foldername(name))[1] = auth_account_id()::text and public.fleet_map_can_use());
drop policy if exists "fleet photos delete" on storage.objects;
create policy "fleet photos delete" on storage.objects for delete
  using (bucket_id = 'fleet-photos' and (storage.foldername(name))[1] = auth_account_id()::text and public.fleet_map_can_use());
