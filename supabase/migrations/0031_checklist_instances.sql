-- 0031_checklist_instances.sql
--
-- Reshape checklists from "one list per location" to a multi-location template
-- model with daily instances:
--   - checklists: now an account-scoped template with opens/closes times, days
--     of week, and a reset policy. location_id stays nullable for back-compat
--     during the rollout (existing rows get their location pinned to the
--     checklist_locations table via the backfill).
--   - checklist_locations: M:N which sites the template applies to. The user's
--     "all except Spotless" model is just explicit assignment of the desired
--     locations.
--   - checklist_instances: one row per (template, location, instance_date) so
--     each day starts fresh. Daily reset is the default; weekly and manual
--     options are allowed via the reset_policy column on the template.
--   - checklist_item_events: append-only audit log of every check/uncheck
--     toggle. Current state of an item on an instance is derived as the latest
--     event per (instance_id, item_id). This gives managers the full "who
--     checked what when" log the user asked for.
--
-- A SECURITY DEFINER RPC `ensure_checklist_instance` computes today's instance
-- in the LOCATION's local timezone (locations.timezone), respecting
-- days_of_week, and inserts the row if it doesn't exist yet. The UI calls this
-- on read so the daily reset is lazy — no cron required.

-- 1) Extend the template table.
alter table public.checklists
  add column if not exists account_id uuid references public.accounts(id) on delete cascade,
  add column if not exists opens_at_local time not null default '00:00',
  add column if not exists closes_at_local time,
  add column if not exists days_of_week int[] not null default '{0,1,2,3,4,5,6}',
  add column if not exists reset_policy text not null default 'daily',
  add column if not exists description text,
  add column if not exists archived boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'checklists_reset_policy_check') then
    alter table public.checklists
      add constraint checklists_reset_policy_check
      check (reset_policy in ('daily','weekly','manual'));
  end if;
end $$;

-- Backfill account_id from the location-scoped legacy rows so we can later
-- enforce NOT NULL. Existing rows have location_id set; pull the account from
-- the location.
update public.checklists c
  set account_id = l.account_id
  from public.locations l
  where c.location_id = l.id and c.account_id is null;

-- Make location_id nullable now that the M:N table is the source of truth.
alter table public.checklists alter column location_id drop not null;

-- 2) M:N assignment.
create table if not exists public.checklist_locations (
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  location_id  uuid not null references public.locations(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (checklist_id, location_id)
);
create index if not exists checklist_locations_loc_idx on public.checklist_locations (location_id);

-- Backfill assignment table from legacy single-location rows.
insert into public.checklist_locations (checklist_id, location_id)
select id, location_id from public.checklists where location_id is not null
on conflict do nothing;

-- 3) Daily instances.
create table if not exists public.checklist_instances (
  id            uuid primary key default gen_random_uuid(),
  checklist_id  uuid not null references public.checklists(id) on delete cascade,
  location_id   uuid not null references public.locations(id) on delete cascade,
  instance_date date not null,
  opens_at      timestamptz not null,
  closes_at     timestamptz,
  status        text not null default 'open' check (status in ('open','closed','expired')),
  created_at    timestamptz not null default now(),
  unique (checklist_id, location_id, instance_date)
);
create index if not exists checklist_instances_loc_date_idx
  on public.checklist_instances (location_id, instance_date desc);

-- 4) Append-only event log per item.
create table if not exists public.checklist_item_events (
  id            uuid primary key default gen_random_uuid(),
  instance_id   uuid not null references public.checklist_instances(id) on delete cascade,
  item_id       uuid not null references public.checklist_items(id) on delete cascade,
  action        text not null check (action in ('check','uncheck')),
  actor_id      uuid references public.users(id) on delete set null,
  actor_name    text,
  occurred_at   timestamptz not null default now(),
  note          text
);
create index if not exists checklist_item_events_instance_idx
  on public.checklist_item_events (instance_id, item_id, occurred_at desc);

-- 5) RLS. Members of the account read; manager+ writes templates and toggles
-- items via the M:N location gate; owner deletes templates.
alter table public.checklist_locations enable row level security;
alter table public.checklist_instances enable row level security;
alter table public.checklist_item_events enable row level security;

drop policy if exists checklist_locations_select on public.checklist_locations;
create policy checklist_locations_select on public.checklist_locations for select
  using (exists (select 1 from public.checklists c where c.id = checklist_id and c.account_id = public.auth_account_id()));
drop policy if exists checklist_locations_write on public.checklist_locations;
create policy checklist_locations_write on public.checklist_locations for all
  using (exists (select 1 from public.checklists c where c.id = checklist_id and c.account_id = public.auth_account_id() and public.auth_is_manager_plus()))
  with check (exists (select 1 from public.checklists c where c.id = checklist_id and c.account_id = public.auth_account_id() and public.auth_is_manager_plus()));

drop policy if exists checklist_instances_select on public.checklist_instances;
create policy checklist_instances_select on public.checklist_instances for select
  using (public.auth_has_location(location_id));
drop policy if exists checklist_instances_write on public.checklist_instances;
create policy checklist_instances_write on public.checklist_instances for all
  using (public.auth_has_location(location_id) and public.auth_is_manager_plus())
  with check (public.auth_has_location(location_id) and public.auth_is_manager_plus());

drop policy if exists checklist_item_events_select on public.checklist_item_events;
create policy checklist_item_events_select on public.checklist_item_events for select
  using (exists (
    select 1 from public.checklist_instances i
    where i.id = instance_id and public.auth_has_location(i.location_id)
  ));
-- Any account member with location access can record their own check/uncheck
-- (employees toggle items; managers see the log). Guard with the actor match
-- to keep one user from forging events as another.
drop policy if exists checklist_item_events_insert on public.checklist_item_events;
create policy checklist_item_events_insert on public.checklist_item_events for insert
  with check (
    actor_id = auth.uid()
    and exists (
      select 1 from public.checklist_instances i
      where i.id = instance_id and public.auth_has_location(i.location_id)
    )
  );

-- 6) ensure_checklist_instance — lazy creation of today's instance in the
-- location's local timezone. Returns the instance id, or NULL if today isn't
-- in days_of_week.
create or replace function public.ensure_checklist_instance(
  p_checklist_id uuid,
  p_location_id  uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tz           text;
  v_today        date;
  v_dow          int;
  v_opens_local  time;
  v_closes_local time;
  v_days         int[];
  v_archived     boolean;
  v_instance     uuid;
begin
  select coalesce(timezone, 'America/Chicago') into v_tz
    from public.locations where id = p_location_id;

  v_today := ((now() at time zone v_tz))::date;
  v_dow   := extract(dow from v_today)::int;

  select opens_at_local, closes_at_local, days_of_week, archived
    into v_opens_local, v_closes_local, v_days, v_archived
    from public.checklists where id = p_checklist_id;
  if v_archived then return null; end if;
  if not (v_dow = any (v_days)) then return null; end if;

  select id into v_instance
    from public.checklist_instances
    where checklist_id = p_checklist_id
      and location_id = p_location_id
      and instance_date = v_today;
  if v_instance is not null then return v_instance; end if;

  insert into public.checklist_instances (
    checklist_id, location_id, instance_date, opens_at, closes_at, status
  ) values (
    p_checklist_id,
    p_location_id,
    v_today,
    ((v_today::text || ' ' || coalesce(v_opens_local, '00:00')::text)::timestamp at time zone v_tz),
    case
      when v_closes_local is null then null
      else ((v_today::text || ' ' || v_closes_local::text)::timestamp at time zone v_tz)
    end,
    'open'
  ) returning id into v_instance;
  return v_instance;
end $$;

grant execute on function public.ensure_checklist_instance(uuid, uuid) to authenticated;

-- 7) ensure_today_instances — for a given location, materialize today's
-- instances for every active template assigned to it. The UI calls this on
-- entering the per-location daily view.
create or replace function public.ensure_today_instances(p_location_id uuid)
returns setof uuid
language plpgsql security definer set search_path = public as $$
declare
  v_checklist_id uuid;
  v_instance     uuid;
begin
  for v_checklist_id in
    select cl.checklist_id
      from public.checklist_locations cl
      join public.checklists c on c.id = cl.checklist_id
      where cl.location_id = p_location_id and not c.archived
  loop
    v_instance := public.ensure_checklist_instance(v_checklist_id, p_location_id);
    if v_instance is not null then
      return next v_instance;
    end if;
  end loop;
end $$;

grant execute on function public.ensure_today_instances(uuid) to authenticated;

-- 8) Helper view: latest event per (instance, item) — gives the current
-- "checked" state. Used by the per-location daily view for shared state.
create or replace view public.checklist_item_state as
select distinct on (e.instance_id, e.item_id)
  e.instance_id,
  e.item_id,
  e.action = 'check' as checked,
  e.actor_id    as last_actor_id,
  e.actor_name  as last_actor_name,
  e.occurred_at as last_event_at
from public.checklist_item_events e
order by e.instance_id, e.item_id, e.occurred_at desc;

grant select on public.checklist_item_state to authenticated;
