-- Fleet Management: a record of every change Operator makes in Verizon Connect
-- Reveal (drivers added, edited or removed, vehicles edited, drivers assigned to
-- or taken off vehicles). Reveal itself is the source of truth; this is the
-- "who did what, when" trail, since several Admins can make changes.
--
-- Written only by the fleet-admin edge function (service role). Admins of the
-- account can read it.

create table public.fleet_changes (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  user_id         uuid references public.users(id) on delete set null,
  user_name       text,
  action          text not null check (action in (
                    'driver_added', 'driver_edited', 'driver_removed',
                    'vehicle_edited', 'odometer_set', 'assigned', 'unassigned')),
  driver_number   text,
  driver_name     text,
  vehicle_number  text,
  vehicle_name    text,
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index fleet_changes_account_idx on public.fleet_changes (account_id, created_at desc);

alter table public.fleet_changes enable row level security;

create policy fleet_changes_select on public.fleet_changes
  for select using (account_id = public.auth_account_id() and public.auth_role() = 'owner');
revoke insert, update, delete on public.fleet_changes from authenticated, anon;
