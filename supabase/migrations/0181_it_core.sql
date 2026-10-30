-- IT Inventory, Phase 1 core (2026-10-30). Spec: docs/it-inventory/SPEC.md.
-- Codebase decisions: docs/it-inventory/PLAN.md. The spec's "org" is
-- `accounts` and its "site" is `locations`, so site access reuses
-- auth_account_id() / auth_has_location() and behaves like the rest of Operator.
--
-- Roles: owner = owner/admin (everything). manager = site manager (writes for
-- their own sites). technician writes for every site (it already sees all of
-- them). employee = crew (reads their sites; problem reports go through Work
-- Requests). Account settings and the catalog of categories, status labels,
-- custom fields and reminders are owner-only.

create extension if not exists pg_trgm with schema extensions;

-- ---- Access helpers ---------------------------------------------------------

-- Can the caller see rows for this site? A null site is account-wide.
create or replace function public.it_can_read(loc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth_account_id() is not null and (loc is null or auth_has_location(loc))
$$;

-- Can the caller change rows for this site? Owners and technicians: any site
-- in the account. Managers: their own sites. Account-wide rows: owners only.
create or replace function public.it_can_write(loc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(case
    when loc is null then auth_role() = 'owner'
    else auth_role() in ('owner', 'manager', 'technician') and auth_has_location(loc)
  end, false)
$$;

create or replace function public.it_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth_role() = 'owner', false)
$$;

-- People who add gear day to day (and so may add the manufacturers, models and
-- suppliers they run into while doing it).
create or replace function public.it_is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth_role() in ('owner', 'manager', 'technician'), false)
$$;

create or replace function public.it_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---- Account settings -------------------------------------------------------

create table if not exists public.it_settings (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null unique references public.accounts(id) on delete cascade,
  -- Goes in every sticker's QR link: /t/<short_code>/<tag>. Globally unique.
  short_code            text not null unique check (short_code ~ '^[a-z0-9]{2,16}$'),
  tag_prefix            text not null default 'IT' check (tag_prefix ~ '^[A-Z0-9]{1,8}$'),
  tag_padding           integer not null default 6 check (tag_padding between 3 and 10),
  use_site_prefix       boolean not null default false,
  -- { "<location_id>": "LBK3" }; used when use_site_prefix is on.
  site_prefixes         jsonb not null default '{}'::jsonb,
  audit_interval_months integer not null default 6 check (audit_interval_months between 1 and 60),
  audit_warning_days    integer not null default 7 check (audit_warning_days between 0 and 90),
  support_phone         text,
  label_show_logo       boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.users(id) on delete set null default auth.uid()
);
create trigger it_settings_touch before update on public.it_settings
  for each row execute function public.it_touch();
alter table public.it_settings enable row level security;
create policy it_settings_select on public.it_settings
  for select using (account_id = auth_account_id());
create policy it_settings_update on public.it_settings
  for update using (account_id = auth_account_id() and it_is_admin())
  with check (account_id = auth_account_id() and it_is_admin());
-- Rows are created by it_bootstrap() only.

-- Next number per account and prefix. Only touched by security definer code.
create table if not exists public.it_tag_counters (
  account_id uuid not null references public.accounts(id) on delete cascade,
  prefix     text not null,
  last_value bigint not null default 0,
  primary key (account_id, prefix)
);
alter table public.it_tag_counters enable row level security;

-- ---- Label templates --------------------------------------------------------
-- page_spec: { page: {w_mm, h_mm} | null (roll: one label per page),
--              label: {w_mm, h_mm}, cols, rows, margin_top_mm, margin_left_mm,
--              pitch_x_mm, pitch_y_mm }
-- layout:    { style: 'standard' | 'compact' | 'outdoor',
--              show: ['qr','barcode','tag','name','site','phone','logo'] }

create table if not exists public.it_label_templates (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid references public.accounts(id) on delete cascade, -- null = system template
  name         text not null,
  kind         text not null check (kind in ('sheet', 'roll')),
  page_spec    jsonb not null,
  layout       jsonb not null,
  offset_x_mm  numeric(6, 2) not null default 0,
  offset_y_mm  numeric(6, 2) not null default 0,
  scale        numeric(5, 3) not null default 1 check (scale between 0.5 and 1.5),
  is_outdoor   boolean not null default false,
  is_default   boolean not null default false,
  sort_order   integer not null default 0,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.users(id) on delete set null default auth.uid()
);
create trigger it_label_templates_touch before update on public.it_label_templates
  for each row execute function public.it_touch();
alter table public.it_label_templates enable row level security;
create policy it_label_templates_select on public.it_label_templates
  for select using (account_id is null or account_id = auth_account_id());
create policy it_label_templates_insert on public.it_label_templates
  for insert with check (account_id = auth_account_id() and it_is_admin());
-- Staff may calibrate (offsets and scale are per account and template).
create policy it_label_templates_update on public.it_label_templates
  for update using (account_id = auth_account_id() and it_is_staff())
  with check (account_id = auth_account_id() and it_is_staff());
create policy it_label_templates_delete on public.it_label_templates
  for delete using (account_id = auth_account_id() and it_is_admin());

-- ---- Manufacturers, suppliers ----------------------------------------------

create table if not exists public.it_manufacturers (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  name                text not null check (btrim(name) <> ''),
  website             text,
  support_phone       text,
  support_url         text,
  warranty_lookup_url text,
  deleted_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references public.users(id) on delete set null default auth.uid()
);
create unique index if not exists it_manufacturers_name_unq
  on public.it_manufacturers (account_id, lower(name)) where deleted_at is null;
create trigger it_manufacturers_touch before update on public.it_manufacturers
  for each row execute function public.it_touch();
alter table public.it_manufacturers enable row level security;
create policy it_manufacturers_select on public.it_manufacturers
  for select using (account_id = auth_account_id());
create policy it_manufacturers_insert on public.it_manufacturers
  for insert with check (account_id = auth_account_id() and it_is_staff());
create policy it_manufacturers_update on public.it_manufacturers
  for update using (account_id = auth_account_id() and it_is_staff())
  with check (account_id = auth_account_id() and it_is_staff());
create policy it_manufacturers_delete on public.it_manufacturers
  for delete using (account_id = auth_account_id() and it_is_admin());

create table if not exists public.it_suppliers (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  name           text not null check (btrim(name) <> ''),
  contact_name   text,
  phone          text,
  email          text,
  website        text,
  account_number text,
  notes          text,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.users(id) on delete set null default auth.uid()
);
create unique index if not exists it_suppliers_name_unq
  on public.it_suppliers (account_id, lower(name)) where deleted_at is null;
create trigger it_suppliers_touch before update on public.it_suppliers
  for each row execute function public.it_touch();
alter table public.it_suppliers enable row level security;
create policy it_suppliers_select on public.it_suppliers
  for select using (account_id = auth_account_id());
create policy it_suppliers_insert on public.it_suppliers
  for insert with check (account_id = auth_account_id() and it_is_staff());
create policy it_suppliers_update on public.it_suppliers
  for update using (account_id = auth_account_id() and it_is_staff())
  with check (account_id = auth_account_id() and it_is_staff());
create policy it_suppliers_delete on public.it_suppliers
  for delete using (account_id = auth_account_id() and it_is_admin());

-- ---- Custom fields and fieldsets -------------------------------------------

create table if not exists public.it_custom_fields (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts(id) on delete cascade,
  name                  text not null check (btrim(name) <> ''),
  key                   text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  field_type            text not null
                        check (field_type in ('text', 'number', 'date', 'boolean', 'select', 'url', 'ip', 'secret')),
  options               jsonb not null default '[]'::jsonb,
  help_text             text,
  is_required           boolean not null default false,
  show_in_list          boolean not null default false,
  editable_during_audit boolean not null default false,
  sort_order            integer not null default 0,
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.users(id) on delete set null default auth.uid(),
  unique (account_id, key)
);
create trigger it_custom_fields_touch before update on public.it_custom_fields
  for each row execute function public.it_touch();

create table if not exists public.it_fieldsets (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.users(id) on delete set null default auth.uid()
);
create trigger it_fieldsets_touch before update on public.it_fieldsets
  for each row execute function public.it_touch();

create table if not exists public.it_fieldset_fields (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  fieldset_id uuid not null references public.it_fieldsets(id) on delete cascade,
  field_id    uuid not null references public.it_custom_fields(id) on delete cascade,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.users(id) on delete set null default auth.uid(),
  unique (fieldset_id, field_id)
);
create trigger it_fieldset_fields_touch before update on public.it_fieldset_fields
  for each row execute function public.it_touch();

alter table public.it_custom_fields enable row level security;
alter table public.it_fieldsets enable row level security;
alter table public.it_fieldset_fields enable row level security;
create policy it_custom_fields_select on public.it_custom_fields for select using (account_id = auth_account_id());
create policy it_custom_fields_write on public.it_custom_fields for all
  using (account_id = auth_account_id() and it_is_admin()) with check (account_id = auth_account_id() and it_is_admin());
create policy it_fieldsets_select on public.it_fieldsets for select using (account_id = auth_account_id());
create policy it_fieldsets_write on public.it_fieldsets for all
  using (account_id = auth_account_id() and it_is_admin()) with check (account_id = auth_account_id() and it_is_admin());
create policy it_fieldset_fields_select on public.it_fieldset_fields for select using (account_id = auth_account_id());
create policy it_fieldset_fields_write on public.it_fieldset_fields for all
  using (account_id = auth_account_id() and it_is_admin()) with check (account_id = auth_account_id() and it_is_admin());

-- ---- Categories --------------------------------------------------------------

create table if not exists public.it_categories (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts(id) on delete cascade,
  name                  text not null check (btrim(name) <> ''),
  kind                  text not null default 'asset'
                        check (kind in ('asset', 'accessory', 'consumable', 'component', 'subscription')),
  -- Key into the module's curated icon map (src/features/it/inventory/icons.ts).
  icon                  text not null default 'package',
  default_fieldset_id   uuid references public.it_fieldsets(id) on delete set null,
  requires_ip           boolean not null default false,
  default_monitoring    boolean not null default false,
  label_template_id     uuid references public.it_label_templates(id) on delete set null,
  -- Overrides it_settings.audit_interval_months when set (e.g. LPR every 3).
  audit_interval_months integer check (audit_interval_months between 1 and 60),
  -- Minutes offline before alerting (Phase 2 health). Null = never alert.
  alert_delay_minutes   integer check (alert_delay_minutes >= 0),
  sort_order            integer not null default 0,
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.users(id) on delete set null default auth.uid()
);
create unique index if not exists it_categories_name_unq
  on public.it_categories (account_id, lower(name)) where deleted_at is null;
create trigger it_categories_touch before update on public.it_categories
  for each row execute function public.it_touch();
alter table public.it_categories enable row level security;
create policy it_categories_select on public.it_categories for select using (account_id = auth_account_id());
create policy it_categories_write on public.it_categories for all
  using (account_id = auth_account_id() and it_is_admin()) with check (account_id = auth_account_id() and it_is_admin());

-- ---- Models ------------------------------------------------------------------

create table if not exists public.it_asset_models (
  id                      uuid primary key default gen_random_uuid(),
  account_id              uuid not null references public.accounts(id) on delete cascade,
  manufacturer_id         uuid references public.it_manufacturers(id) on delete set null,
  category_id             uuid not null references public.it_categories(id) on delete restrict,
  name                    text not null check (btrim(name) <> ''),
  model_number            text,
  image_path              text,
  eol_months              integer check (eol_months > 0),
  default_warranty_months integer check (default_warranty_months >= 0),
  depreciation_id         uuid, -- it_depreciations arrives in Phase 3
  fieldset_id             uuid references public.it_fieldsets(id) on delete set null,
  notes                   text,
  deleted_at              timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid references public.users(id) on delete set null default auth.uid()
);
create unique index if not exists it_asset_models_name_unq
  on public.it_asset_models (account_id, coalesce(manufacturer_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where deleted_at is null;
create trigger it_asset_models_touch before update on public.it_asset_models
  for each row execute function public.it_touch();
alter table public.it_asset_models enable row level security;
create policy it_asset_models_select on public.it_asset_models for select using (account_id = auth_account_id());
create policy it_asset_models_insert on public.it_asset_models
  for insert with check (account_id = auth_account_id() and it_is_staff());
create policy it_asset_models_update on public.it_asset_models
  for update using (account_id = auth_account_id() and it_is_staff())
  with check (account_id = auth_account_id() and it_is_staff());
create policy it_asset_models_delete on public.it_asset_models
  for delete using (account_id = auth_account_id() and it_is_admin());

-- ---- Status labels -------------------------------------------------------------
-- `color` is a Badge tone, never a hex value, so status reads like the rest of
-- the app (ok green, warn amber, danger red).

create table if not exists public.it_status_labels (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  type        text not null check (type in ('deployable', 'pending', 'undeployable', 'archived')),
  color       text not null default 'neutral' check (color in ('ok', 'accent', 'neutral', 'warn', 'danger')),
  is_default  boolean not null default false,
  sort_order  integer not null default 0,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.users(id) on delete set null default auth.uid()
);
create unique index if not exists it_status_labels_name_unq
  on public.it_status_labels (account_id, lower(name)) where deleted_at is null;
create unique index if not exists it_status_labels_default_unq
  on public.it_status_labels (account_id) where is_default and deleted_at is null;
create trigger it_status_labels_touch before update on public.it_status_labels
  for each row execute function public.it_touch();
alter table public.it_status_labels enable row level security;
create policy it_status_labels_select on public.it_status_labels for select using (account_id = auth_account_id());
create policy it_status_labels_write on public.it_status_labels for all
  using (account_id = auth_account_id() and it_is_admin()) with check (account_id = auth_account_id() and it_is_admin());

-- ---- Site areas ------------------------------------------------------------------
-- sort_order is the walk through the site, so stickers print and audits run
-- in the order you'd meet the gear on foot.

create table if not exists public.it_site_areas (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  sort_order  integer not null default 0,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.users(id) on delete set null default auth.uid()
);
create unique index if not exists it_site_areas_name_unq
  on public.it_site_areas (location_id, lower(name)) where deleted_at is null;
create trigger it_site_areas_touch before update on public.it_site_areas
  for each row execute function public.it_touch();
alter table public.it_site_areas enable row level security;
create policy it_site_areas_select on public.it_site_areas
  for select using (account_id = auth_account_id() and it_can_read(location_id));
create policy it_site_areas_insert on public.it_site_areas
  for insert with check (account_id = auth_account_id() and it_can_write(location_id));
create policy it_site_areas_update on public.it_site_areas
  for update using (account_id = auth_account_id() and it_can_write(location_id))
  with check (account_id = auth_account_id() and it_can_write(location_id));
create policy it_site_areas_delete on public.it_site_areas
  for delete using (account_id = auth_account_id() and it_can_write(location_id));
