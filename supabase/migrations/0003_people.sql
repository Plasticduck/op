-- 0003_people.sql — People / HR module tables.

-- Employees ------------------------------------------------------------------
-- Distinct from `users`: an employee is an HR record at a location and may or
-- may not have an app login. pin_hash backs the Time Clock kiosk (Phase 6).
create table public.employees (
  id            uuid primary key default gen_random_uuid(),
  location_id   uuid not null references public.locations(id) on delete cascade,
  user_id       uuid references public.users(id) on delete set null,
  first_name    text not null,
  last_name     text not null,
  email         text,
  phone         text,
  start_date    date,
  role_title    text,
  uniform_size  text,
  certifications text[],
  hourly_rate   numeric,                 -- drives labor cost estimates
  pin_hash      text,                    -- 4-digit kiosk PIN, hashed (never plaintext)
  status        text not null default 'active' check (status in ('active','inactive')),
  avatar_url    text,
  created_at    timestamptz not null default now()
);
create index on public.employees (location_id, status);

-- Scheduling -----------------------------------------------------------------
create table public.schedules (
  id              uuid primary key default gen_random_uuid(),
  location_id     uuid not null references public.locations(id) on delete cascade,
  week_start_date date not null,
  created_by      uuid references public.users(id) on delete set null,
  published       boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (location_id, week_start_date)
);
create index on public.schedules (location_id, week_start_date);

create table public.shifts (
  id          uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  date        date not null,
  start_time  time not null,
  end_time    time not null,
  role_label  text,
  notes       text
);
create index on public.shifts (schedule_id);
create index on public.shifts (employee_id, date);

create table public.schedule_templates (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  name        text not null,
  shifts      jsonb not null default '[]', -- relative shift defs (day_of_week, times, role)
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on public.schedule_templates (location_id);

-- Time clock -----------------------------------------------------------------
create table public.time_entries (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  clock_in    timestamptz not null,
  clock_out   timestamptz,
  auto_closed boolean not null default false,
  edited_by   uuid references public.users(id) on delete set null,
  edited_at   timestamptz,
  notes       text,
  created_at  timestamptz not null default now()
);
create index on public.time_entries (location_id, clock_in);
create index on public.time_entries (employee_id, clock_in);

-- Reviews --------------------------------------------------------------------
create table public.reviews (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  reviewed_by  uuid references public.users(id) on delete set null,
  review_date  date,
  due_date     date,
  rating       integer check (rating between 1 and 5),
  notes        text,
  goals        text,
  status       text not null default 'scheduled' check (status in ('scheduled','completed')),
  created_at   timestamptz not null default now()
);
create index on public.reviews (employee_id);

-- Counseling -----------------------------------------------------------------
create table public.counseling_records (
  id                   uuid primary key default gen_random_uuid(),
  employee_id          uuid not null references public.employees(id) on delete cascade,
  recorded_by          uuid references public.users(id) on delete set null,
  date                 date not null,
  type                 text not null check (type in ('verbal','written','final','pip')),
  description          text,
  employee_acknowledged boolean not null default false,
  acknowledged_at      timestamptz,
  created_at           timestamptz not null default now()
);
create index on public.counseling_records (employee_id);

-- Injury reports -------------------------------------------------------------
create table public.injury_reports (
  id                        uuid primary key default gen_random_uuid(),
  employee_id               uuid not null references public.employees(id) on delete cascade,
  location_id               uuid not null references public.locations(id) on delete cascade,
  reported_by               uuid references public.users(id) on delete set null,
  incident_date             date not null,
  description               text,
  body_part_affected        text,
  medical_treatment_required boolean not null default false,
  witness_names             text,
  created_at                timestamptz not null default now()
);
create index on public.injury_reports (location_id, incident_date);
create index on public.injury_reports (employee_id);

-- Uniform requests -----------------------------------------------------------
create table public.uniform_requests (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  item         text not null,
  size         text,
  quantity     numeric not null default 1,
  status       text not null default 'pending' check (status in ('pending','ordered','fulfilled')),
  requested_at timestamptz not null default now(),
  fulfilled_at timestamptz
);
create index on public.uniform_requests (employee_id, status);
