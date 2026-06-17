-- 0041_parts_rebuild.sql
--
-- MaintainX-style Parts:
--   - parts: account-scoped master record (one per logical part)
--     - auto-incrementing part_number per account (#01, #02, ...)
--     - QR code generated on insert (12-char A-Z 2-9)
--     - vendor_id FK, ordering_part_number, UOM, lead_time_days
--   - parts_inventory: per-location stock row (already exists; we add
--     part_id pointing at the master + rename "reorder_threshold" semantics
--     to "minimum_in_stock" with a new column for clarity but keep the old
--     one populated for backward compat). Each (part_id, location_id) is
--     unique so the UI can show one row per location.
--   - part_assets: many-to-many between parts and equipment (assets)
--   - part_restock_log: simple history of restock events so the Part > History
--     tab can render them.

-- 1) Master parts table
create table public.parts (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null references public.accounts(id) on delete cascade,
  part_number            int  not null,
  name                   text not null,
  description            text,
  sku                    text,
  ordering_part_number   text,
  qr_code                text not null,
  uom                    text not null default 'ea',
  lead_time_days         int,
  unit_cost              numeric,
  manufacturer           text,
  vendor_id              uuid references public.vendors(id) on delete set null,
  link_url               text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (account_id, part_number),
  unique (qr_code)
);
create index parts_account_idx on public.parts (account_id);

alter table public.parts enable row level security;
create policy parts_select on public.parts for select
  using (account_id = public.auth_account_id());
create policy parts_write on public.parts for all
  using (account_id = public.auth_account_id() and public.auth_is_manager_plus())
  with check (account_id = public.auth_account_id() and public.auth_is_manager_plus());

-- 2) Auto-increment part_number per account
create or replace function public.assign_part_number()
returns trigger language plpgsql as $$
begin
  if new.part_number is null then
    select coalesce(max(part_number), 0) + 1 into new.part_number
      from public.parts where account_id = new.account_id;
  end if;
  return new;
end $$;
create trigger parts_assign_number
before insert on public.parts
for each row execute function public.assign_part_number();

-- 3) QR code on insert (reuse asset QR strategy, prefixed with P)
create or replace function public.assign_part_qr()
returns trigger language plpgsql as $$
declare candidate text;
begin
  if new.qr_code is not null and new.qr_code <> '' then return new; end if;
  candidate := upper(substring(translate(encode(extensions.gen_random_bytes(8),'base64'),'+/=ILO01',''), 1, 12));
  new.qr_code := candidate;
  return new;
end $$;
create trigger parts_assign_qr
before insert on public.parts
for each row execute function public.assign_part_qr();

-- 4) Touch updated_at
create or replace function public.touch_part_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger parts_touch
before update on public.parts
for each row execute function public.touch_part_updated_at();

-- 5) Add part_id + minimum_in_stock to existing parts_inventory + backfill.
--    Each existing parts_inventory row gets its own master parts row (4 rows
--    today, all unique names per the survey).
alter table public.parts_inventory
  add column part_id            uuid references public.parts(id) on delete cascade,
  add column minimum_in_stock   numeric;

-- Backfill: insert one master row per existing parts_inventory row.
with src as (
  select pi.id as inv_id, l.account_id, pi.name, pi.sku, pi.unit_cost,
         pi.manufacturer, pi.vendor as vendor_name, pi.link_url, pi.reorder_threshold
    from public.parts_inventory pi
    join public.locations l on l.id = pi.location_id
),
ins as (
  insert into public.parts (account_id, name, sku, unit_cost, manufacturer, link_url)
  select account_id, name, sku, unit_cost, manufacturer, link_url
    from src
  returning id, name, account_id
)
update public.parts_inventory pi
   set part_id = ins.id,
       minimum_in_stock = pi.reorder_threshold
  from ins, public.locations l
 where pi.location_id = l.id
   and l.account_id = ins.account_id
   and pi.name = ins.name;

alter table public.parts_inventory alter column part_id set not null;
alter table public.parts_inventory alter column minimum_in_stock set not null;
create unique index parts_inventory_part_loc_unq
  on public.parts_inventory (part_id, location_id);

-- 6) Many-to-many: parts <-> assets (the "Attach this Part to all related
--    Assets" feature on the Part detail page).
create table public.part_assets (
  part_id   uuid not null references public.parts(id) on delete cascade,
  asset_id  uuid not null references public.equipment(id) on delete cascade,
  primary key (part_id, asset_id)
);
create index part_assets_asset_idx on public.part_assets (asset_id);

alter table public.part_assets enable row level security;
create policy part_assets_select on public.part_assets for select
  using (exists (select 1 from public.parts p where p.id = part_id and p.account_id = public.auth_account_id()));
create policy part_assets_write on public.part_assets for all
  using (exists (select 1 from public.parts p where p.id = part_id and p.account_id = public.auth_account_id() and public.auth_is_manager_plus()))
  with check (exists (select 1 from public.parts p where p.id = part_id and p.account_id = public.auth_account_id() and public.auth_is_manager_plus()));

-- 7) Restock log
create table public.part_restock_log (
  id                uuid primary key default gen_random_uuid(),
  part_id           uuid not null references public.parts(id) on delete cascade,
  location_id       uuid not null references public.locations(id) on delete cascade,
  quantity_added    numeric not null,
  unit_cost_at_time numeric,
  notes             text,
  restocked_by      uuid references public.users(id) on delete set null,
  restocked_by_name text,
  created_at        timestamptz not null default now()
);
create index part_restock_log_part_idx on public.part_restock_log (part_id, created_at desc);

alter table public.part_restock_log enable row level security;
create policy prl_select on public.part_restock_log for select
  using (exists (select 1 from public.parts p where p.id = part_id and p.account_id = public.auth_account_id()));
create policy prl_insert on public.part_restock_log for insert
  with check (exists (select 1 from public.parts p where p.id = part_id and p.account_id = public.auth_account_id() and public.auth_is_manager_plus()));
