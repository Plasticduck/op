-- IT Inventory, Phase 1 setup and RPCs (2026-10-30).
--
-- it_bootstrap(): sets an account up the first time anyone on the IT side opens
-- the module (settings, categories, status labels, label templates, reminder
-- rules, manufacturers), then on every call fills in anything new sites are
-- missing (default areas, a Sticker Stock row). Idempotent; safe to call on
-- every visit.

create or replace function public.it_bootstrap()
returns public.it_settings language plpgsql security definer set search_path = public as $$
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
end $$;

-- What a scanned or typed tag means for the caller. p_short is the account code
-- from a sticker's QR link (null for a typed tag or a USB/Bluetooth scan).
--   asset          -> open it
--   unused         -> a blank pre-printed sticker: Quick Add with the tag filled in
--   unknown        -> offer to add an asset with this tag
--   other_account  -> the sticker belongs to another company
--   no_access      -> real asset at a site the caller can't see
create or replace function public.it_resolve_tag(p_short text, p_tag text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  acct   uuid := auth_account_id();
  target uuid;
  t      public.it_asset_tags%rowtype;
  a      public.it_assets%rowtype;
  v_tag  text := upper(btrim(coalesce(p_tag, '')));
begin
  if acct is null then
    return jsonb_build_object('result', 'signed_out');
  end if;
  if nullif(btrim(coalesce(p_short, '')), '') is not null then
    select account_id into target from public.it_settings where short_code = lower(btrim(p_short));
    if target is null then
      return jsonb_build_object('result', 'unknown', 'tag', v_tag);
    elsif target <> acct then
      return jsonb_build_object('result', 'other_account', 'tag', v_tag);
    end if;
  end if;
  if v_tag = '' then
    return jsonb_build_object('result', 'unknown', 'tag', v_tag);
  end if;

  select * into t from public.it_asset_tags where account_id = acct and tag = v_tag;
  if found then
    if t.status = 'unused' then
      return jsonb_build_object('result', 'unused', 'tag', t.tag);
    end if;
    select * into a from public.it_assets where id = t.asset_id;
  else
    -- A serial number scanned off the device works too.
    select * into a from public.it_assets
     where account_id = acct and upper(serial) = v_tag and deleted_at is null limit 1;
  end if;

  if a.id is null then
    return jsonb_build_object('result', 'unknown', 'tag', v_tag);
  end if;
  if not it_can_read(a.location_id) then
    return jsonb_build_object('result', 'no_access', 'tag', a.asset_tag,
                              'site', (select name from public.locations where id = a.location_id));
  end if;
  return jsonb_build_object('result', 'asset', 'asset_id', a.id, 'tag', a.asset_tag,
                            'archived', a.deleted_at is not null);
end $$;

-- Likely duplicates before saving: same serial or MAC anywhere in the account.
-- For an asset at a site the caller can't see, only the tag and site come back.
-- p_mac must be normalized to aa:bb:cc:dd:ee:ff by the caller.
create or replace function public.it_find_duplicates(p_serial text, p_mac text, p_exclude uuid default null)
returns table (field text, asset_id uuid, asset_tag text, asset_name text, site_name text, can_open boolean)
language sql stable security definer set search_path = public as $$
  select d.field, case when d.vis then d.id end, d.asset_tag, case when d.vis then d.name end, d.site, d.vis
  from (
    select 'serial'::text field, a.id, a.asset_tag, a.name, l.name site, it_can_read(a.location_id) vis
      from public.it_assets a join public.locations l on l.id = a.location_id
     where a.account_id = auth_account_id() and a.deleted_at is null
       and nullif(btrim(coalesce(p_serial, '')), '') is not null
       and upper(a.serial) = upper(btrim(p_serial))
       and (p_exclude is null or a.id <> p_exclude)
    union all
    select 'mac', a.id, a.asset_tag, a.name, l.name, it_can_read(a.location_id)
      from public.it_assets a join public.locations l on l.id = a.location_id
     where a.account_id = auth_account_id() and a.deleted_at is null
       and nullif(btrim(coalesce(p_mac, '')), '') is not null
       and a.mac_address::text = lower(btrim(p_mac))
       and (p_exclude is null or a.id <> p_exclude)
  ) d
  where it_is_staff()
$$;

-- A batch of blank tags for a pre-printed sticker order.
create or replace function public.it_generate_tags(p_count integer, p_location uuid default null)
returns setof public.it_asset_tags language plpgsql security definer set search_path = public as $$
declare
  acct  uuid := auth_account_id();
  batch uuid := gen_random_uuid();
begin
  if acct is null or not it_is_staff() then
    raise exception 'Only admins, managers and technicians can make tags';
  end if;
  if p_count is null or p_count < 1 or p_count > 2000 then
    raise exception 'Make between 1 and 2,000 tags at a time';
  end if;
  if p_location is not null and not it_can_write(p_location) then
    raise exception 'You can''t make tags for that site';
  end if;
  for i in 1..p_count loop
    insert into public.it_asset_tags (account_id, tag, status, source, batch_id, location_id)
    values (acct, public.it_next_tag(acct, p_location), 'unused', 'pre_printed', batch, p_location);
  end loop;
  return query select * from public.it_asset_tags where batch_id = batch order by tag;
end $$;

-- Secret custom fields (e.g. an admin password), stored in Supabase Vault.
-- Owner-only. Setting logs that it changed (never the value); every reveal is
-- logged as secret_revealed.
create or replace function public.it_set_secret(p_asset uuid, p_field uuid, p_value text)
returns void language plpgsql security definer set search_path = public as $$
declare
  a        public.it_assets%rowtype;
  f        public.it_custom_fields%rowtype;
  existing uuid;
begin
  if not it_is_admin() then
    raise exception 'Only admins can change secret fields';
  end if;
  select * into a from public.it_assets where id = p_asset and account_id = auth_account_id();
  select * into f from public.it_custom_fields where id = p_field and account_id = auth_account_id() and field_type = 'secret';
  if a.id is null or f.id is null then
    raise exception 'Unknown asset or field';
  end if;
  select secret_id into existing from public.it_asset_secrets where asset_id = p_asset and field_id = p_field;
  if coalesce(p_value, '') = '' then
    if existing is not null then
      delete from public.it_asset_secrets where asset_id = p_asset and field_id = p_field;
      delete from vault.secrets where id = existing;
    end if;
  elsif existing is null then
    insert into public.it_asset_secrets (account_id, asset_id, field_id, secret_id)
    values (a.account_id, p_asset, p_field, vault.create_secret(p_value, 'it_asset_' || p_asset || '_' || p_field));
  else
    perform vault.update_secret(existing, p_value);
  end if;
  insert into public.it_activity_log
    (account_id, location_id, asset_id, entity_type, entity_id, action, actor_user_id, actor_name, after)
  values (a.account_id, a.location_id, a.id, 'asset', a.id, 'updated', auth.uid(),
          (select name from public.users where id = auth.uid()),
          jsonb_build_object('secret_field', f.name, 'value', case when coalesce(p_value, '') = '' then 'cleared' else 'changed' end));
end $$;

create or replace function public.it_reveal_secret(p_asset uuid, p_field uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  a   public.it_assets%rowtype;
  sid uuid;
  val text;
begin
  if not it_is_admin() then
    raise exception 'Only admins can see secret fields';
  end if;
  select * into a from public.it_assets where id = p_asset and account_id = auth_account_id();
  select secret_id into sid from public.it_asset_secrets where asset_id = p_asset and field_id = p_field;
  if a.id is null or sid is null then
    return null;
  end if;
  select decrypted_secret into val from vault.decrypted_secrets where id = sid;
  insert into public.it_activity_log
    (account_id, location_id, asset_id, entity_type, entity_id, action, actor_user_id, actor_name, after)
  values (a.account_id, a.location_id, a.id, 'asset', a.id, 'secret_revealed', auth.uid(),
          (select name from public.users where id = auth.uid()),
          jsonb_build_object('field', (select name from public.it_custom_fields where id = p_field)));
  return val;
end $$;

revoke execute on function public.it_bootstrap(), public.it_resolve_tag(text, text),
  public.it_find_duplicates(text, text, uuid), public.it_generate_tags(integer, uuid),
  public.it_set_secret(uuid, uuid, text), public.it_reveal_secret(uuid, uuid) from public, anon;
grant execute on function public.it_bootstrap(), public.it_resolve_tag(text, text),
  public.it_find_duplicates(text, text, uuid), public.it_generate_tags(integer, uuid),
  public.it_set_secret(uuid, uuid, text), public.it_reveal_secret(uuid, uuid) to authenticated, service_role;
