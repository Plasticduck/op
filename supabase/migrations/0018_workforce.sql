-- 0018_workforce.sql — time-off requests, calendar events, break tracking,
-- and location coordinates (for the weather outlook).

alter table public.locations
  add column if not exists latitude numeric,
  add column if not exists longitude numeric;

-- Time-off requests ----------------------------------------------------------
create table public.time_off_requests (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references public.locations(id) on delete cascade,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  start_date   date not null,
  end_date     date not null,
  reason       text,
  status       text not null default 'pending' check (status in ('pending','approved','denied')),
  reviewed_by  uuid references public.users(id) on delete set null,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index on public.time_off_requests (location_id, status);
create index on public.time_off_requests (employee_id);

-- Calendar events (manager-authored, location-wide) --------------------------
create table public.calendar_events (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references public.locations(id) on delete cascade,
  title        text not null,
  description  text,
  start_at     timestamptz not null,
  end_at       timestamptz,
  all_day      boolean not null default false,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index on public.calendar_events (location_id, start_at);

-- Breaks (manager-scheduled; employee starts/ends to drive the dash timer) ----
create table public.breaks (
  id              uuid primary key default gen_random_uuid(),
  location_id     uuid not null references public.locations(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  scheduled_start timestamptz not null,
  scheduled_end   timestamptz not null,
  started_at      timestamptz,
  ended_at        timestamptz,
  notes           text,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index on public.breaks (location_id, scheduled_start);
create index on public.breaks (employee_id, scheduled_start);

-- RLS ------------------------------------------------------------------------
alter table public.time_off_requests enable row level security;
alter table public.calendar_events   enable row level security;
alter table public.breaks            enable row level security;

-- Time off: employee sees/creates/cancels their own; manager+ sees & decides.
create policy tor_select on public.time_off_requests
  for select using (
    (public.auth_has_location(location_id) and public.auth_is_manager_plus())
    or employee_id = public.auth_employee_id()
  );
create policy tor_insert on public.time_off_requests
  for insert with check (
    (public.auth_has_location(location_id) and public.auth_is_manager_plus())
    or employee_id = public.auth_employee_id()
  );
create policy tor_update on public.time_off_requests
  for update using (public.auth_has_location(location_id) and public.auth_is_manager_plus())
  with check (public.auth_has_location(location_id) and public.auth_is_manager_plus());
create policy tor_delete on public.time_off_requests
  for delete using (
    (public.auth_has_location(location_id) and public.auth_is_manager_plus())
    or (employee_id = public.auth_employee_id() and status = 'pending')
  );

-- Calendar: everyone at the location reads; manager+ writes.
create policy cal_select on public.calendar_events
  for select using (public.auth_has_location(location_id));
create policy cal_write on public.calendar_events
  for all using (public.auth_has_location(location_id) and public.auth_is_manager_plus())
  with check (public.auth_has_location(location_id) and public.auth_is_manager_plus());

-- Breaks: employee sees & starts/ends their own; manager+ schedules/manages.
create policy brk_select on public.breaks
  for select using (
    (public.auth_has_location(location_id) and public.auth_is_manager_plus())
    or employee_id = public.auth_employee_id()
  );
create policy brk_insert on public.breaks
  for insert with check (public.auth_has_location(location_id) and public.auth_is_manager_plus());
create policy brk_update on public.breaks
  for update using (
    (public.auth_has_location(location_id) and public.auth_is_manager_plus())
    or employee_id = public.auth_employee_id()
  )
  with check (
    (public.auth_has_location(location_id) and public.auth_is_manager_plus())
    or employee_id = public.auth_employee_id()
  );
create policy brk_delete on public.breaks
  for delete using (public.auth_has_location(location_id) and public.auth_is_manager_plus());

-- Seed demo coordinates (Columbia, MO) so the weather widget works out of box.
update public.locations set latitude = 38.9517, longitude = -92.3341
  where id in ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2');
