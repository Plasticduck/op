-- IT Inventory, Phase 1 assets (2026-10-30). See 0181_it_core.sql and
-- docs/it-inventory/PLAN.md.

-- ---- Tag pool ----------------------------------------------------------------
-- Every sticker tag the account has: generated when an asset is added without
-- one, pre-printed in a batch for a sticker order, imported, or typed by hand.
-- A tag only moves forward (unused -> applied -> retired, and back to applied
-- only for the same asset if it's restored), so a tag is never reused.

create table if not exists public.it_asset_tags (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  tag             text not null check (tag ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'),
  status          text not null default 'unused' check (status in ('unused', 'applied', 'retired')),
  source          text not null default 'generated' check (source in ('generated', 'imported', 'pre_printed', 'manual')),
  batch_id        uuid,
  asset_id        uuid, -- references it_assets, added below
  location_id     uuid references public.locations(id) on delete set null,
  printed_count   integer not null default 0,
  last_printed_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.users(id) on delete set null default auth.uid(),
  unique (account_id, tag)
);
create index if not exists it_asset_tags_batch_idx on public.it_asset_tags (batch_id) where batch_id is not null;
create trigger it_asset_tags_touch before update on public.it_asset_tags
  for each row execute function public.it_touch();

create or replace function public.it_asset_tags_guard()
returns trigger language plpgsql as $$
begin
  if new.tag is distinct from old.tag or new.account_id is distinct from old.account_id then
    raise exception 'A tag can''t be renamed';
  end if;
  if old.status <> 'unused' and new.status = 'unused' then
    raise exception 'Tag % has been used and can''t go back to the unused pool', old.tag;
  end if;
  -- Clearing asset_id is the asset being deleted (FK set null); anything else
  -- would move a tag between assets.
  if old.asset_id is not null and new.asset_id is not null and new.asset_id <> old.asset_id then
    raise exception 'Tag % belongs to another asset', old.tag;
  end if;
  return new;
end $$;
create trigger it_asset_tags_guard_trg before update on public.it_asset_tags
  for each row execute function public.it_asset_tags_guard();

alter table public.it_asset_tags enable row level security;
create policy it_asset_tags_select on public.it_asset_tags
  for select using (account_id = auth_account_id());
create policy it_asset_tags_insert on public.it_asset_tags
  for insert with check (account_id = auth_account_id() and it_is_staff() and status = 'unused');
create policy it_asset_tags_update on public.it_asset_tags
  for update using (account_id = auth_account_id() and it_is_staff())
  with check (account_id = auth_account_id() and it_is_staff());
-- Only never-used tags can be removed (a bad import or a mistyped batch).
create policy it_asset_tags_delete on public.it_asset_tags
  for delete using (account_id = auth_account_id() and it_is_admin() and status = 'unused');

-- Next free tag for an account (and site, when per-site prefixes are on).
-- Internal: called only from security definer code.
create or replace function public.it_next_tag(p_account uuid, p_location uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  s         public.it_settings%rowtype;
  v_prefix  text;
  n         bigint;
  candidate text;
begin
  select * into s from public.it_settings where account_id = p_account;
  if not found then
    raise exception 'IT Inventory isn''t set up for this account yet';
  end if;
  v_prefix := s.tag_prefix;
  if s.use_site_prefix and p_location is not null then
    v_prefix := coalesce(nullif(s.site_prefixes ->> p_location::text, ''), s.tag_prefix);
  end if;
  loop
    insert into public.it_tag_counters as c (account_id, prefix, last_value)
    values (p_account, v_prefix, 1)
    on conflict (account_id, prefix) do update set last_value = c.last_value + 1
    returning last_value into n;
    candidate := v_prefix || '-' || lpad(n::text, s.tag_padding, '0');
    -- Skip numbers already taken by a typed or imported tag.
    exit when not exists (select 1 from public.it_asset_tags where account_id = p_account and tag = candidate);
  end loop;
  return candidate;
end $$;
revoke all on function public.it_next_tag(uuid, uuid) from public, anon, authenticated;

-- ---- Assets --------------------------------------------------------------------

create table if not exists public.it_assets (
  id                       uuid primary key default gen_random_uuid(),
  account_id               uuid not null references public.accounts(id) on delete cascade,
  location_id              uuid not null references public.locations(id) on delete restrict,
  area_id                  uuid references public.it_site_areas(id) on delete set null,
  -- Leave empty to get the next generated tag.
  asset_tag                text not null,
  name                     text not null,
  model_id                 uuid references public.it_asset_models(id) on delete set null,
  category_id              uuid not null references public.it_categories(id) on delete restrict,
  serial                   text,
  status_label_id          uuid not null references public.it_status_labels(id) on delete restrict,
  -- Who or where it's checked out to. Kept in step with it_assignments by
  -- trigger; 'user' points at employees.id (the site roster).
  assigned_type            text check (assigned_type in ('site', 'area', 'user', 'asset')),
  assigned_id              uuid,
  assigned_label           text,
  parent_asset_id          uuid references public.it_assets(id) on delete set null,
  purchase_date            date,
  purchase_cost            numeric(12, 2),
  supplier_id              uuid references public.it_suppliers(id) on delete set null,
  order_number             text,
  warranty_end_date        date,
  -- False = warranty_end_date follows purchase_date + the model's warranty.
  warranty_end_manual      boolean not null default false,
  eol_date                 date,
  ip_address               inet,
  mac_address              macaddr,
  hostname                 text,
  monitoring_enabled       boolean not null default false,
  monitor_method           text not null default 'none' check (monitor_method in ('none', 'heartbeat', 'ping', 'tcp', 'http')),
  monitor_target           text,
  monitor_interval_seconds integer not null default 120 check (monitor_interval_seconds between 30 and 86400),
  last_seen_at             timestamptz,
  health_state             text not null default 'unknown' check (health_state in ('unknown', 'online', 'degraded', 'offline')),
  health_changed_at        timestamptz,
  next_audit_date          date,
  last_audit_at            timestamptz,
  sticker_condition        text not null default 'unknown' check (sticker_condition in ('ok', 'faded', 'missing', 'unknown')),
  sticker_last_verified_at timestamptz,
  custom_values            jsonb not null default '{}'::jsonb,
  notes                    text,
  image_path               text,
  deleted_at               timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid references public.users(id) on delete set null default auth.uid(),
  foreign key (account_id, asset_tag) references public.it_asset_tags (account_id, tag),
  check (parent_asset_id is null or parent_asset_id <> id)
);
create index if not exists it_assets_site_idx on public.it_assets (account_id, location_id);
create unique index if not exists it_assets_tag_unq on public.it_assets (account_id, asset_tag);
-- Serial and MAC identify a device; IP never does (it changes).
create unique index if not exists it_assets_serial_unq
  on public.it_assets (account_id, upper(serial)) where serial is not null and deleted_at is null;
create unique index if not exists it_assets_mac_unq
  on public.it_assets (account_id, mac_address) where mac_address is not null and deleted_at is null;
create index if not exists it_assets_name_trgm on public.it_assets using gin (name extensions.gin_trgm_ops);
create index if not exists it_assets_serial_trgm on public.it_assets using gin (serial extensions.gin_trgm_ops);
create index if not exists it_assets_notes_trgm on public.it_assets using gin (notes extensions.gin_trgm_ops);
create index if not exists it_assets_warranty_idx on public.it_assets (account_id, warranty_end_date);
create index if not exists it_assets_audit_idx on public.it_assets (account_id, next_audit_date);
create index if not exists it_assets_parent_idx on public.it_assets (parent_asset_id) where parent_asset_id is not null;

alter table public.it_asset_tags
  add constraint it_asset_tags_asset_fk foreign key (asset_id) references public.it_assets(id) on delete set null;

create trigger it_assets_touch before update on public.it_assets
  for each row execute function public.it_touch();

-- Fill in what the model, settings and tag pool decide, and keep the rules the
-- UI relies on true however the row is written.
create or replace function public.it_assets_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m       public.it_asset_models%rowtype;
  s       public.it_settings%rowtype;
  t       public.it_asset_tags%rowtype;
  st_type text;
  months  integer;
begin
  -- This runs before RLS checks the row, with owner rights, so stop a write
  -- into another account here rather than after doing work on its behalf.
  if auth.uid() is not null and new.account_id is distinct from auth_account_id() then
    raise exception 'new row violates row-level security policy for table "it_assets"' using errcode = '42501';
  end if;
  select * into s from public.it_settings where account_id = new.account_id;
  if not found then
    raise exception 'IT Inventory isn''t set up for this account yet';
  end if;
  if not exists (select 1 from public.locations where id = new.location_id and account_id = new.account_id) then
    raise exception 'That site isn''t part of this account';
  end if;
  if new.area_id is not null
     and not exists (select 1 from public.it_site_areas where id = new.area_id and location_id = new.location_id) then
    if tg_op = 'UPDATE' and new.location_id is distinct from old.location_id then
      new.area_id := null; -- moved to another site: the old site's area no longer applies
    else
      raise exception 'That area isn''t at this site';
    end if;
  end if;
  if new.parent_asset_id is not null
     and not exists (select 1 from public.it_assets where id = new.parent_asset_id and account_id = new.account_id) then
    raise exception 'Unknown parent asset';
  end if;

  if new.model_id is not null then
    select * into m from public.it_asset_models where id = new.model_id and account_id = new.account_id;
    if not found then
      raise exception 'Unknown model';
    end if;
    -- The model decides the category (denormalized for filtering).
    if tg_op = 'INSERT' or new.model_id is distinct from old.model_id then
      new.category_id := m.category_id;
    end if;
  end if;
  if not exists (select 1 from public.it_categories where id = new.category_id and account_id = new.account_id) then
    raise exception 'Unknown category';
  end if;

  new.name := coalesce(nullif(btrim(coalesce(new.name, '')), ''), nullif(btrim(coalesce(m.name, '')), ''));
  if new.name is null then
    raise exception 'Give it a name or pick a model' using errcode = '23502';
  end if;
  new.serial := nullif(btrim(coalesce(new.serial, '')), '');
  new.hostname := nullif(btrim(coalesce(new.hostname, '')), '');

  if new.status_label_id is null then
    select id into new.status_label_id from public.it_status_labels
     where account_id = new.account_id and is_default and deleted_at is null;
  end if;
  select type into st_type from public.it_status_labels where id = new.status_label_id and account_id = new.account_id;
  if st_type is null then
    raise exception 'Unknown status';
  end if;

  -- Warranty follows purchase date + the model's warranty unless typed in.
  if tg_op = 'INSERT' or new.warranty_end_date is distinct from old.warranty_end_date then
    new.warranty_end_manual := new.warranty_end_date is not null;
  end if;
  if not new.warranty_end_manual then
    new.warranty_end_date := case
      when new.purchase_date is not null and m.default_warranty_months is not null
      then (new.purchase_date + make_interval(months => m.default_warranty_months))::date
    end;
  end if;
  if new.eol_date is null and new.purchase_date is not null and m.eol_months is not null then
    new.eol_date := (new.purchase_date + make_interval(months => m.eol_months))::date;
  end if;

  if tg_op = 'INSERT' then
    if new.next_audit_date is null then
      select coalesce(c.audit_interval_months, s.audit_interval_months) into months
        from public.it_categories c where c.id = new.category_id;
      new.next_audit_date := (current_date + make_interval(months => coalesce(months, s.audit_interval_months)))::date;
    end if;

    new.asset_tag := nullif(upper(btrim(coalesce(new.asset_tag, ''))), '');
    if new.asset_tag is null then
      new.asset_tag := public.it_next_tag(new.account_id, new.location_id);
      insert into public.it_asset_tags (account_id, tag, status, source, location_id)
      values (new.account_id, new.asset_tag, 'applied', 'generated', new.location_id);
    else
      select * into t from public.it_asset_tags
       where account_id = new.account_id and tag = new.asset_tag for update;
      if not found then
        insert into public.it_asset_tags (account_id, tag, status, source, location_id)
        values (new.account_id, new.asset_tag, 'applied', 'manual', new.location_id);
      elsif t.status = 'unused' then
        -- Locked above; it_assets_after marks it applied and links it in one
        -- update, so the tag_applied log row carries the asset.
        null;
      else
        raise exception 'Tag % is already on another asset', new.asset_tag using errcode = '23505';
      end if;
    end if;
  elsif new.asset_tag is distinct from old.asset_tag then
    raise exception 'An asset''s tag can''t change. Print a replacement sticker with the same tag instead.';
  end if;

  return new;
end $$;
create trigger it_assets_before_trg before insert or update on public.it_assets
  for each row execute function public.it_assets_before();

-- Keep the tag row in step: linked to its asset, retired while the asset is
-- archived or deleted.
create or replace function public.it_assets_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  retired boolean;
begin
  if tg_op = 'DELETE' then
    update public.it_asset_tags set status = 'retired'
     where account_id = old.account_id and tag = old.asset_tag and status <> 'retired';
    return old;
  end if;
  retired := new.deleted_at is not null
    or (select type from public.it_status_labels where id = new.status_label_id) = 'archived';
  update public.it_asset_tags
     set asset_id = new.id,
         location_id = new.location_id,
         status = case when retired then 'retired' else 'applied' end
   where account_id = new.account_id and tag = new.asset_tag
     and (asset_id is distinct from new.id
          or location_id is distinct from new.location_id
          or status <> case when retired then 'retired' else 'applied' end);
  return new;
end $$;
create trigger it_assets_after_trg after insert or update or delete on public.it_assets
  for each row execute function public.it_assets_after();

alter table public.it_assets enable row level security;
create policy it_assets_select on public.it_assets
  for select using (account_id = auth_account_id() and it_can_read(location_id));
create policy it_assets_insert on public.it_assets
  for insert with check (account_id = auth_account_id() and it_can_write(location_id));
create policy it_assets_update on public.it_assets
  for update using (account_id = auth_account_id() and it_can_write(location_id))
  with check (account_id = auth_account_id() and it_can_write(location_id));
-- Day to day, assets are archived (soft deleted); hard delete is owner-only.
create policy it_assets_delete on public.it_assets
  for delete using (account_id = auth_account_id() and it_is_admin());

-- Child rows carry their asset's site so RLS can check it without a join.
create or replace function public.it_child_set_site()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  loc uuid;
begin
  select location_id into loc from public.it_assets where id = new.asset_id and account_id = new.account_id;
  if loc is null then
    raise exception 'Unknown asset';
  end if;
  new.location_id := loc;
  return new;
end $$;

-- ---- Check-out history ------------------------------------------------------------

create table if not exists public.it_assignments (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  location_id        uuid not null references public.locations(id) on delete cascade,
  asset_id           uuid not null references public.it_assets(id) on delete cascade,
  assigned_type      text not null check (assigned_type in ('site', 'area', 'user', 'asset')),
  assigned_id        uuid not null,
  assigned_label     text,
  checked_out_at     timestamptz not null default now(),
  checked_out_by     uuid references public.users(id) on delete set null default auth.uid(),
  expected_return_at timestamptz,
  checked_in_at      timestamptz,
  checked_in_by      uuid references public.users(id) on delete set null,
  note               text,
  checkin_note       text,
  signature_path     text,
  photo_path         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.users(id) on delete set null default auth.uid()
);
create unique index if not exists it_assignments_open_unq on public.it_assignments (asset_id) where checked_in_at is null;
create index if not exists it_assignments_asset_idx on public.it_assignments (asset_id, checked_out_at desc);
create trigger it_assignments_touch before update on public.it_assignments
  for each row execute function public.it_touch();

-- Only deployable gear goes out, it can't go out twice, and the target has to
-- be real and in this account. The label is captured for lists and history.
create or replace function public.it_assignments_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a   public.it_assets%rowtype;
  st  public.it_status_labels%rowtype;
begin
  if auth.uid() is not null and new.account_id is distinct from auth_account_id() then
    raise exception 'new row violates row-level security policy for table "it_assignments"' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.checked_in_at is not null then
      raise exception 'This check-out is closed';
    end if;
    if new.asset_id <> old.asset_id or new.assigned_type <> old.assigned_type or new.assigned_id <> old.assigned_id then
      raise exception 'Check it in and out again to change who has it';
    end if;
    if new.checked_in_at is not null and new.checked_in_by is null then
      new.checked_in_by := auth.uid();
    end if;
    return new;
  end if;

  select * into a from public.it_assets where id = new.asset_id and account_id = new.account_id;
  if not found or a.deleted_at is not null then
    raise exception 'Unknown asset';
  end if;
  select * into st from public.it_status_labels where id = a.status_label_id;
  if st.type <> 'deployable' then
    raise exception 'This item is %, so it can''t be checked out. Change its status first.', st.name
      using errcode = 'P0001', hint = 'not_deployable';
  end if;
  new.location_id := a.location_id;
  new.checked_in_at := null;

  if new.assigned_type = 'site' then
    select name into new.assigned_label from public.locations where id = new.assigned_id and account_id = new.account_id;
  elsif new.assigned_type = 'area' then
    select name into new.assigned_label from public.it_site_areas
     where id = new.assigned_id and account_id = new.account_id and deleted_at is null;
  elsif new.assigned_type = 'user' then
    select btrim(e.first_name || ' ' || coalesce(e.last_name, '')) into new.assigned_label
      from public.employees e join public.locations l on l.id = e.location_id
     where e.id = new.assigned_id and l.account_id = new.account_id;
  elsif new.assigned_type = 'asset' then
    if new.assigned_id = new.asset_id then
      raise exception 'An item can''t be checked out to itself';
    end if;
    select x.asset_tag || ' ' || x.name into new.assigned_label from public.it_assets x
     where x.id = new.assigned_id and x.account_id = new.account_id and x.deleted_at is null;
  end if;
  if new.assigned_label is null then
    raise exception 'Unknown check-out target';
  end if;
  return new;
end $$;
create trigger it_assignments_before_trg before insert or update on public.it_assignments
  for each row execute function public.it_assignments_before();

create or replace function public.it_assignments_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.it_assets
       set assigned_type = new.assigned_type, assigned_id = new.assigned_id, assigned_label = new.assigned_label,
           parent_asset_id = case when new.assigned_type = 'asset' then new.assigned_id else parent_asset_id end
     where id = new.asset_id;
  elsif old.checked_in_at is null and new.checked_in_at is not null then
    update public.it_assets set assigned_type = null, assigned_id = null, assigned_label = null
     where id = new.asset_id;
  end if;
  return new;
end $$;
create trigger it_assignments_after_trg after insert or update on public.it_assignments
  for each row execute function public.it_assignments_after();

alter table public.it_assignments enable row level security;
create policy it_assignments_select on public.it_assignments
  for select using (account_id = auth_account_id() and it_can_read(location_id));
create policy it_assignments_insert on public.it_assignments
  for insert with check (account_id = auth_account_id() and it_can_write(location_id));
create policy it_assignments_update on public.it_assignments
  for update using (account_id = auth_account_id() and it_can_write(location_id))
  with check (account_id = auth_account_id() and it_can_write(location_id));

-- ---- Maintenance ----------------------------------------------------------------

create table if not exists public.it_maintenance_types (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  color       text not null default 'neutral' check (color in ('ok', 'accent', 'neutral', 'warn', 'danger')),
  sort_order  integer not null default 0,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.users(id) on delete set null default auth.uid()
);
create unique index if not exists it_maintenance_types_name_unq
  on public.it_maintenance_types (account_id, lower(name)) where deleted_at is null;
create trigger it_maintenance_types_touch before update on public.it_maintenance_types
  for each row execute function public.it_touch();
alter table public.it_maintenance_types enable row level security;
create policy it_maintenance_types_select on public.it_maintenance_types for select using (account_id = auth_account_id());
create policy it_maintenance_types_write on public.it_maintenance_types for all
  using (account_id = auth_account_id() and it_is_admin()) with check (account_id = auth_account_id() and it_is_admin());

create table if not exists public.it_maintenances (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  location_id         uuid not null references public.locations(id) on delete cascade,
  asset_id            uuid not null references public.it_assets(id) on delete cascade,
  maintenance_type_id uuid references public.it_maintenance_types(id) on delete set null,
  title               text not null check (btrim(title) <> ''),
  supplier_id         uuid references public.it_suppliers(id) on delete set null,
  is_warranty         boolean not null default false,
  cost                numeric(12, 2),
  start_date          date not null default current_date,
  completion_date     date,
  downtime_minutes    integer check (downtime_minutes >= 0),
  notes               text,
  deleted_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references public.users(id) on delete set null default auth.uid()
);
create index if not exists it_maintenances_asset_idx on public.it_maintenances (asset_id, start_date desc);
create trigger it_maintenances_touch before update on public.it_maintenances
  for each row execute function public.it_touch();
create trigger it_maintenances_site before insert or update of asset_id on public.it_maintenances
  for each row execute function public.it_child_set_site();
alter table public.it_maintenances enable row level security;
create policy it_maintenances_select on public.it_maintenances
  for select using (account_id = auth_account_id() and it_can_read(location_id));
create policy it_maintenances_insert on public.it_maintenances
  for insert with check (account_id = auth_account_id() and it_can_write(location_id));
create policy it_maintenances_update on public.it_maintenances
  for update using (account_id = auth_account_id() and it_can_write(location_id))
  with check (account_id = auth_account_id() and it_can_write(location_id));
create policy it_maintenances_delete on public.it_maintenances
  for delete using (account_id = auth_account_id() and it_is_admin());

-- ---- Health observations ------------------------------------------------------------
-- Raw heartbeats / probe results / manual reports. Pruned after 90 days; state
-- transitions are kept forever in it_activity_log.

create table if not exists public.it_health_events (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  asset_id    uuid not null references public.it_assets(id) on delete cascade,
  observed_at timestamptz not null default now(),
  state       text not null check (state in ('online', 'degraded', 'offline')),
  latency_ms  integer,
  source      text not null check (source in ('heartbeat', 'probe', 'manual')),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.users(id) on delete set null default auth.uid()
);
create index if not exists it_health_events_asset_idx on public.it_health_events (asset_id, observed_at desc);
create trigger it_health_events_site before insert on public.it_health_events
  for each row execute function public.it_child_set_site();
alter table public.it_health_events enable row level security;
create policy it_health_events_select on public.it_health_events
  for select using (account_id = auth_account_id() and it_can_read(location_id));
-- People only record manual reports; heartbeats and probes write with the service role.
create policy it_health_events_insert on public.it_health_events
  for insert with check (account_id = auth_account_id() and it_can_read(location_id) and source = 'manual');

-- ---- Secret custom field values --------------------------------------------------
-- The value lives in Supabase Vault; this row only points at it. No policies:
-- read and write go through it_set_secret() / it_reveal_secret() (0187), which
-- are owner-only and log every reveal.

create table if not exists public.it_asset_secrets (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  asset_id    uuid not null references public.it_assets(id) on delete cascade,
  field_id    uuid not null references public.it_custom_fields(id) on delete cascade,
  secret_id   uuid not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.users(id) on delete set null default auth.uid(),
  unique (asset_id, field_id)
);
alter table public.it_asset_secrets enable row level security;
