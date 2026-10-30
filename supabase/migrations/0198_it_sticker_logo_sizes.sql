-- IT Inventory Phase 2 (2026-10-30): the company's logo on stickers, and
-- more label sizes.
--
-- Logo: an Admin adds one on the Stickers page (uploaded, or the account's
-- brand logo). The app turns it black and white and trims it before storing
-- it in the private it-inventory bucket at <account>/branding/...; the path
-- lives in it_settings.label_logo_path. It prints on a stock when the stock's
-- layout.show has 'logo', label_show_logo is on, and there's room beside the
-- QR (never over the QR or barcode).
--
-- Sizes: five more common rolls (Zebra 2 x 1 and 3 x 2 in, DYMO 30336 and
-- 30252, Brother DK-1201), the Avery inkjet equivalents named on the laser
-- ones (8160, 8163), and Admins can add their own size on the Stickers page.

alter table public.it_settings add column if not exists label_logo_path text;

-- Existing accounts: the new sizes (new accounts get them from it_bootstrap).
insert into public.it_label_templates (account_id, name, kind, page_spec, layout, sort_order)
select s.account_id, v.name, v.kind, v.page_spec::jsonb, v.layout::jsonb, v.sort_order
  from public.it_settings s
 cross join (values
  ('Roll 2 x 1 in (Zebra, Rollo)', 'roll',
   '{"page": null, "label": {"w_mm": 50.8, "h_mm": 25.4}, "cols": 1, "rows": 1, "margin_top_mm": 0, "margin_left_mm": 0, "pitch_x_mm": 50.8, "pitch_y_mm": 25.4}',
   '{"style": "standard", "show": ["qr", "barcode", "tag", "name", "site"]}', 12),
  ('Roll 3 x 2 in (Zebra, Rollo)', 'roll',
   '{"page": null, "label": {"w_mm": 76.2, "h_mm": 50.8}, "cols": 1, "rows": 1, "margin_top_mm": 0, "margin_left_mm": 0, "pitch_x_mm": 76.2, "pitch_y_mm": 50.8}',
   '{"style": "standard", "show": ["qr", "barcode", "tag", "name", "site", "phone", "logo"]}', 14),
  ('DYMO 30336 (1 x 2-1/8 in)', 'roll',
   '{"page": null, "label": {"w_mm": 53.975, "h_mm": 25.4}, "cols": 1, "rows": 1, "margin_top_mm": 0, "margin_left_mm": 0, "pitch_x_mm": 53.975, "pitch_y_mm": 25.4}',
   '{"style": "standard", "show": ["qr", "barcode", "tag", "name", "site"]}', 16),
  ('DYMO 30252 address (1-1/8 x 3-1/2 in)', 'roll',
   '{"page": null, "label": {"w_mm": 88.9, "h_mm": 28.575}, "cols": 1, "rows": 1, "margin_top_mm": 0, "margin_left_mm": 0, "pitch_x_mm": 88.9, "pitch_y_mm": 28.575}',
   '{"style": "standard", "show": ["qr", "barcode", "tag", "name", "site", "logo"]}', 18),
  ('Brother QL 29 x 90 mm (DK-1201)', 'roll',
   '{"page": null, "label": {"w_mm": 90.3, "h_mm": 29}, "cols": 1, "rows": 1, "margin_top_mm": 0, "margin_left_mm": 0, "pitch_x_mm": 90.3, "pitch_y_mm": 29}',
   '{"style": "standard", "show": ["qr", "barcode", "tag", "name", "site", "logo"]}', 22)
 ) as v(name, kind, page_spec, layout, sort_order)
 where exists (select 1 from public.it_label_templates t where t.account_id = s.account_id)
   and not exists (select 1 from public.it_label_templates t
                    where t.account_id = s.account_id and t.name = v.name and t.deleted_at is null);

update public.it_label_templates set name = 'Avery 5160 / 8160 sheet (1 x 2-5/8 in, 30 per page)'
 where name = 'Avery 5160 sheet (1 x 2-5/8 in, 30 per page)';
update public.it_label_templates set name = 'Avery 5163 / 8163 sheet (2 x 4 in, 10 per page)'
 where name = 'Avery 5163 sheet (2 x 4 in, 10 per page)';

-- it_bootstrap as of 0197, seeding the new sizes for new accounts.
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
      (acct, 'Roll 2 x 1 in (Zebra, Rollo)', 'roll',
       '{"page": null, "label": {"w_mm": 50.8, "h_mm": 25.4}, "cols": 1, "rows": 1, "margin_top_mm": 0, "margin_left_mm": 0, "pitch_x_mm": 50.8, "pitch_y_mm": 25.4}',
       '{"style": "standard", "show": ["qr", "barcode", "tag", "name", "site"]}', false, false, 12),
      (acct, 'Roll 3 x 2 in (Zebra, Rollo)', 'roll',
       '{"page": null, "label": {"w_mm": 76.2, "h_mm": 50.8}, "cols": 1, "rows": 1, "margin_top_mm": 0, "margin_left_mm": 0, "pitch_x_mm": 76.2, "pitch_y_mm": 50.8}',
       '{"style": "standard", "show": ["qr", "barcode", "tag", "name", "site", "phone", "logo"]}', false, false, 14),
      (acct, 'DYMO 30336 (1 x 2-1/8 in)', 'roll',
       '{"page": null, "label": {"w_mm": 53.975, "h_mm": 25.4}, "cols": 1, "rows": 1, "margin_top_mm": 0, "margin_left_mm": 0, "pitch_x_mm": 53.975, "pitch_y_mm": 25.4}',
       '{"style": "standard", "show": ["qr", "barcode", "tag", "name", "site"]}', false, false, 16),
      (acct, 'DYMO 30252 address (1-1/8 x 3-1/2 in)', 'roll',
       '{"page": null, "label": {"w_mm": 88.9, "h_mm": 28.575}, "cols": 1, "rows": 1, "margin_top_mm": 0, "margin_left_mm": 0, "pitch_x_mm": 88.9, "pitch_y_mm": 28.575}',
       '{"style": "standard", "show": ["qr", "barcode", "tag", "name", "site", "logo"]}', false, false, 18),
      (acct, 'Brother QL 62 x 29 mm (DK-11209)', 'roll',
       '{"page": null, "label": {"w_mm": 62, "h_mm": 29}, "cols": 1, "rows": 1, "margin_top_mm": 0, "margin_left_mm": 0, "pitch_x_mm": 62, "pitch_y_mm": 29}',
       '{"style": "standard", "show": ["qr", "barcode", "tag", "name", "site"]}', false, false, 20),
      (acct, 'Brother QL 29 x 90 mm (DK-1201)', 'roll',
       '{"page": null, "label": {"w_mm": 90.3, "h_mm": 29}, "cols": 1, "rows": 1, "margin_top_mm": 0, "margin_left_mm": 0, "pitch_x_mm": 90.3, "pitch_y_mm": 29}',
       '{"style": "standard", "show": ["qr", "barcode", "tag", "name", "site", "logo"]}', false, false, 22),
      (acct, 'Avery 5160 / 8160 sheet (1 x 2-5/8 in, 30 per page)', 'sheet',
       '{"page": {"w_mm": 215.9, "h_mm": 279.4}, "label": {"w_mm": 66.675, "h_mm": 25.4}, "cols": 3, "rows": 10, "margin_top_mm": 12.7, "margin_left_mm": 4.7625, "pitch_x_mm": 69.85, "pitch_y_mm": 25.4}',
       '{"style": "compact", "show": ["qr", "barcode", "tag", "name", "site"]}', false, false, 30),
      (acct, 'Avery 5163 / 8163 sheet (2 x 4 in, 10 per page)', 'sheet',
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
