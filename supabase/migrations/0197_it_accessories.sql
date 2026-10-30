-- IT Inventory Phase 2 (2026-10-30): accessories. Things counted rather
-- than tracked one by one, that are lent out and come back: chargers and
-- cables, cases and mounts, keyboards, headsets. (Supplies, in
-- it_consumables, get used up; accessories return.)
--
-- An accessory is a count at a site (qty_total) with an optional minimum on
-- hand. Checking some out (it_accessory_assignments) is to a person on the
-- site roster or to a device at the site (a charger with a tablet); checking
-- in closes that row. What's available is the total minus what's out
-- (it_accessory_stock view). Rules live in the triggers: you can't check out
-- more than is available, can't lower the total below what's out, and can't
-- move an accessory to another site while some are out. A check-out to a
-- device shows on that device's Timeline.

create table if not exists public.it_accessories (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  category_id uuid references public.it_categories(id) on delete set null,
  name        text not null check (btrim(name) <> ''),
  model_number text,
  qty_total   integer not null default 0 check (qty_total >= 0),
  min_qty     integer not null default 0 check (min_qty >= 0),
  supplier_id uuid references public.it_suppliers(id) on delete set null,
  unit_cost   numeric(12, 2) check (unit_cost >= 0),
  notes       text,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.users(id) on delete set null default auth.uid()
);
create index if not exists it_accessories_site_idx on public.it_accessories (account_id, location_id);
create trigger it_accessories_touch before update on public.it_accessories
  for each row execute function public.it_touch();

create table if not exists public.it_accessory_assignments (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  location_id        uuid not null references public.locations(id) on delete cascade,
  accessory_id       uuid not null references public.it_accessories(id) on delete cascade,
  -- The accessory's name when it went out, for the history.
  accessory_name     text,
  qty                integer not null check (qty > 0),
  assigned_type      text not null check (assigned_type in ('user', 'asset')),
  assigned_id        uuid not null,
  assigned_label     text,
  -- assigned_type 'asset': the device, so it shows on that device's Timeline.
  asset_id           uuid references public.it_assets(id) on delete set null,
  expected_return_at timestamptz,
  note               text,
  checked_out_at     timestamptz not null default now(),
  checked_out_by     uuid references public.users(id) on delete set null default auth.uid(),
  checked_in_at      timestamptz,
  checked_in_by      uuid references public.users(id) on delete set null,
  checkin_note       text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.users(id) on delete set null default auth.uid()
);
create index if not exists it_accessory_assignments_open_idx on public.it_accessory_assignments (accessory_id) where checked_in_at is null;
create index if not exists it_accessory_assignments_asset_idx on public.it_accessory_assignments (asset_id) where checked_in_at is null;
create trigger it_accessory_assignments_touch before update on public.it_accessory_assignments
  for each row execute function public.it_touch();

-- ---- Rules ---------------------------------------------------------------------------
create or replace function public.it_accessories_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  out_n integer;
begin
  if auth.uid() is not null and new.account_id is distinct from auth_account_id() then
    raise exception 'new row violates row-level security policy for table "it_accessories"' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(sum(qty), 0) into out_n from public.it_accessory_assignments
     where accessory_id = new.id and checked_in_at is null;
    if new.qty_total < out_n then
      raise exception '% % checked out. Check some in before lowering the total.', out_n, case when out_n = 1 then 'is' else 'are' end;
    end if;
    if new.location_id is distinct from old.location_id and out_n > 0 then
      raise exception 'Check them all in before moving them to another site.';
    end if;
  end if;
  return new;
end $$;
create trigger it_accessories_guard_trg before insert or update on public.it_accessories
  for each row execute function public.it_accessories_guard();

create or replace function public.it_accessory_assignments_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  acc   public.it_accessories%rowtype;
  avail integer;
  site  uuid;
begin
  if auth.uid() is not null and new.account_id is distinct from auth_account_id() then
    raise exception 'new row violates row-level security policy for table "it_accessory_assignments"' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.checked_in_at is not null then
      raise exception 'This check-out is closed';
    end if;
    if new.accessory_id <> old.accessory_id or new.qty <> old.qty or new.assigned_type <> old.assigned_type
       or new.assigned_id <> old.assigned_id or new.account_id <> old.account_id or new.location_id <> old.location_id then
      raise exception 'Check it in and out again to change who has it';
    end if;
    if new.checked_in_at is not null and new.checked_in_by is null then
      new.checked_in_by := auth.uid();
    end if;
    return new;
  end if;

  -- One check-out at a time per accessory, so two people can't take the last one.
  select * into acc from public.it_accessories
   where id = new.accessory_id and account_id = new.account_id and deleted_at is null
     for update;
  if not found then
    raise exception 'Unknown accessory';
  end if;
  new.location_id := acc.location_id;
  new.accessory_name := acc.name;
  select acc.qty_total - coalesce(sum(qty), 0) into avail from public.it_accessory_assignments
   where accessory_id = acc.id and checked_in_at is null;
  if new.qty > avail then
    raise exception '%', case when avail <= 0 then 'None left to check out.' else 'Only ' || avail || ' left to check out.' end;
  end if;

  if new.assigned_type = 'user' then
    select btrim(e.first_name || ' ' || coalesce(e.last_name, '')) into new.assigned_label
      from public.employees e join public.locations l on l.id = e.location_id
     where e.id = new.assigned_id and l.account_id = new.account_id;
    new.asset_id := null;
  else
    select x.asset_tag || ' ' || x.name, x.location_id into new.assigned_label, site
      from public.it_assets x
     where x.id = new.assigned_id and x.account_id = new.account_id and x.deleted_at is null;
    if site is distinct from acc.location_id then
      raise exception 'Pick a device at the same site.';
    end if;
    new.asset_id := new.assigned_id;
  end if;
  if new.assigned_label is null then
    raise exception 'Unknown check-out target';
  end if;
  return new;
end $$;
create trigger it_accessory_assignments_before_trg before insert or update on public.it_accessory_assignments
  for each row execute function public.it_accessory_assignments_before();

-- ---- Access ---------------------------------------------------------------------------
alter table public.it_accessories enable row level security;
create policy it_accessories_select on public.it_accessories
  for select using (account_id = auth_account_id() and it_can_read(location_id));
create policy it_accessories_insert on public.it_accessories
  for insert with check (account_id = auth_account_id() and it_can_write(location_id));
create policy it_accessories_update on public.it_accessories
  for update using (account_id = auth_account_id() and it_can_write(location_id))
  with check (account_id = auth_account_id() and it_can_write(location_id));
create policy it_accessories_delete on public.it_accessories
  for delete using (account_id = auth_account_id() and it_is_admin());

alter table public.it_accessory_assignments enable row level security;
create policy it_accessory_assignments_select on public.it_accessory_assignments
  for select using (account_id = auth_account_id() and it_can_read(location_id));
create policy it_accessory_assignments_insert on public.it_accessory_assignments
  for insert with check (account_id = auth_account_id() and it_can_write(location_id));
create policy it_accessory_assignments_update on public.it_accessory_assignments
  for update using (account_id = auth_account_id() and it_can_write(location_id))
  with check (account_id = auth_account_id() and it_can_write(location_id));
-- No delete: check it in instead.

create trigger it_accessories_log after insert or update or delete on public.it_accessories
  for each row execute function public.it_log('accessory');
create trigger it_accessory_assignments_log after insert or update on public.it_accessory_assignments
  for each row execute function public.it_log('accessory_assignment');

-- What's out and what's left, for the lists. Runs as the caller, so RLS applies.
create or replace view public.it_accessory_stock with (security_invoker = true) as
select a.*,
       coalesce(o.out_qty, 0)::integer as checked_out,
       (a.qty_total - coalesce(o.out_qty, 0))::integer as available
  from public.it_accessories a
  left join (select accessory_id, sum(qty) as out_qty
               from public.it_accessory_assignments
              where checked_in_at is null
              group by accessory_id) o on o.accessory_id = a.id;
grant select on public.it_accessory_stock to authenticated;

-- ---- Accessory categories ----------------------------------------------------------------
-- New accounts get them from it_bootstrap (below); existing ones here.
insert into public.it_categories (account_id, name, kind, icon, requires_ip, default_monitoring, sort_order)
select s.account_id, c.name, 'accessory', c.icon, false, false, c.ord
  from public.it_settings s
 cross join (values ('Charger or Cable', 'plug', 500), ('Case or Mount', 'package', 510),
                    ('Keyboard or Mouse', 'keyboard', 520), ('Headset or Radio', 'headphones', 530),
                    ('Other Accessory', 'package', 540)) as c(name, icon, ord)
 where not exists (select 1 from public.it_categories x where x.account_id = s.account_id and x.kind = 'accessory');

-- it_bootstrap as deployed before this migration, plus the accessory categories.
create or replace function public.it_bootstrap()
 RETURNS it_settings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  acct      uuid := auth_account_id();
  s         public.it_settings%rowtype;
  aname     text;
  base      text;
  code      text;
  n         integer := 0;
  v_prefix  text;
  t_roll    uuid;
  t_outdoor uuid;
  c_sticker uuid;
begin
  if acct is null or not it_is_staff() then
    raise exception 'Only admins, managers and technicians can set up IT Inventory';
  end if;
  perform pg_advisory_xact_lock(hashtext('it_bootstrap:' || acct::text));

  select * into s from public.it_settings where account_id = acct;
  if not found then
    select name into aname from public.accounts where id = acct;
    base := left(lower(regexp_replace(coalesce(aname, ''), '[^a-zA-Z0-9]', '', 'g')), 12);
    if length(base) < 2 then base := 'op' || base; end if;
    code := base;
    while exists (select 1 from public.it_settings where short_code = code) loop
      n := n + 1;
      code := base || n::text;
    end loop;
    -- Tag prefix from the company's initials: Mighty Wash -> MW.
    v_prefix := left(regexp_replace(initcap(coalesce(aname, '')), '[^A-Z0-9]', '', 'g'), 4);
    if v_prefix = '' then v_prefix := 'IT'; end if;
    insert into public.it_settings (account_id, short_code, tag_prefix)
    values (acct, code, v_prefix) returning * into s;
  end if;

  -- Label templates. Sizes are the manufacturers' published specs (mm).
  if not exists (select 1 from public.it_label_templates where account_id = acct) then
    insert into public.it_label_templates (account_id, name, kind, page_spec, layout, is_outdoor, is_default, sort_order) values
      (acct, 'Roll 2.25 x 1.25 in (DYMO 30334, Zebra)', 'roll',
       '{"page": null, "label": {"w_mm": 57.15, "h_mm": 31.75}, "cols": 1, "rows": 1, "margin_top_mm": 0, "margin_left_mm": 0, "pitch_x_mm": 57.15, "pitch_y_mm": 31.75}',
       '{"style": "standard", "show": ["qr", "barcode", "tag", "name", "site"]}', false, true, 10),
      (acct, 'Brother QL 62 x 29 mm (DK-11209)', 'roll',
       '{"page": null, "label": {"w_mm": 62, "h_mm": 29}, "cols": 1, "rows": 1, "margin_top_mm": 0, "margin_left_mm": 0, "pitch_x_mm": 62, "pitch_y_mm": 29}',
       '{"style": "standard", "show": ["qr", "barcode", "tag", "name", "site"]}', false, false, 20),
      (acct, 'Avery 5160 sheet (1 x 2-5/8 in, 30 per page)', 'sheet',
       '{"page": {"w_mm": 215.9, "h_mm": 279.4}, "label": {"w_mm": 66.675, "h_mm": 25.4}, "cols": 3, "rows": 10, "margin_top_mm": 12.7, "margin_left_mm": 4.7625, "pitch_x_mm": 69.85, "pitch_y_mm": 25.4}',
       '{"style": "compact", "show": ["qr", "barcode", "tag", "name", "site"]}', false, false, 30),
      (acct, 'Avery 5163 sheet (2 x 4 in, 10 per page)', 'sheet',
       '{"page": {"w_mm": 215.9, "h_mm": 279.4}, "label": {"w_mm": 101.6, "h_mm": 50.8}, "cols": 2, "rows": 5, "margin_top_mm": 12.7, "margin_left_mm": 3.96875, "pitch_x_mm": 104.775, "pitch_y_mm": 50.8}',
       '{"style": "standard", "show": ["qr", "barcode", "tag", "name", "site", "phone", "logo"]}', false, false, 40),
      (acct, 'Outdoor 2 x 2 in (polyester or vinyl)', 'roll',
       '{"page": null, "label": {"w_mm": 50.8, "h_mm": 50.8}, "cols": 1, "rows": 1, "margin_top_mm": 0, "margin_left_mm": 0, "pitch_x_mm": 50.8, "pitch_y_mm": 50.8}',
       '{"style": "outdoor", "show": ["qr", "tag", "name"]}', true, false, 50);
  end if;
  select id into t_roll from public.it_label_templates where account_id = acct and is_default and deleted_at is null limit 1;
  select id into t_outdoor from public.it_label_templates where account_id = acct and is_outdoor and deleted_at is null
   order by sort_order limit 1;

  if not exists (select 1 from public.it_categories where account_id = acct) then
    insert into public.it_categories
      (account_id, name, kind, icon, requires_ip, default_monitoring, label_template_id, audit_interval_months, alert_delay_minutes, sort_order)
    values
      (acct, 'POS Terminal',          'asset', 'pos',           false, true,  t_roll,    null, 5,    10),
      (acct, 'Pay Station',           'asset', 'pay_station',   false, true,  t_outdoor, null, 5,    20),
      (acct, 'Tunnel Controller',     'asset', 'controller',    false, false, t_outdoor, null, 5,    30),
      (acct, 'Tablet',                'asset', 'tablet',        false, false, t_roll,    null, null, 40),
      (acct, 'Handheld Scanner',      'asset', 'scanner',       false, false, t_roll,    null, null, 50),
      (acct, 'Security Camera',       'asset', 'camera',        true,  false, t_outdoor, null, 15,   60),
      (acct, 'NVR',                   'asset', 'nvr',           true,  true,  t_roll,    null, 15,   70),
      (acct, 'LPR Camera',            'asset', 'lpr',           true,  false, t_outdoor, 3,    15,   80),
      (acct, 'LPR Server',            'asset', 'server',        true,  true,  t_roll,    3,    10,   90),
      (acct, 'Router/Firewall',       'asset', 'router',        true,  true,  t_roll,    null, 5,    100),
      (acct, 'Switch',                'asset', 'switch',        true,  false, t_roll,    null, 10,   110),
      (acct, 'Wi-Fi Access Point',    'asset', 'wifi',          true,  false, t_roll,    null, 15,   120),
      (acct, 'ISP Modem',             'asset', 'modem',         true,  true,  t_roll,    null, 5,    130),
      (acct, 'Cellular Backup Modem', 'asset', 'cellular',      false, false, t_roll,    null, 15,   140),
      (acct, 'Receipt Printer',       'asset', 'printer',       false, false, t_roll,    null, null, 150),
      (acct, 'Label Printer',         'asset', 'label_printer', false, false, t_roll,    null, null, 160),
      (acct, 'Signage Player',        'asset', 'signage',       false, false, t_roll,    null, 30,   170),
      (acct, 'Display',               'asset', 'display',       false, false, t_roll,    null, null, 180),
      (acct, 'UPS',                   'asset', 'ups',           false, false, t_roll,    null, 15,   190),
      (acct, 'Other',                 'asset', 'package',       false, false, t_roll,    null, null, 200),
      (acct, 'Receipt Paper',         'consumable', 'paper',    false, false, null,      null, null, 300),
      (acct, 'Label & Sticker Stock', 'consumable', 'sticker',  false, false, null,      null, null, 310),
      (acct, 'Internet Service',      'subscription', 'globe',  false, false, null,      null, null, 400),
      (acct, 'Cellular Plan',         'subscription', 'cellular', false, false, null,    null, null, 410),
      (acct, 'POS Software',          'subscription', 'pos',    false, false, null,      null, null, 420),
      (acct, 'LPR Service',           'subscription', 'lpr',    false, false, null,      null, null, 430),
      (acct, 'Camera Cloud',          'subscription', 'cloud',  false, false, null,      null, null, 440),
      (acct, 'Signage Software',      'subscription', 'signage', false, false, null,     null, null, 450),
      (acct, 'Other Software',        'subscription', 'key',    false, false, null,      null, null, 460);
  end if;

  if not exists (select 1 from public.it_status_labels where account_id = acct) then
    insert into public.it_status_labels (account_id, name, type, color, is_default, sort_order) values
      (acct, 'In Service',       'deployable',   'ok',      true,  10),
      (acct, 'Spare / In Stock', 'deployable',   'accent',  false, 20),
      (acct, 'Being Set Up',     'pending',      'neutral', false, 30),
      (acct, 'Out for Repair',   'undeployable', 'warn',    false, 40),
      (acct, 'Broken',           'undeployable', 'danger',  false, 50),
      (acct, 'Lost / Stolen',    'undeployable', 'danger',  false, 60),
      (acct, 'Retired',          'archived',     'neutral', false, 70);
  end if;

  if not exists (select 1 from public.it_maintenance_types where account_id = acct) then
    insert into public.it_maintenance_types (account_id, name, color, sort_order) values
      (acct, 'Repair', 'warn', 10),
      (acct, 'Preventive Maintenance', 'ok', 20),
      (acct, 'Upgrade', 'accent', 30),
      (acct, 'Replacement', 'neutral', 40),
      (acct, 'Vendor Service Call', 'neutral', 50),
      (acct, 'Firmware Update', 'accent', 60);
  end if;

  if not exists (select 1 from public.it_manufacturers where account_id = acct) then
    insert into public.it_manufacturers (account_id, name)
    select acct, m from unnest(array[
      'Sonny''s', 'DRB', 'ICS', 'PDQ', 'MacNeil', 'Ryko', 'Hanna', 'Unitec', 'FlexWash',
      'Ubiquiti', 'Cisco Meraki', 'Fortinet', 'SonicWall', 'Netgear', 'TP-Link', 'Cradlepoint', 'Peplink',
      'Dell', 'HP', 'Lenovo', 'Apple', 'Samsung', 'Zebra', 'Honeywell',
      'Epson', 'Star Micronics', 'Brother', 'DYMO',
      'Axis', 'Hikvision', 'Hanwha Vision', 'Lorex', 'Verkada',
      'APC', 'CyberPower', 'Eaton', 'BrightSign'
    ]) m;
  end if;

  -- Accessory categories (added 0197 with accessories).
  if not exists (select 1 from public.it_categories where account_id = acct and kind = 'accessory') then
    insert into public.it_categories (account_id, name, kind, icon, requires_ip, default_monitoring, sort_order) values
      (acct, 'Charger or Cable',  'accessory', 'plug',       false, false, 500),
      (acct, 'Case or Mount',     'accessory', 'package',    false, false, 510),
      (acct, 'Keyboard or Mouse', 'accessory', 'keyboard',   false, false, 520),
      (acct, 'Headset or Radio',  'accessory', 'headphones', false, false, 530),
      (acct, 'Other Accessory',   'accessory', 'package',    false, false, 540);
  end if;

  if not exists (select 1 from public.it_reminder_rules where account_id = acct) then
    insert into public.it_reminder_rules (account_id, kind, days_before, enabled) values
      (acct, 'warranty', '{60,30,7}', true),
      (acct, 'subscription_renewal', '{60,30,7}', true),
      (acct, 'audit_due', '{7}', true),
      (acct, 'eol', '{90,30}', true),
      (acct, 'low_stock', '{0}', true),
      (acct, 'sticker_reprint', '{0}', false),
      (acct, 'offline', '{0}', false);
  end if;

  -- Per site: default areas in walk order, and a Sticker Stock count.
  insert into public.it_site_areas (account_id, location_id, name, sort_order)
  select acct, l.id, a.name, a.ord
    from public.locations l
   cross join (values ('Pay Lane 1', 10), ('Pay Lane 2', 20), ('Tunnel', 30), ('Equipment Room', 40),
                      ('Office', 50), ('Vacuum Area', 60)) a(name, ord)
   where l.account_id = acct and not coalesce(l.archived, false)
     and not exists (select 1 from public.it_site_areas x where x.location_id = l.id);

  select id into c_sticker from public.it_categories
   where account_id = acct and kind = 'consumable' and icon = 'sticker' and deleted_at is null limit 1;
  insert into public.it_consumables (account_id, location_id, category_id, name, min_qty, is_sticker_stock)
  select acct, l.id, c_sticker, 'Asset Sticker Stock', 25, true
    from public.locations l
   where l.account_id = acct and not coalesce(l.archived, false)
     and not exists (select 1 from public.it_consumables x where x.location_id = l.id and x.is_sticker_stock and x.deleted_at is null);

  return s;
end $function$;
