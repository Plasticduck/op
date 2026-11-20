-- More than one address can make up a single site: MW34 is three car washes in
-- Hereford and MW33 two in Dalhart, each still one site everywhere else (reports,
-- schedules, dropdowns). The site's main address stays on locations; the others live
-- here. They put pins on the maps, count toward Site Visits and the RM review
-- vehicle check, and let the time clock geofence accept a punch at any of them.
create table public.location_addresses (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  address text not null check (btrim(address) <> ''),
  latitude numeric,
  longitude numeric,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null
);
create index location_addresses_location_idx on public.location_addresses (location_id);

alter table public.location_addresses enable row level security;

-- Seen by whoever can see the site (the locations policies decide that).
create policy location_addresses_select on public.location_addresses for select
  using (account_id = auth_account_id()
         and exists (select 1 from public.locations l where l.id = location_addresses.location_id));

-- Changed by Admins, as the site itself is, and only on a site of their account.
create policy location_addresses_insert on public.location_addresses for insert
  with check (account_id = auth_account_id() and auth_role() = 'owner'
              and exists (select 1 from public.locations l where l.id = location_addresses.location_id and l.account_id = auth_account_id()));
create policy location_addresses_update on public.location_addresses for update
  using (account_id = auth_account_id() and auth_role() = 'owner')
  with check (account_id = auth_account_id() and auth_role() = 'owner'
              and exists (select 1 from public.locations l where l.id = location_addresses.location_id and l.account_id = auth_account_id()));
create policy location_addresses_delete on public.location_addresses for delete
  using (account_id = auth_account_id() and auth_role() = 'owner');

-- Mighty Wash: Hereford (MW34) and Dalhart (MW33). Coordinates geocoded from the
-- addresses (OpenStreetMap, checked against a second geocoder).
insert into public.location_addresses (account_id, location_id, address, latitude, longitude, created_by)
select l.account_id, l.id, v.address, v.lat, v.lng, null
from (values
  ('MW34', '407 S 25 Mile Ave, Hereford, TX 79045', 34.814673, -102.405836),
  ('MW34', '701 S 25 Mile Ave, Hereford, TX 79045', 34.818574, -102.405792),
  ('MW33', '702 N Elm St, Dalhart, TX 79022', 36.067776, -102.524371)
) as v(site, address, lat, lng)
join public.locations l on l.name = v.site and l.account_id = '54f3e299-1f61-4ed2-9921-3d02160b72e6';
