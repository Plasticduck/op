-- 0002_ops.sql — Operations module tables.

-- Checklists -----------------------------------------------------------------
create table public.checklists (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  name        text not null,
  frequency   text not null check (frequency in ('daily','weekly','monthly')),
  due_by      time,                       -- overdue indicator threshold
  created_at  timestamptz not null default now()
);
create index on public.checklists (location_id);

create table public.checklist_items (
  id           uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  label        text not null,
  order_index  integer not null default 0
);
create index on public.checklist_items (checklist_id);

create table public.checklist_completions (
  id            uuid primary key default gen_random_uuid(),
  checklist_id  uuid not null references public.checklists(id) on delete cascade,
  location_id   uuid not null references public.locations(id) on delete cascade,
  completed_by  uuid references public.users(id) on delete set null,
  completed_at  timestamptz not null default now(),
  notes         text
);
create index on public.checklist_completions (checklist_id);
create index on public.checklist_completions (location_id, completed_at);

-- Equipment ------------------------------------------------------------------
create table public.equipment (
  id                uuid primary key default gen_random_uuid(),
  location_id       uuid not null references public.locations(id) on delete cascade,
  name              text not null,
  type              text,
  purchase_date     date,
  warranty_expiry   date,
  last_serviced_at  date,
  service_interval_days integer,
  status            text not null default 'operational'
                      check (status in ('operational','down','maintenance')),
  created_at        timestamptz not null default now()
);
create index on public.equipment (location_id);

-- Parts inventory ------------------------------------------------------------
create table public.parts_inventory (
  id                 uuid primary key default gen_random_uuid(),
  location_id        uuid not null references public.locations(id) on delete cascade,
  name               text not null,
  sku                text,
  quantity_on_hand   numeric not null default 0,
  reorder_threshold  numeric not null default 0,
  unit_cost          numeric not null default 0,
  last_updated_at    timestamptz not null default now()
);
create index on public.parts_inventory (location_id);

-- Work orders ----------------------------------------------------------------
create table public.work_orders (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references public.locations(id) on delete cascade,
  equipment_id uuid references public.equipment(id) on delete set null,
  title        text not null,
  description  text,
  status       text not null default 'open' check (status in ('open','in_progress','closed')),
  priority     text not null default 'medium' check (priority in ('low','medium','high')),
  assigned_to  uuid references public.users(id) on delete set null,
  created_by   uuid references public.users(id) on delete set null,
  labor_cost   numeric not null default 0,
  created_at   timestamptz not null default now(),
  closed_at    timestamptz,
  cost         numeric not null default 0   -- parts + labor; maintained by app/trigger
);
create index on public.work_orders (location_id, status);
create index on public.work_orders (equipment_id);

create table public.work_order_parts (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  part_id       uuid references public.parts_inventory(id) on delete set null,
  part_name     text not null,
  quantity      numeric not null default 1,
  unit_cost     numeric not null default 0
);
create index on public.work_order_parts (work_order_id);

-- Downtime -------------------------------------------------------------------
create table public.downtime_events (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references public.locations(id) on delete cascade,
  equipment_id uuid references public.equipment(id) on delete set null,
  reason       text,
  reason_category text,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  reported_by  uuid references public.users(id) on delete set null
);
create index on public.downtime_events (location_id, started_at);
create index on public.downtime_events (equipment_id);

-- Closeouts ------------------------------------------------------------------
create table public.closeouts (
  id             uuid primary key default gen_random_uuid(),
  location_id    uuid not null references public.locations(id) on delete cascade,
  date           date not null,
  submitted_by   uuid references public.users(id) on delete set null,
  total_sales    numeric not null default 0,
  cash_amount    numeric not null default 0,
  card_amount    numeric not null default 0,
  deposit_amount numeric not null default 0,
  drawer_count   numeric not null default 0,
  notes          text,
  locked         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (location_id, date)             -- one closeout per location per day
);
create index on public.closeouts (location_id, date);

-- Documents ------------------------------------------------------------------
create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  location_id   uuid not null references public.locations(id) on delete cascade,
  name          text not null,
  category      text not null default 'other' check (category in ('sop','sds','policy','other')),
  file_url      text not null,
  version       integer not null default 1,
  archived      boolean not null default false,
  uploaded_by   uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index on public.documents (location_id, category);

-- Contacts -------------------------------------------------------------------
create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  name        text not null,
  company     text,
  phone       text,
  email       text,
  category    text not null default 'other' check (category in ('vendor','supplier','service','other')),
  notes       text,
  created_at  timestamptz not null default now()
);
create index on public.contacts (location_id, category);

-- Supplies requests ----------------------------------------------------------
create table public.supplies_requests (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references public.locations(id) on delete cascade,
  requested_by uuid references public.users(id) on delete set null,
  item         text not null,
  quantity     numeric not null default 1,
  status       text not null default 'pending'
                 check (status in ('pending','approved','ordered','received')),
  notes        text,
  created_at   timestamptz not null default now()
);
create index on public.supplies_requests (location_id, status);
