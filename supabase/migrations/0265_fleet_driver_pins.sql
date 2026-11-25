-- Driver Assignment app (operator.washlyfe.com/driverassignment, Kevan 2026-11-25).
-- Every Reveal driver gets a 4-digit PIN. A driver opens the app, enters their PIN
-- and scans the QR sticker on a vehicle's dash, and is put on that vehicle in
-- Verizon Connect, with no Operator login (the driver-assign function).
--
-- Admins see and change PINs in Fleet Management (fleet-admin), so they're kept as
-- written rather than hashed. Both tables are RLS-locked with no policies: only those
-- two functions, with the service role, read or write them.

create table public.fleet_driver_pins (
  account_id uuid not null references public.accounts(id) on delete cascade,
  driver_number text not null,
  pin text not null check (pin ~ '^[0-9]{4}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (account_id, driver_number),
  -- The PIN alone says who the driver is, so no two drivers share one.
  unique (account_id, pin)
);
alter table public.fleet_driver_pins enable row level security;

-- Wrong PINs, to cap guessing per address and overall (as the Secret Shopper app does).
create table public.fleet_driver_bad_pins (
  id bigint generated always as identity primary key,
  ip text not null,
  at timestamptz not null default now()
);
create index fleet_driver_bad_pins_at_idx on public.fleet_driver_bad_pins (at);
create index fleet_driver_bad_pins_ip_at_idx on public.fleet_driver_bad_pins (ip, at);
alter table public.fleet_driver_bad_pins enable row level security;

-- Fleet Management's history also shows PINs being handed out or changed.
alter table public.fleet_changes drop constraint fleet_changes_action_check;
alter table public.fleet_changes add constraint fleet_changes_action_check check (action = any (array[
  'driver_added', 'driver_edited', 'driver_removed', 'vehicle_edited', 'odometer_set', 'assigned', 'unassigned',
  'linked', 'unlinked', 'stickers_printed', 'pin_set', 'pins_assigned'
]));
