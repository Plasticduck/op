-- Maintenance Inventory (docs/maintenance-inventory): schema and row-level security.
--
-- Extends what Operator already has instead of copying it: parts, vendors, equipment
-- (the asset registry), part_assets (the BOM) and work_orders/work_order_parts. Sites
-- are public.locations and regions come from company_settings.regions. Everything new
-- is prefixed mi_. Access is membership in mi_members, so no one outside it can read
-- any of this, whatever their Operator role.

-- ---- Additions to shared tables -------------------------------------------------
alter table public.parts
  add column if not exists mfr_part_number text,
  add column if not exists barcode text,
  add column if not exists pack_qty numeric(12,3) not null default 1,
  add column if not exists is_critical boolean not null default false,
  add column if not exists abc_class text check (abc_class in ('A', 'B', 'C')),
  add column if not exists photo_path text,
  add column if not exists spec jsonb not null default '{}'::jsonb,
  add column if not exists stale_days integer,
  add column if not exists is_sample boolean not null default false,
  add column if not exists sku_legacy_dup boolean not null default false;

-- Existing rows can repeat a SKU (3 pairs on Mighty Wash today). They're flagged rather
-- than merged, so a person decides, and the unique index covers everything else.
update public.parts p set sku_legacy_dup = true
where coalesce(p.sku, '') <> ''
  and exists (select 1 from public.parts o
              where o.account_id = p.account_id and lower(o.sku) = lower(p.sku) and o.id <> p.id);

create unique index if not exists parts_sku_unique
  on public.parts (account_id, lower(sku)) where coalesce(sku, '') <> '' and not sku_legacy_dup;
create unique index if not exists parts_mfr_mpn_unique
  on public.parts (account_id, lower(manufacturer), lower(mfr_part_number))
  where coalesce(manufacturer, '') <> '' and coalesce(mfr_part_number, '') <> '';
create unique index if not exists parts_barcode_unique
  on public.parts (account_id, barcode) where coalesce(barcode, '') <> '';
create index if not exists parts_name_trgm on public.parts using gin (name extensions.gin_trgm_ops);

alter table public.part_assets
  add column if not exists qty_per numeric(12,3) not null default 1,
  add column if not exists notes text;

alter table public.equipment
  add column if not exists area_id uuid,
  add column if not exists vendor_id uuid references public.vendors(id) on delete set null,
  add column if not exists install_date date,
  add column if not exists crit_class text check (crit_class in ('A', 'B', 'C'));

alter table public.work_order_parts
  add column if not exists qty_planned numeric(12,3) not null default 0,
  add column if not exists qty_issued numeric(12,3) not null default 0,
  add column if not exists qty_returned numeric(12,3) not null default 0,
  add column if not exists mi_location_id uuid,
  -- The existing part_id points at the old parts_inventory table, not the catalog.
  add column if not exists catalog_part_id uuid references public.parts(id) on delete set null;
create index if not exists work_order_parts_catalog_part on public.work_order_parts (work_order_id, catalog_part_id);

-- A checklist item can name the asset it inspects, so a failed item knows its BOM.
alter table public.checklist_items
  add column if not exists asset_id uuid references public.equipment(id) on delete set null;

-- ---- Membership and settings ----------------------------------------------------
create table public.mi_members (
  user_id uuid primary key references public.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  role text not null check (role in ('site_tech', 'site_manager', 'regional_manager', 'corporate_maintenance_director', 'admin')),
  site_ids uuid[] not null default '{}',
  region_names text[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid
);
create index mi_members_account on public.mi_members (account_id);

create table public.mi_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  sms_enabled boolean not null default false,
  quiet_start_hour integer not null default 21 check (quiet_start_hour between 0 and 23),
  quiet_end_hour integer not null default 7 check (quiet_end_hour between 0 and 23),
  timezone text not null default 'America/Chicago',
  count_variance_threshold numeric(12,2) not null default 50,
  count_tolerance_pct numeric(6,2) not null default 2,
  po_limits jsonb not null default '{"site_manager": 500, "regional_manager": 5000}'::jsonb,
  stale_days integer not null default 180,
  carrying_rate numeric(6,4) not null default 0.20,
  auto_counts_enabled boolean not null default false,
  count_schedule jsonb not null default '{"critical_days": 7, "a_days": 30, "b_days": 90, "c_days": 182}'::jsonb,
  high_value_photo_cost numeric(12,2),
  updated_at timestamptz not null default now()
);

create table public.mi_site_settings (
  site_id uuid primary key references public.locations(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  allow_negative boolean not null default false
);

create table public.mi_idempotency (
  account_id uuid not null references public.accounts(id) on delete cascade,
  client_txn_id text not null,
  result jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (account_id, client_txn_id)
);

-- ---- Catalog --------------------------------------------------------------------
create table public.mi_part_categories (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (account_id, name)
);
alter table public.parts add column if not exists category_id uuid references public.mi_part_categories(id) on delete set null;

create table public.mi_part_vendors (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  part_id uuid not null references public.parts(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  vendor_part_number text,
  price numeric(12,4),
  pack_qty numeric(12,3) not null default 1,
  lead_time_days integer,
  preferred boolean not null default false,
  unique (part_id, vendor_id)
);
create unique index mi_part_vendors_one_preferred on public.mi_part_vendors (part_id) where preferred;
create index mi_part_vendors_vendor on public.mi_part_vendors (vendor_id);
create index mi_part_vendors_vpn on public.mi_part_vendors (account_id, lower(vendor_part_number));

create table public.mi_part_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  manufacturer text,
  mfr_part_number text,
  barcode text,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_part_id uuid references public.parts(id) on delete set null,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz
);

-- ---- Places stock lives ---------------------------------------------------------
create table public.mi_stock_locations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  site_id uuid references public.locations(id) on delete cascade,
  -- A regional warehouse or a roaming truck has no single site; it belongs to a region.
  region_name text,
  name text not null,
  type text not null check (type in ('stockroom', 'cabinet', 'truck', 'regional_warehouse')),
  assigned_user_id uuid references public.users(id) on delete set null,
  active boolean not null default true,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  unique (account_id, name)
);
create index mi_stock_locations_site on public.mi_stock_locations (site_id);

create table public.mi_bins (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid not null references public.mi_stock_locations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (location_id, name)
);

create table public.mi_stock_levels (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  part_id uuid not null references public.parts(id) on delete cascade,
  location_id uuid not null references public.mi_stock_locations(id) on delete cascade,
  bin_id uuid references public.mi_bins(id) on delete set null,
  on_hand numeric(12,3) not null default 0,
  reserved numeric(12,3) not null default 0,
  available numeric(12,3) generated always as (on_hand - reserved) stored,
  min_qty numeric(12,3),
  max_qty numeric(12,3),
  reorder_point numeric(12,3),
  avg_cost numeric(12,4) not null default 0,
  last_moved_at timestamptz,
  last_counted_at timestamptz,
  is_sample boolean not null default false,
  unique (part_id, location_id)
);
create index mi_stock_levels_location on public.mi_stock_levels (location_id);
create index mi_stock_levels_bin on public.mi_stock_levels (bin_id);

-- Append-only: only the functions below write it, and a trigger refuses any change.
create table public.mi_inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  part_id uuid not null references public.parts(id),
  location_id uuid not null references public.mi_stock_locations(id),
  type text not null check (type in ('receive', 'issue', 'return', 'transfer_out', 'transfer_in', 'adjust', 'count_adjust', 'reserve', 'unreserve')),
  qty numeric(12,3) not null,
  qty_before numeric(12,3) not null,
  qty_after numeric(12,3) not null,
  unit_cost numeric(12,4) not null default 0,
  work_order_id uuid references public.work_orders(id) on delete set null,
  asset_id uuid references public.equipment(id) on delete set null,
  po_line_id uuid,
  transfer_id uuid,
  count_id uuid,
  reason_code text,
  notes text,
  performed_by uuid,
  source text not null default 'web' check (source in ('mobile', 'web', 'checklist', 'import', 'system')),
  client_txn_id text,
  is_sample boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index mi_ledger_client_txn on public.mi_inventory_transactions (account_id, client_txn_id) where client_txn_id is not null;
create index mi_ledger_part_time on public.mi_inventory_transactions (part_id, created_at);
create index mi_ledger_location_time on public.mi_inventory_transactions (location_id, created_at);
create index mi_ledger_wo on public.mi_inventory_transactions (work_order_id);
create index mi_ledger_asset on public.mi_inventory_transactions (asset_id);

-- ---- Tags -----------------------------------------------------------------------
create table public.mi_tags (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  code text not null,
  entity_type text not null check (entity_type in ('bin', 'tool', 'asset', 'location')),
  entity_id uuid not null,
  printed_count integer not null default 0,
  last_printed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (account_id, code),
  unique (entity_type, entity_id)
);

-- ---- Assets: areas and what each site must keep on hand -------------------------
create table public.mi_areas (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  site_id uuid not null references public.locations(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  unique (site_id, name)
);
alter table public.equipment add constraint equipment_area_fk foreign key (area_id) references public.mi_areas(id) on delete set null;

create table public.mi_kits (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  kind text not null default 'tunnel' check (kind in ('tunnel', 'lube', 'other')),
  description text,
  is_sample boolean not null default false,
  unique (account_id, name)
);
create table public.mi_kit_items (
  kit_id uuid not null references public.mi_kits(id) on delete cascade,
  part_id uuid not null references public.parts(id) on delete cascade,
  qty numeric(12,3) not null default 1,
  primary key (kit_id, part_id)
);
create table public.mi_site_kits (
  site_id uuid not null references public.locations(id) on delete cascade,
  kit_id uuid not null references public.mi_kits(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  tunnels integer not null default 1,
  primary key (site_id, kit_id)
);

-- ---- Tools ----------------------------------------------------------------------
create table public.mi_tools (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  category text,
  make text,
  model text,
  serial_number text,
  cost numeric(12,2),
  status text not null default 'available' check (status in ('available', 'checked_out', 'in_repair', 'lost', 'retired')),
  condition text not null default 'good' check (condition in ('good', 'needs_repair', 'damaged', 'missing_parts')),
  home_location_id uuid not null references public.mi_stock_locations(id),
  custodian_user_id uuid references public.users(id) on delete set null,
  custodian_location_id uuid references public.mi_stock_locations(id),
  due_at timestamptz,
  checked_out_at timestamptz,
  pending_to_user_id uuid references public.users(id) on delete set null,
  pending_to_location_id uuid references public.mi_stock_locations(id),
  pending_from_user_id uuid,
  pending_at timestamptz,
  photo_path text,
  notes text,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  -- Someone or somewhere always holds it (see mi__tool_keep_custodian).
  constraint mi_tools_one_custodian check ((custodian_user_id is null) <> (custodian_location_id is null))
);
create index mi_tools_custodian_user on public.mi_tools (custodian_user_id);
create index mi_tools_custodian_loc on public.mi_tools (custodian_location_id);

-- Removing a user clears custodian_user_id through the foreign key. The tool goes back
-- to its home crib rather than ending up held by no one.
create or replace function public.mi__tool_keep_custodian()
returns trigger language plpgsql as $$
begin
  if new.custodian_user_id is null and new.custodian_location_id is null then
    new.custodian_location_id := new.home_location_id;
    new.status := case when new.status = 'checked_out' then 'available' else new.status end;
  end if;
  return new;
end;
$$;
create trigger mi_tools_keep_custodian before insert or update on public.mi_tools
  for each row execute function public.mi__tool_keep_custodian();

-- The custody chain. Append-only, like the stock ledger.
create table public.mi_tool_checkouts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  tool_id uuid not null references public.mi_tools(id) on delete cascade,
  action text not null check (action in ('created', 'check_out', 'return', 'transfer_start', 'transfer_accept', 'transfer_cancel', 'status', 'report_issue', 'audit')),
  from_user_id uuid,
  from_location_id uuid,
  to_user_id uuid,
  to_location_id uuid,
  condition text,
  status text,
  due_at timestamptz,
  notes text,
  performed_by uuid,
  source text not null default 'web',
  client_txn_id text,
  created_at timestamptz not null default now()
);
create index mi_tool_checkouts_tool on public.mi_tool_checkouts (tool_id, created_at);

create table public.mi_tool_audits (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid not null references public.mi_stock_locations(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'done')),
  created_by uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create table public.mi_tool_audit_lines (
  audit_id uuid not null references public.mi_tool_audits(id) on delete cascade,
  tool_id uuid not null references public.mi_tools(id) on delete cascade,
  found boolean,
  condition text,
  scanned_at timestamptz,
  primary key (audit_id, tool_id)
);

-- ---- Transfers ------------------------------------------------------------------
create table public.mi_transfers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  number integer not null,
  from_location_id uuid not null references public.mi_stock_locations(id),
  to_location_id uuid not null references public.mi_stock_locations(id),
  status text not null default 'requested' check (status in ('requested', 'approved', 'in_transit', 'received', 'rejected', 'cancelled')),
  notes text,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  shipped_by uuid,
  shipped_at timestamptz,
  received_by uuid,
  received_at timestamptz,
  is_sample boolean not null default false,
  unique (account_id, number),
  check (from_location_id <> to_location_id)
);
create table public.mi_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.mi_transfers(id) on delete cascade,
  part_id uuid not null references public.parts(id),
  qty_requested numeric(12,3) not null check (qty_requested > 0),
  qty_shipped numeric(12,3) not null default 0,
  qty_received numeric(12,3) not null default 0,
  unit_cost numeric(12,4) not null default 0,
  variance_qty numeric(12,3),
  variance_notes text,
  unique (transfer_id, part_id)
);

-- ---- Counts ---------------------------------------------------------------------
create table public.mi_cycle_counts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  number integer not null,
  location_id uuid not null references public.mi_stock_locations(id),
  scope_type text not null default 'location' check (scope_type in ('location', 'category', 'abc', 'critical', 'part')),
  scope_value text,
  blind boolean not null default false,
  status text not null default 'open' check (status in ('open', 'in_review', 'posted', 'cancelled')),
  due_date date,
  scheduled boolean not null default false,
  forced boolean not null default false,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  submitted_by uuid,
  submitted_at timestamptz,
  posted_by uuid,
  posted_at timestamptz,
  is_sample boolean not null default false,
  unique (account_id, number)
);
create index mi_cycle_counts_location on public.mi_cycle_counts (location_id, status);
create table public.mi_cycle_count_lines (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.mi_cycle_counts(id) on delete cascade,
  part_id uuid not null references public.parts(id),
  bin_id uuid references public.mi_bins(id) on delete set null,
  expected_qty numeric(12,3) not null,
  unit_cost numeric(12,4) not null default 0,
  counted_qty numeric(12,3),
  variance_qty numeric(12,3) generated always as (counted_qty - expected_qty) stored,
  counted_by uuid,
  counted_at timestamptz,
  reason_code text check (reason_code in ('damaged', 'used_without_wo', 'mis_binned', 'receiving_error', 'theft_loss', 'unknown')),
  posted boolean not null default false,
  approved_by uuid,
  unique (count_id, part_id)
);

-- ---- Purchasing -----------------------------------------------------------------
create table public.mi_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  number integer not null,
  vendor_id uuid not null references public.vendors(id),
  ship_to_location_id uuid not null references public.mi_stock_locations(id),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'sent', 'partially_received', 'received', 'closed', 'cancelled')),
  urgent boolean not null default false,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  submitted_by uuid,
  submitted_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  sent_by uuid,
  sent_at timestamptz,
  sent_to text,
  closed_at timestamptz,
  is_sample boolean not null default false,
  unique (account_id, number)
);
create index mi_po_status on public.mi_purchase_orders (account_id, status);
create table public.mi_po_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.mi_purchase_orders(id) on delete cascade,
  part_id uuid not null references public.parts(id),
  qty_ordered numeric(12,3) not null check (qty_ordered > 0),
  qty_received numeric(12,3) not null default 0,
  unit_cost numeric(12,4) not null default 0,
  -- What this normally costs, kept so an urgent buy's premium can be reported.
  normal_unit_cost numeric(12,4),
  vendor_part_number text,
  notes text,
  unique (po_id, part_id)
);
create index mi_po_lines_part on public.mi_po_lines (part_id);
create table public.mi_receipts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  po_id uuid references public.mi_purchase_orders(id) on delete set null,
  location_id uuid not null references public.mi_stock_locations(id),
  packing_slip_path text,
  notes text,
  received_by uuid,
  received_at timestamptz not null default now()
);
create table public.mi_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.mi_receipts(id) on delete cascade,
  po_line_id uuid references public.mi_po_lines(id) on delete set null,
  part_id uuid not null references public.parts(id),
  qty numeric(12,3) not null,
  unit_cost numeric(12,4) not null default 0,
  bin_id uuid references public.mi_bins(id) on delete set null
);
alter table public.mi_inventory_transactions
  add constraint mi_ledger_po_line foreign key (po_line_id) references public.mi_po_lines(id) on delete set null,
  add constraint mi_ledger_transfer foreign key (transfer_id) references public.mi_transfers(id) on delete set null,
  add constraint mi_ledger_count foreign key (count_id) references public.mi_cycle_counts(id) on delete set null;

-- ---- Attachments and alerts -----------------------------------------------------
create table public.mi_attachments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  storage_path text not null,
  file_name text,
  kind text not null default 'document' check (kind in ('document', 'photo', 'packing_slip', 'installed_part')),
  uploaded_by uuid,
  created_at timestamptz not null default now()
);
create index mi_attachments_entity on public.mi_attachments (entity_type, entity_id);

create table public.mi_alerts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null check (kind in ('critical_below_min', 'critical_zero', 'low_stock', 'tool_overdue', 'tool_overdue_manager', 'count_variance', 'transfer_variance', 'tool_transfer')),
  part_id uuid references public.parts(id) on delete cascade,
  location_id uuid references public.mi_stock_locations(id) on delete cascade,
  tool_id uuid references public.mi_tools(id) on delete cascade,
  count_id uuid references public.mi_cycle_counts(id) on delete cascade,
  target_user_id uuid,
  message text not null,
  dedupe_key text not null,
  bypass_quiet boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'sent', 'off', 'digest', 'no_recipient', 'failed')),
  sent_at timestamptz,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index mi_alerts_pending on public.mi_alerts (status, created_at) where status in ('pending', 'digest');
create index mi_alerts_dedupe on public.mi_alerts (account_id, dedupe_key, created_at);

-- ---- Who can see what -----------------------------------------------------------
create or replace function public.mi_role()
returns text language sql stable security definer set search_path = public as $$
  select m.role from public.mi_members m where m.user_id = auth.uid()
$$;

create or replace function public.mi_rank()
returns integer language sql stable security definer set search_path = public as $$
  select case public.mi_role()
    when 'site_tech' then 1 when 'site_manager' then 2 when 'regional_manager' then 3
    when 'corporate_maintenance_director' then 4 when 'admin' then 5 else 0 end
$$;

-- A site can sit in a named region (company_settings.regions[].siteIds).
create or replace function public.mi__region_sites(p_account uuid, p_regions text[])
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg((sid)::uuid), '{}')
  from public.accounts a,
       lateral jsonb_array_elements(coalesce(a.company_settings -> 'regions', '[]'::jsonb)) r,
       lateral jsonb_array_elements_text(coalesce(r -> 'siteIds', '[]'::jsonb)) sid
  where a.id = p_account and r ->> 'name' = any (p_regions)
$$;

-- The sites this person's module role reaches.
create or replace function public.auth_site_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select case
    when m.role in ('corporate_maintenance_director', 'admin') then
      (select coalesce(array_agg(l.id), '{}') from public.locations l where l.account_id = m.account_id and not l.archived)
    when m.role = 'regional_manager' then
      m.site_ids || public.mi__region_sites(m.account_id, m.region_names)
    else m.site_ids
  end
  from public.mi_members m where m.user_id = auth.uid()
$$;

-- Regions this person belongs to: named ones, plus any their sites sit in.
create or replace function public.mi_my_regions()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct r ->> 'name'), '{}')
  from public.mi_members m
  join public.accounts a on a.id = m.account_id,
       lateral jsonb_array_elements(coalesce(a.company_settings -> 'regions', '[]'::jsonb)) r
  where m.user_id = auth.uid()
    and (m.role in ('corporate_maintenance_director', 'admin')
         or r ->> 'name' = any (m.region_names)
         or exists (select 1 from jsonb_array_elements_text(coalesce(r -> 'siteIds', '[]'::jsonb)) sid where (sid)::uuid = any (m.site_ids)))
$$;

create or replace function public.mi_visible_location_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(l.id), '{}')
  from public.mi_stock_locations l
  join public.mi_members m on m.user_id = auth.uid() and m.account_id = l.account_id
  where m.role in ('corporate_maintenance_director', 'admin')
     or l.site_id = any (public.auth_site_ids())
     or l.assigned_user_id = auth.uid()
     or (l.site_id is null and l.region_name = any (public.mi_my_regions()))
$$;

-- Whether this person may move stock at a location (not just read it). A tech works
-- their own sites and their own truck; a warehouse takes a regional manager or above.
create or replace function public.mi_can_act_at(p_location uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.mi_stock_locations l
    join public.mi_members m on m.user_id = auth.uid() and m.account_id = l.account_id
    where l.id = p_location and (
      m.role in ('corporate_maintenance_director', 'admin')
      or l.assigned_user_id = auth.uid()
      or l.site_id = any (public.auth_site_ids())
      or (l.site_id is null and m.role = 'regional_manager' and l.region_name = any (m.region_names))
    )
  )
$$;

create or replace function public.mi_can_manage_at(p_location uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.mi_rank() >= 2 and public.mi_can_act_at(p_location)
$$;

-- ---- Row-level security ---------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'mi_members','mi_settings','mi_site_settings','mi_idempotency','mi_part_categories','mi_part_vendors','mi_part_requests',
    'mi_stock_locations','mi_bins','mi_stock_levels','mi_inventory_transactions','mi_tags','mi_areas','mi_kits','mi_kit_items',
    'mi_site_kits','mi_tools','mi_tool_checkouts','mi_tool_audits','mi_tool_audit_lines','mi_transfers','mi_transfer_lines',
    'mi_cycle_counts','mi_cycle_count_lines','mi_purchase_orders','mi_po_lines','mi_receipts','mi_receipt_lines','mi_attachments','mi_alerts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    -- Reads are opened by policy below. Writes go through the functions, except the
    -- few reference tables granted back at the end of this file.
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;

create policy mi_members_select on public.mi_members for select
  using (account_id = auth_account_id() and (user_id = auth.uid() or public.mi_rank() >= 4));
create policy mi_settings_select on public.mi_settings for select
  using (account_id = auth_account_id() and public.mi_rank() >= 1);
create policy mi_site_settings_select on public.mi_site_settings for select
  using (account_id = auth_account_id() and site_id = any ((select public.auth_site_ids())::uuid[]));
-- mi_idempotency has no policy on purpose: only the functions touch it.

-- The catalog is shared across a member's whole account; writes are the director's.
create policy mi_categories_select on public.mi_part_categories for select
  using (account_id = auth_account_id() and public.mi_rank() >= 1);
create policy mi_categories_write on public.mi_part_categories for all
  using (account_id = auth_account_id() and public.mi_rank() >= 4)
  with check (account_id = auth_account_id() and public.mi_rank() >= 4);
create policy mi_part_vendors_select on public.mi_part_vendors for select
  using (account_id = auth_account_id() and public.mi_rank() >= 1);
create policy mi_part_vendors_write on public.mi_part_vendors for all
  using (account_id = auth_account_id() and public.mi_rank() >= 4)
  with check (account_id = auth_account_id() and public.mi_rank() >= 4);
create policy mi_part_requests_select on public.mi_part_requests for select
  using (account_id = auth_account_id() and (requested_by = auth.uid() or public.mi_rank() >= 4));
create policy mi_kits_select on public.mi_kits for select
  using (account_id = auth_account_id() and public.mi_rank() >= 1);
create policy mi_kits_write on public.mi_kits for all
  using (account_id = auth_account_id() and public.mi_rank() >= 4)
  with check (account_id = auth_account_id() and public.mi_rank() >= 4);
create policy mi_kit_items_select on public.mi_kit_items for select
  using (exists (select 1 from public.mi_kits k where k.id = kit_id and k.account_id = auth_account_id()) and public.mi_rank() >= 1);
create policy mi_kit_items_write on public.mi_kit_items for all
  using (exists (select 1 from public.mi_kits k where k.id = kit_id and k.account_id = auth_account_id()) and public.mi_rank() >= 4)
  with check (exists (select 1 from public.mi_kits k where k.id = kit_id and k.account_id = auth_account_id()) and public.mi_rank() >= 4);
create policy mi_site_kits_select on public.mi_site_kits for select
  using (account_id = auth_account_id() and site_id = any ((select public.auth_site_ids())::uuid[]));
create policy mi_site_kits_write on public.mi_site_kits for all
  using (account_id = auth_account_id() and public.mi_rank() >= 4)
  with check (account_id = auth_account_id() and public.mi_rank() >= 4);

create policy mi_locations_select on public.mi_stock_locations for select
  using (account_id = auth_account_id() and id = any ((select public.mi_visible_location_ids())::uuid[]));
create policy mi_locations_write on public.mi_stock_locations for all
  using (account_id = auth_account_id() and public.mi_rank() >= 4)
  with check (account_id = auth_account_id() and public.mi_rank() >= 4);
create policy mi_bins_select on public.mi_bins for select
  using (account_id = auth_account_id() and location_id = any ((select public.mi_visible_location_ids())::uuid[]));
create policy mi_bins_write on public.mi_bins for all
  using (account_id = auth_account_id() and public.mi_can_manage_at(location_id))
  with check (account_id = auth_account_id() and public.mi_can_manage_at(location_id));
create policy mi_stock_select on public.mi_stock_levels for select
  using (account_id = auth_account_id() and location_id = any ((select public.mi_visible_location_ids())::uuid[]));
create policy mi_ledger_select on public.mi_inventory_transactions for select
  using (account_id = auth_account_id() and location_id = any ((select public.mi_visible_location_ids())::uuid[]));

create policy mi_tags_select on public.mi_tags for select
  using (account_id = auth_account_id() and public.mi_rank() >= 1);
create policy mi_areas_select on public.mi_areas for select
  using (account_id = auth_account_id() and site_id = any ((select public.auth_site_ids())::uuid[]));
create policy mi_areas_write on public.mi_areas for all
  using (account_id = auth_account_id() and public.mi_rank() >= 2 and site_id = any ((select public.auth_site_ids())::uuid[]))
  with check (account_id = auth_account_id() and public.mi_rank() >= 2 and site_id = any ((select public.auth_site_ids())::uuid[]));

create policy mi_tools_select on public.mi_tools for select
  using (account_id = auth_account_id() and public.mi_rank() >= 1 and (
    public.mi_rank() >= 4 or custodian_user_id = auth.uid() or pending_to_user_id = auth.uid()
    or home_location_id = any ((select public.mi_visible_location_ids())::uuid[])
    or custodian_location_id = any ((select public.mi_visible_location_ids())::uuid[])));
create policy mi_tool_checkouts_select on public.mi_tool_checkouts for select
  using (exists (select 1 from public.mi_tools t where t.id = tool_id));
create policy mi_tool_audits_select on public.mi_tool_audits for select
  using (account_id = auth_account_id() and location_id = any ((select public.mi_visible_location_ids())::uuid[]));
create policy mi_tool_audit_lines_select on public.mi_tool_audit_lines for select
  using (exists (select 1 from public.mi_tool_audits a where a.id = audit_id));

create policy mi_transfers_select on public.mi_transfers for select
  using (account_id = auth_account_id() and (
    from_location_id = any ((select public.mi_visible_location_ids())::uuid[])
    or to_location_id = any ((select public.mi_visible_location_ids())::uuid[])));
create policy mi_transfer_lines_select on public.mi_transfer_lines for select
  using (exists (select 1 from public.mi_transfers t where t.id = transfer_id));

create policy mi_counts_select on public.mi_cycle_counts for select
  using (account_id = auth_account_id() and location_id = any ((select public.mi_visible_location_ids())::uuid[]));
-- Lines hold the expected quantity, so techs reach them through mi_count_detail, which
-- hides it on a blind count. Managers read them directly.
create policy mi_count_lines_select on public.mi_cycle_count_lines for select
  using (public.mi_rank() >= 2 and exists (select 1 from public.mi_cycle_counts c where c.id = count_id));

create policy mi_po_select on public.mi_purchase_orders for select
  using (account_id = auth_account_id() and (
    public.mi_rank() >= 4 or ship_to_location_id = any ((select public.mi_visible_location_ids())::uuid[])));
create policy mi_po_lines_select on public.mi_po_lines for select
  using (exists (select 1 from public.mi_purchase_orders p where p.id = po_id));
create policy mi_receipts_select on public.mi_receipts for select
  using (account_id = auth_account_id() and location_id = any ((select public.mi_visible_location_ids())::uuid[]));
create policy mi_receipt_lines_select on public.mi_receipt_lines for select
  using (exists (select 1 from public.mi_receipts r where r.id = receipt_id));

create policy mi_attachments_select on public.mi_attachments for select
  using (account_id = auth_account_id() and public.mi_rank() >= 1);
create policy mi_attachments_insert on public.mi_attachments for insert
  with check (account_id = auth_account_id() and public.mi_rank() >= 1 and uploaded_by = auth.uid());
create policy mi_attachments_delete on public.mi_attachments for delete
  using (account_id = auth_account_id() and (uploaded_by = auth.uid() or public.mi_rank() >= 2));

create policy mi_alerts_select on public.mi_alerts for select
  using (account_id = auth_account_id() and public.mi_rank() >= 2
    and (location_id is null or location_id = any ((select public.mi_visible_location_ids())::uuid[])));

-- Reference tables that policies above open for writing.
grant insert, update, delete on public.mi_part_categories, public.mi_part_vendors, public.mi_kits, public.mi_kit_items,
  public.mi_site_kits, public.mi_stock_locations, public.mi_bins, public.mi_areas to authenticated;
grant insert, delete on public.mi_attachments to authenticated;

-- ---- The ledgers can't be changed -----------------------------------------------
create or replace function public.mi__append_only()
returns trigger language plpgsql as $$
begin
  -- Removing sample data is the one exception (mi_remove_sample_data).
  if current_setting('mi.purge', true) = 'on' then
    return coalesce(old, new);
  end if;
  raise exception 'This history can''t be changed. Post a correction instead.';
end;
$$;
create trigger mi_ledger_no_change before update or delete on public.mi_inventory_transactions
  for each row execute function public.mi__append_only();
create trigger mi_tool_chain_no_change before update or delete on public.mi_tool_checkouts
  for each row execute function public.mi__append_only();

-- ---- Audit log (the existing table) ---------------------------------------------
create or replace function public.mi__audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  n jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
begin
  insert into public.audit_log (table_name, row_id, actor_user_id, action, diff)
  values (tg_table_name, (coalesce(n, o) ->> tg_argv[0])::uuid, auth.uid(), lower(tg_op), jsonb_build_object('old', o, 'new', n));
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger mi_members_audit after insert or update or delete on public.mi_members
  for each row execute function public.mi__audit('user_id');
create trigger mi_settings_audit after insert or update or delete on public.mi_settings
  for each row execute function public.mi__audit('account_id');
create trigger mi_po_audit after update of status on public.mi_purchase_orders
  for each row execute function public.mi__audit('id');

-- Sample rows stay out of the shared Parts page: see queries/parts.ts.

-- ---- Sticker and photo files ----------------------------------------------------
insert into storage.buckets (id, name, public)
values ('maintenance-inventory', 'maintenance-inventory', false)
on conflict (id) do nothing;

create policy mi_files_read on storage.objects for select
  using (bucket_id = 'maintenance-inventory' and (storage.foldername(name))[1] = (auth_account_id())::text and public.mi_rank() >= 1);
create policy mi_files_insert on storage.objects for insert
  with check (bucket_id = 'maintenance-inventory' and (storage.foldername(name))[1] = (auth_account_id())::text and public.mi_rank() >= 1);
create policy mi_files_delete on storage.objects for delete
  using (bucket_id = 'maintenance-inventory' and (storage.foldername(name))[1] = (auth_account_id())::text
    and (owner = auth.uid() or public.mi_rank() >= 2));

-- ---- Starting access: the two people Kevan named (2026-11-05) -------------------
insert into public.mi_members (user_id, account_id, role)
select u.id, u.account_id, 'admin' from public.users u
where lower(u.email) in ('kevan@washlyfe.com', 'jjowers@mighty-wash.com')
on conflict (user_id) do nothing;

insert into public.mi_settings (account_id)
select distinct account_id from public.mi_members
on conflict (account_id) do nothing;
