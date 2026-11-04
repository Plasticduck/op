-- Drivers assign themselves to a vehicle by scanning the QR sticker on its dash.
--
-- fleet_vehicle_codes: each vehicle's sticker code. The sticker's QR is
-- https://operator.washlyfe.com/v/<code>; the code stands in for the Reveal
-- vehicle number, which is often a VIN or a tracker IMEI with spaces and colons.
-- Codes are never reused: a reprinted sticker keeps its vehicle's code.
--
-- fleet_driver_links: which Reveal driver an Operator login is, when their email
-- doesn't match the driver's email in Reveal. Set the first time someone scans
-- (they pick themselves from the unlinked drivers) or when a new driver record is
-- made for them; Admins can undo a link on Fleet Management.
--
-- Both are written only by the fleet-self-assign and fleet-admin edge functions
-- (service role).

create table public.fleet_vehicle_codes (
  code            text primary key check (code ~ '^[2-9A-HJ-NP-Z]{6}$'),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  vehicle_number  text not null,
  created_at      timestamptz not null default now(),
  unique (account_id, vehicle_number)
);

create table public.fleet_driver_links (
  account_id      uuid not null references public.accounts(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  driver_number   text not null,
  source          text not null check (source in ('self', 'created', 'admin')),
  created_at      timestamptz not null default now(),
  primary key (account_id, user_id),
  unique (account_id, driver_number)
);

alter table public.fleet_vehicle_codes enable row level security;
alter table public.fleet_driver_links enable row level security;

create policy fleet_vehicle_codes_select on public.fleet_vehicle_codes
  for select using (account_id = public.auth_account_id() and public.auth_role() = 'owner');
create policy fleet_driver_links_select on public.fleet_driver_links
  for select using (
    account_id = public.auth_account_id()
    and (user_id = auth.uid() or public.auth_role() = 'owner')
  );
revoke insert, update, delete on public.fleet_vehicle_codes from authenticated, anon;
revoke insert, update, delete on public.fleet_driver_links from authenticated, anon;

-- Self-assignment and driver links in the Fleet Management change log.
alter table public.fleet_changes drop constraint if exists fleet_changes_action_check;
alter table public.fleet_changes add constraint fleet_changes_action_check check (action in (
  'driver_added', 'driver_edited', 'driver_removed',
  'vehicle_edited', 'odometer_set', 'assigned', 'unassigned',
  'linked', 'unlinked', 'stickers_printed'));
