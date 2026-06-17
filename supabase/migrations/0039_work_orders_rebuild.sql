-- 0039_work_orders_rebuild.sql
--
-- Wipe-and-replace rebuild of the Work Orders system to match MaintainX's
-- model. The old tables (work_orders + work_order_parts) are dropped; the new
-- model adds: numbered WOs, sub-WOs, multi-assignee, work type, priority,
-- recurrence, due/start dates, categories (many-to-many), vendors (m2m),
-- photos + files, time entries, other costs, comments + activity log.
--
-- Existing data on these tables is intentionally not preserved per user
-- direction. Account/Location/Equipment/Parts inventory rows are untouched.

drop table if exists public.work_order_parts cascade;
drop table if exists public.work_orders cascade;

-- ---- Categories ----------------------------------------------------------
-- MaintainX-style: Damage / Electrical / Inspection / Mechanical / Preventive
-- / etc. Each account picks its own. Color + icon let the WO list and
-- category page render them visually.

create table public.work_order_categories (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name       text not null,
  color      text not null default '#2563eb',
  icon       text,
  created_at timestamptz not null default now(),
  unique (account_id, name)
);

alter table public.work_order_categories enable row level security;
create policy wo_cat_select on public.work_order_categories for select
  using (account_id = public.auth_account_id());
create policy wo_cat_write on public.work_order_categories for all
  using (account_id = public.auth_account_id() and public.auth_is_manager_plus())
  with check (account_id = public.auth_account_id() and public.auth_is_manager_plus());

-- ---- Vendors -------------------------------------------------------------
-- Parts suppliers, service contractors, etc. Used by Work Orders and (later)
-- by Parts as the "Ordering Part Number" supplier reference.

create table public.vendors (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name       text not null,
  kind       text not null default 'service' check (kind in ('parts_supplier','service','both','other')),
  email      text,
  phone      text,
  address    text,
  website    text,
  notes      text,
  created_at timestamptz not null default now(),
  unique (account_id, name)
);

create table public.vendor_contacts (
  id         uuid primary key default gen_random_uuid(),
  vendor_id  uuid not null references public.vendors(id) on delete cascade,
  name       text not null,
  email      text,
  phone      text,
  role_title text,
  created_at timestamptz not null default now()
);

alter table public.vendors enable row level security;
alter table public.vendor_contacts enable row level security;
create policy vendors_select on public.vendors for select
  using (account_id = public.auth_account_id());
create policy vendors_write on public.vendors for all
  using (account_id = public.auth_account_id() and public.auth_is_manager_plus())
  with check (account_id = public.auth_account_id() and public.auth_is_manager_plus());
create policy vc_select on public.vendor_contacts for select
  using (exists (select 1 from public.vendors v where v.id = vendor_id and v.account_id = public.auth_account_id()));
create policy vc_write on public.vendor_contacts for all
  using (exists (select 1 from public.vendors v where v.id = vendor_id and v.account_id = public.auth_account_id() and public.auth_is_manager_plus()))
  with check (exists (select 1 from public.vendors v where v.id = vendor_id and v.account_id = public.auth_account_id() and public.auth_is_manager_plus()));

-- ---- Work Orders ---------------------------------------------------------

create sequence public.work_orders_number_seq;

create table public.work_orders (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts(id) on delete cascade,
  location_id          uuid not null references public.locations(id) on delete restrict,
  number               int  not null default nextval('public.work_orders_number_seq'),
  title                text not null,
  description          text,
  status               text not null default 'open'
                       check (status in ('open','on_hold','in_progress','done','skipped')),
  priority             text not null default 'none'
                       check (priority in ('none','low','medium','high')),
  work_type            text not null default 'reactive'
                       check (work_type in ('reactive','preventive','inspection','project','other')),
  recurrence           text not null default 'none'
                       check (recurrence in ('none','daily','weekly','biweekly','monthly','quarterly','yearly','custom')),
  recurrence_interval  int,
  recurrence_unit      text check (recurrence_unit in ('day','week','month','year') or recurrence_unit is null),
  estimated_minutes    int,
  due_at               timestamptz,
  start_at             timestamptz,
  equipment_id         uuid references public.equipment(id) on delete set null,
  parent_work_order_id uuid references public.work_orders(id) on delete cascade,
  requested_by         uuid references public.users(id) on delete set null,
  requested_by_name    text,
  created_by           uuid references public.users(id) on delete set null,
  created_by_name      text,
  completed_at         timestamptz,
  completed_by         uuid references public.users(id) on delete set null,
  completed_by_name    text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (account_id, number)
);

create index on public.work_orders (account_id, status);
create index on public.work_orders (account_id, location_id);
create index on public.work_orders (parent_work_order_id);

alter table public.work_orders enable row level security;
create policy wo_select on public.work_orders for select
  using (account_id = public.auth_account_id() and public.auth_has_location(location_id));
create policy wo_insert on public.work_orders for insert
  with check (account_id = public.auth_account_id() and public.auth_has_location(location_id));
create policy wo_update on public.work_orders for update
  using (account_id = public.auth_account_id() and public.auth_has_location(location_id))
  with check (account_id = public.auth_account_id() and public.auth_has_location(location_id));
create policy wo_delete on public.work_orders for delete
  using (account_id = public.auth_account_id() and public.auth_is_manager_plus());

-- Bump updated_at on every change so the list view can sort by activity.
create or replace function public.touch_work_order_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger work_orders_touch
before update on public.work_orders
for each row execute function public.touch_work_order_updated_at();

-- ---- Assignees (many-to-many) -------------------------------------------

create table public.work_order_assignees (
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  user_name     text not null,
  assigned_at   timestamptz not null default now(),
  primary key (work_order_id, user_id)
);
create index on public.work_order_assignees (user_id);

alter table public.work_order_assignees enable row level security;
create policy woa_select on public.work_order_assignees for select
  using (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id()));
create policy woa_write on public.work_order_assignees for all
  using (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id() and public.auth_has_location(w.location_id)))
  with check (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id() and public.auth_has_location(w.location_id)));

-- ---- Category + Vendor links --------------------------------------------

create table public.work_order_category_links (
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  category_id   uuid not null references public.work_order_categories(id) on delete cascade,
  primary key (work_order_id, category_id)
);
alter table public.work_order_category_links enable row level security;
create policy wocl_select on public.work_order_category_links for select
  using (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id()));
create policy wocl_write on public.work_order_category_links for all
  using (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id() and public.auth_has_location(w.location_id)))
  with check (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id() and public.auth_has_location(w.location_id)));

create table public.work_order_vendor_links (
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  vendor_id     uuid not null references public.vendors(id) on delete cascade,
  primary key (work_order_id, vendor_id)
);
alter table public.work_order_vendor_links enable row level security;
create policy wovl_select on public.work_order_vendor_links for select
  using (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id()));
create policy wovl_write on public.work_order_vendor_links for all
  using (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id() and public.auth_has_location(w.location_id)))
  with check (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id() and public.auth_has_location(w.location_id)));

-- ---- Parts attached to WOs ----------------------------------------------

create table public.work_order_parts (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  part_id       uuid references public.parts_inventory(id) on delete set null,
  part_name     text not null,
  quantity      numeric not null default 1,
  unit_cost     numeric,
  created_at    timestamptz not null default now()
);
alter table public.work_order_parts enable row level security;
create policy wop_select on public.work_order_parts for select
  using (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id()));
create policy wop_write on public.work_order_parts for all
  using (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id() and public.auth_has_location(w.location_id)))
  with check (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id() and public.auth_has_location(w.location_id)));

-- ---- Time entries (per-person time worked) -------------------------------

create table public.work_order_time_entries (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  user_id       uuid references public.users(id) on delete set null,
  user_name     text not null,
  minutes       int not null,
  hourly_rate   numeric,
  notes         text,
  created_at    timestamptz not null default now()
);
alter table public.work_order_time_entries enable row level security;
create policy wot_select on public.work_order_time_entries for select
  using (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id()));
create policy wot_write on public.work_order_time_entries for all
  using (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id() and public.auth_has_location(w.location_id)))
  with check (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id() and public.auth_has_location(w.location_id)));

-- ---- Other costs ---------------------------------------------------------

create table public.work_order_other_costs (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  description   text not null,
  amount        numeric not null,
  created_at    timestamptz not null default now()
);
alter table public.work_order_other_costs enable row level security;
create policy wooc_select on public.work_order_other_costs for select
  using (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id()));
create policy wooc_write on public.work_order_other_costs for all
  using (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id() and public.auth_has_location(w.location_id)))
  with check (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id() and public.auth_has_location(w.location_id)));

-- ---- Files + photos ------------------------------------------------------

create table public.work_order_files (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  kind          text not null check (kind in ('photo','file')),
  storage_path  text not null,
  file_name     text,
  mime_type     text,
  size_bytes    int,
  uploaded_by   uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
alter table public.work_order_files enable row level security;
create policy wof_select on public.work_order_files for select
  using (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id()));
create policy wof_write on public.work_order_files for all
  using (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id() and public.auth_has_location(w.location_id)))
  with check (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id() and public.auth_has_location(w.location_id)));

-- ---- Comments + activity log --------------------------------------------
-- A single feed: human comments and system events (Created, Status changed,
-- Completed) intermixed in chronological order.

create table public.work_order_comments (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  user_id       uuid references public.users(id) on delete set null,
  user_name     text not null,
  kind          text not null check (kind in ('comment','system')),
  body          text not null,
  attachment_path text,
  created_at    timestamptz not null default now()
);
create index on public.work_order_comments (work_order_id, created_at);

alter table public.work_order_comments enable row level security;
create policy woc_select on public.work_order_comments for select
  using (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id()));
create policy woc_insert on public.work_order_comments for insert
  with check (exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id() and public.auth_has_location(w.location_id)));
create policy woc_delete on public.work_order_comments for delete
  using (
    user_id = auth.uid()
    or exists (select 1 from public.work_orders w where w.id = work_order_id and w.account_id = public.auth_account_id() and public.auth_is_manager_plus())
  );

-- System comments: auto-write on insert + status change + completion.

create or replace function public.wo_log_insert()
returns trigger language plpgsql as $$
begin
  insert into public.work_order_comments (work_order_id, user_id, user_name, kind, body)
  values (
    new.id,
    new.created_by,
    coalesce(new.created_by_name, 'System'),
    'system',
    'Created work order'
  );
  return new;
end $$;
create trigger work_orders_log_insert
after insert on public.work_orders
for each row execute function public.wo_log_insert();

create or replace function public.wo_log_status_change()
returns trigger language plpgsql as $$
declare actor_id uuid := auth.uid(); actor_name text;
begin
  if new.status = old.status then return new; end if;
  select coalesce(u.name, u.email, 'Someone') into actor_name
    from public.users u where u.id = actor_id;
  insert into public.work_order_comments (work_order_id, user_id, user_name, kind, body)
  values (
    new.id,
    actor_id,
    coalesce(actor_name, 'System'),
    'system',
    case new.status
      when 'open' then 'Reopened the work order'
      when 'on_hold' then 'Put the work order on hold'
      when 'in_progress' then 'Started progress on the work order'
      when 'done' then 'Marked as done'
      when 'skipped' then 'Skipped the work order'
      else 'Changed status to ' || new.status
    end
  );
  if new.status = 'done' and old.status <> 'done' then
    new.completed_at := now();
    new.completed_by := actor_id;
    new.completed_by_name := actor_name;
  end if;
  return new;
end $$;
create trigger work_orders_log_status
before update on public.work_orders
for each row execute function public.wo_log_status_change();

-- ---- Storage bucket for WO files + photos -------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('work-order-files', 'work-order-files', false, 20 * 1024 * 1024,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf','application/zip','text/plain'])
on conflict (id) do nothing;

-- Path: {account_id}/{work_order_id}/{uuid}.{ext}
create policy "wo files read" on storage.objects for select
  using (
    bucket_id = 'work-order-files'
    and (storage.foldername(name))[1]::uuid = public.auth_account_id()
  );
create policy "wo files write" on storage.objects for insert
  with check (
    bucket_id = 'work-order-files'
    and (storage.foldername(name))[1]::uuid = public.auth_account_id()
  );
create policy "wo files delete" on storage.objects for delete
  using (
    bucket_id = 'work-order-files'
    and (storage.foldername(name))[1]::uuid = public.auth_account_id()
    and (owner = auth.uid() or public.auth_is_manager_plus())
  );

-- ---- Seed a default category set per account ----------------------------
-- Anyone landing on the new Work Orders page sees something useful instead
-- of an empty Categories list.

insert into public.work_order_categories (account_id, name, color, icon)
select a.id, c.name, c.color, c.icon from public.accounts a
cross join (values
  ('Damage', '#dc2626', 'AlertTriangle'),
  ('Electrical', '#eab308', 'Zap'),
  ('Inspection', '#8b5cf6', 'ClipboardCheck'),
  ('Mechanical', '#94a3b8', 'Wrench'),
  ('Preventive', '#22c55e', 'ShieldCheck'),
  ('Project', '#f97316', 'Briefcase'),
  ('Refrigeration', '#0ea5e9', 'Snowflake'),
  ('Safety', '#ef4444', 'HardHat'),
  ('Standard Operating Procedure', '#64748b', 'BookOpen'),
  ('Vending', '#a855f7', 'Coffee')
) as c(name, color, icon)
on conflict do nothing;
