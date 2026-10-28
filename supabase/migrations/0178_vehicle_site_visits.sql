-- Site visits from Verizon Connect Reveal (Mighty Wash vehicle GPS).
--
-- The reveal-visits-sync edge function pulls each vehicle's trips (Reveal
-- segments: ignition on -> ignition off) and records a visit whenever a
-- vehicle parks within a site's geofence (locations.latitude/longitude +
-- geofence_radius_m). Arrival = the trip's end; departure = the next trip's
-- start (null while it is still parked there).
--
-- fleet_people: everyone Reveal attributes trips to. person_key is the Reveal
-- driver number, or 'v:<vehicle number>' for a vehicle with no driver. category
-- (Regional Manager / Maintenance / Other) drives the "last RM / maintenance
-- visit" columns; Regional Managers are pre-tagged from users.role_category.
--
-- Pre-launch: readable only by kevan@washlyfe.com. Writes are service-role
-- only, except the category, which kevan sets on the Site Visits page.

create table public.fleet_people (
  account_id  uuid not null references public.accounts(id) on delete cascade,
  person_key  text not null,
  name        text not null,
  email       text,
  user_id     uuid references public.users(id) on delete set null,
  category    text check (category in ('regional_manager', 'maintenance', 'other')),
  updated_at  timestamptz not null default now(),
  primary key (account_id, person_key)
);

create table public.vehicle_site_visits (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  location_id     uuid not null references public.locations(id) on delete cascade,
  vehicle_number  text not null,
  vehicle_name    text,
  person_key      text,
  person_name     text,
  arrived_at      timestamptz not null,
  departed_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (account_id, vehicle_number, arrived_at)
);
create index vehicle_site_visits_site_idx on public.vehicle_site_visits (account_id, location_id, arrived_at desc);
create index vehicle_site_visits_person_idx on public.vehicle_site_visits (account_id, person_key, arrived_at desc);

alter table public.fleet_people enable row level security;
alter table public.vehicle_site_visits enable row level security;

create policy fleet_people_select on public.fleet_people
  for select using (
    account_id = auth_account_id()
    and lower(coalesce(auth.jwt() ->> 'email', '')) = 'kevan@washlyfe.com'
  );
create policy fleet_people_update on public.fleet_people
  for update using (
    account_id = auth_account_id()
    and lower(coalesce(auth.jwt() ->> 'email', '')) = 'kevan@washlyfe.com'
  );
-- Only the category is editable from the app.
revoke insert, update, delete on public.fleet_people from authenticated, anon;
grant update (category, updated_at) on public.fleet_people to authenticated;

create policy vehicle_site_visits_select on public.vehicle_site_visits
  for select using (
    account_id = auth_account_id()
    and lower(coalesce(auth.jwt() ->> 'email', '')) = 'kevan@washlyfe.com'
  );
revoke insert, update, delete on public.vehicle_site_visits from authenticated, anon;

-- Keep visits current: yesterday + today (Central) every hour.
select cron.schedule(
  'reveal-visits-sync-hourly',
  '25 * * * *',
  $$
  select net.http_post(
    url := 'https://ppwjqifyyihesuoubixk.supabase.co/functions/v1/reveal-visits-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weather_service_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
