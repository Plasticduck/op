-- Maintenance Inventory: stickers with a life, like IT Inventory's (docs/maintenance-inventory/EQUIPMENT.md).
--
-- A tag (MF-A-00012) is unused (a blank printed ahead of time), applied (on a machine,
-- bin, tool or location) or retired (replaced or worn out, never reused). Blank batches
-- go out on a roll; scanning one onto a machine claims it. A sticker's condition
-- (readable, faded, missing, damaged) puts the machine back in the print queue.
--
-- A retired tag keeps who it was on in former_entity_id and clears entity_id, so the
-- existing one-tag-per-thing rule and every "this thing's tag" lookup stay as they are.

alter table public.mi_tags
  add column if not exists status text not null default 'applied',
  add column if not exists source text not null default 'generated',
  add column if not exists batch_id uuid,
  add column if not exists site_id uuid references public.locations(id) on delete set null,
  add column if not exists applied_at timestamptz,
  add column if not exists retired_at timestamptz,
  add column if not exists former_entity_id uuid,
  add column if not exists condition text,
  add column if not exists condition_at timestamptz;
alter table public.mi_tags alter column entity_id drop not null;
alter table public.mi_tags drop constraint if exists mi_tags_status_check;
alter table public.mi_tags add constraint mi_tags_status_check check (status in ('unused', 'applied', 'retired'));
alter table public.mi_tags drop constraint if exists mi_tags_source_check;
alter table public.mi_tags add constraint mi_tags_source_check check (source in ('generated', 'pre_printed', 'imported', 'manual'));
alter table public.mi_tags drop constraint if exists mi_tags_condition_check;
alter table public.mi_tags add constraint mi_tags_condition_check check (condition is null or condition in ('ok', 'faded', 'missing', 'damaged'));
update public.mi_tags set applied_at = created_at where applied_at is null and status = 'applied';
alter table public.mi_tags drop constraint if exists mi_tags_applied_has_entity;
alter table public.mi_tags add constraint mi_tags_applied_has_entity check ((status = 'applied') = (entity_id is not null));
create index if not exists mi_tags_unused on public.mi_tags (account_id, batch_id) where status = 'unused';

-- A tag's code never changes, it never goes back to blank, and an applied tag never
-- moves to something else: it's retired and a new one is applied.
create or replace function public.mi__tags_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'applied' and new.applied_at is null then new.applied_at := now(); end if;
    return new;
  end if;
  if current_setting('mi.purge', true) = 'on' then return new; end if;
  if new.code <> old.code then raise exception 'A sticker''s code can''t change.'; end if;
  if new.status = 'unused' and old.status <> 'unused' then raise exception 'A used sticker can''t go back to blank.'; end if;
  if old.status = 'retired' and new.status <> 'retired' then raise exception '% was retired and can''t be used again.', old.code; end if;
  if old.status = 'applied' and new.status = 'applied' and new.entity_id is distinct from old.entity_id then
    raise exception '% is already on something else. Retire it and use a new sticker.', old.code;
  end if;
  if new.status = 'applied' and old.status = 'unused' then new.applied_at := coalesce(new.applied_at, now()); end if;
  if new.status = 'retired' and old.status <> 'retired' then
    new.retired_at := coalesce(new.retired_at, now());
    new.former_entity_id := coalesce(new.former_entity_id, old.entity_id);
    new.entity_id := null;
  end if;
  if new.condition is distinct from old.condition then new.condition_at := now(); end if;
  return new;
end;
$$;
drop trigger if exists mi_tags_guard on public.mi_tags;
create trigger mi_tags_guard before insert or update on public.mi_tags
  for each row execute function public.mi__tags_guard();

-- ---- Blank batches ----------------------------------------------------------------
-- Machine stickers only (MF-A-), from the same counter as stickers made on print.
create or replace function public.mi_generate_blank_tags(p_count integer, p_site uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  b uuid := gen_random_uuid();
  codes text[] := '{}';
  c text;
begin
  perform public.mi__require_rank(2, 'print blank stickers');
  if p_count is null or p_count < 1 or p_count > 2000 then raise exception 'Print between 1 and 2,000 at a time.'; end if;
  if p_site is not null and not p_site = any (public.auth_site_ids()) then raise exception 'That site isn''t one of yours.' using errcode = '42501'; end if;
  for i in 1..p_count loop
    c := 'MF-A-' || lpad(public.mi__next_number(acct, 'MF-A-')::text, 5, '0');
    insert into public.mi_tags (account_id, code, entity_type, entity_id, status, source, batch_id, site_id)
    values (acct, c, 'asset', null, 'unused', 'pre_printed', b, p_site);
    codes := codes || c;
  end loop;
  return jsonb_build_object('batch_id', b, 'codes', to_jsonb(codes));
end;
$$;

create or replace function public.mi_blank_tags(p_site uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
begin
  perform public.mi__require_rank(1, 'see blank stickers');
  return (
    select coalesce(jsonb_agg(jsonb_build_object('batch_id', x.batch_id, 'site_id', x.site_id, 'site_name', x.site_name, 'created_at', x.created_at,
             'count', x.n, 'first', x.first_code, 'last', x.last_code, 'printed', x.printed, 'codes', x.codes) order by x.created_at desc), '[]'::jsonb)
    from (
      select t.batch_id, t.site_id, (select l.name from public.locations l where l.id = t.site_id) as site_name, min(t.created_at) as created_at,
        count(*) as n, min(t.code) as first_code, max(t.code) as last_code, bool_and(t.printed_count > 0) as printed,
        array_agg(t.code order by t.code) as codes
      from public.mi_tags t
      where t.account_id = acct and t.status = 'unused' and (p_site is null or t.site_id = p_site or t.site_id is null)
        and (t.site_id is null or t.site_id = any (public.auth_site_ids()))
      group by t.batch_id, t.site_id
    ) x);
end;
$$;

-- ---- Putting a sticker on a machine -----------------------------------------------
-- From a scan of a blank sticker. p_replace swaps out a machine's old sticker (faded,
-- torn off): the old one is retired.
create or replace function public.mi_claim_tag(p_code text, p_asset uuid, p_replace boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  t public.mi_tags;
  e public.equipment;
  old_tag public.mi_tags;
begin
  select * into e from public.equipment where id = p_asset and account_id = acct;
  if not found or not e.location_id = any (public.auth_site_ids()) then raise exception 'Equipment not found.'; end if;
  if e.status = 'retired' then raise exception '% is retired. Restore it first.', e.name; end if;
  select * into t from public.mi_tags where account_id = acct and code = upper(trim(p_code)) for update;
  if not found then raise exception 'That sticker isn''t one of ours.'; end if;
  if t.status = 'applied' and t.entity_id = p_asset then return jsonb_build_object('code', t.code, 'already', true); end if;
  if t.status = 'applied' then raise exception '% is already on something else.', t.code; end if;
  if t.status = 'retired' then raise exception '% was retired and can''t be used again.', t.code; end if;
  if t.entity_type <> 'asset' then raise exception '% is a % sticker, not a machine sticker.', t.code, t.entity_type; end if;

  select * into old_tag from public.mi_tags where entity_type = 'asset' and entity_id = p_asset for update;
  if old_tag.id is not null then
    if not p_replace then raise exception '% already has sticker %. Replace it?', e.name, old_tag.code; end if;
    update public.mi_tags set status = 'retired' where id = old_tag.id;
    insert into public.mi_equipment_events (account_id, location_id, equipment_id, action, actor_user_id, actor_name, note)
    values (acct, e.location_id, e.id, 'tag_retired', auth.uid(), public.mi__actor_name(auth.uid()), old_tag.code);
  end if;
  update public.mi_tags set status = 'applied', entity_id = p_asset, site_id = e.location_id, condition = 'ok' where id = t.id;
  insert into public.mi_equipment_events (account_id, location_id, equipment_id, action, actor_user_id, actor_name, note)
  values (acct, e.location_id, e.id, 'tag_applied', auth.uid(), public.mi__actor_name(auth.uid()), t.code);
  return jsonb_build_object('code', t.code, 'replaced', old_tag.code);
end;
$$;

create or replace function public.mi_retire_tag(p_code text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  t public.mi_tags;
  loc uuid;
begin
  perform public.mi__require_rank(2, 'retire stickers');
  select * into t from public.mi_tags where account_id = acct and code = upper(trim(p_code)) for update;
  if not found then raise exception 'Sticker not found.'; end if;
  if t.status = 'retired' then return; end if;
  if t.entity_type = 'asset' and t.entity_id is not null then
    select location_id into loc from public.equipment where id = t.entity_id;
    if not loc = any (public.auth_site_ids()) then raise exception 'That machine isn''t at one of your sites.' using errcode = '42501'; end if;
    insert into public.mi_equipment_events (account_id, location_id, equipment_id, action, actor_user_id, actor_name, note)
    values (acct, loc, t.entity_id, 'tag_retired', auth.uid(), public.mi__actor_name(auth.uid()), t.code || coalesce(': ' || nullif(trim(p_reason), ''), ''));
  end if;
  update public.mi_tags set status = 'retired' where id = t.id;
end;
$$;

-- Readable, faded, missing or damaged: anything but readable goes back in the print queue.
create or replace function public.mi_set_tag_condition(p_codes text[], p_condition text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  n integer;
begin
  if p_condition not in ('ok', 'faded', 'missing', 'damaged') then raise exception 'Pick readable, faded, missing or damaged.'; end if;
  update public.mi_tags t set condition = p_condition
  where t.account_id = acct and t.code = any (select upper(trim(c)) from unnest(p_codes) c) and t.status = 'applied'
    and (t.entity_type <> 'asset' or exists (select 1 from public.equipment e where e.id = t.entity_id and e.location_id = any (public.auth_site_ids())));
  get diagnostics n = row_count;
  return jsonb_build_object('changed', n);
end;
$$;

-- Machines that need a sticker printed: none yet, never printed, or marked faded,
-- missing or damaged. Machines only; components don't get stickers.
create or replace function public.mi_sticker_queue(p_site uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
begin
  return (
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', e.id, 'name', e.name, 'type', e.type, 'location_id', e.location_id,
             'site_name', l.name, 'area_name', a.name, 'tag', t.code, 'printed_count', coalesce(t.printed_count, 0), 'condition', t.condition,
             'reason', case when t.id is null then 'none' when t.condition in ('faded', 'missing', 'damaged') then t.condition else 'never_printed' end))
           order by l.name, a.sort_order nulls last, e.name), '[]'::jsonb)
    from public.equipment e
    join public.locations l on l.id = e.location_id
    left join public.mi_areas a on a.id = e.area_id
    left join public.mi_tags t on t.entity_type = 'asset' and t.entity_id = e.id
    where e.account_id = acct and e.location_id = any (public.auth_site_ids()) and (p_site is null or e.location_id = p_site)
      and e.parent_asset_id is null and e.status <> 'retired'
      and (t.id is null or t.printed_count = 0 or t.condition in ('faded', 'missing', 'damaged')));
end;
$$;

-- Printing a machine's sticker shows on its history; a reprint makes it readable again.
create or replace function public.mi_mark_printed(p_codes text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
begin
  update public.mi_tags set printed_count = printed_count + 1, last_printed_at = now(),
    condition = case when condition in ('faded', 'missing', 'damaged') then null else condition end
  where account_id = acct and code = any (p_codes);
  insert into public.mi_equipment_events (account_id, location_id, equipment_id, action, actor_user_id, actor_name, note)
  select acct, e.location_id, e.id, 'label_printed', auth.uid(), public.mi__actor_name(auth.uid()), t.code
  from public.mi_tags t join public.equipment e on e.id = t.entity_id
  where t.account_id = acct and t.code = any (p_codes) and t.entity_type = 'asset' and t.status = 'applied';
end;
$$;

-- ---- Scanning ---------------------------------------------------------------------
-- As before, plus: a blank sticker says so (so it can be put on a machine), and a
-- retired one says what it used to be on.
create or replace function public.mi_resolve_scan(p_raw text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  v_code text := upper(trim(p_raw));
  v_digits text := case when trim(p_raw) ~ '^[0-9]{6,14}$' then ltrim(trim(p_raw), '0') end;
  tag public.mi_tags;
  part_id uuid;
  asset_id uuid;
  po uuid;
begin
  if v_code = '' then return jsonb_build_object('kind', 'unknown', 'raw', p_raw); end if;
  select * into tag from public.mi_tags t where t.account_id = acct and t.code = v_code;
  if found then
    if tag.status = 'unused' then return jsonb_build_object('kind', 'blank', 'code', v_code, 'entity_type', tag.entity_type); end if;
    if tag.status = 'retired' then
      return jsonb_build_object('kind', 'retired', 'code', v_code, 'entity_type', tag.entity_type, 'former_id', tag.former_entity_id,
        'former_name', case when tag.entity_type = 'asset' then (select e.name from public.equipment e where e.id = tag.former_entity_id) end,
        'current_code', case when tag.entity_type = 'asset' then (select x.code from public.mi_tags x where x.entity_type = 'asset' and x.entity_id = tag.former_entity_id) end);
    end if;
    if tag.entity_type = 'bin' then return public.mi__scan_bin(tag.entity_id, v_code); end if;
    return jsonb_build_object('kind', tag.entity_type, 'code', v_code, 'id', tag.entity_id);
  end if;

  select p.id into part_id from public.parts p
  where p.account_id = acct and (p.barcode = trim(p_raw) or ltrim(p.barcode, '0') = v_digits
    or upper(p.qr_code) = v_code or upper(p.mfr_part_number) = v_code or upper(p.sku) = v_code)
  order by (p.barcode = trim(p_raw) or ltrim(p.barcode, '0') = v_digits) desc nulls last limit 1;
  if part_id is null then
    select pv.part_id into part_id from public.mi_part_vendors pv where pv.account_id = acct and upper(pv.vendor_part_number) = v_code limit 1;
  end if;
  if part_id is not null then return public.mi__scan_part(part_id, v_code); end if;

  select e.id into asset_id from public.equipment e where e.account_id = acct and upper(e.qr_code) = v_code limit 1;
  if asset_id is not null then return jsonb_build_object('kind', 'asset', 'code', v_code, 'id', asset_id); end if;

  select o.id into po from public.mi_purchase_orders o
  where o.account_id = acct and v_code ~ '^PO-?[0-9]+$' and o.number = regexp_replace(v_code, '[^0-9]', '', 'g')::int;
  if po is not null then return jsonb_build_object('kind', 'po', 'code', v_code, 'id', po); end if;

  return jsonb_build_object('kind', 'unknown', 'raw', p_raw);
end;
$$;

-- Offline scanning only needs stickers that are on something.
create or replace function public.mi_offline_snapshot() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  vis uuid[] := public.mi_visible_location_ids();
begin
  return jsonb_build_object(
    'at', now(),
    'tags', (select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'entity_type', t.entity_type, 'entity_id', t.entity_id)), '[]'::jsonb)
             from public.mi_tags t where t.account_id = acct and t.status = 'applied'),
    'stock', (select coalesce(jsonb_agg(public.mi__stock_row(s)), '[]'::jsonb) from public.mi_stock_levels s where s.location_id = any (vis)),
    'barcodes', (select coalesce(jsonb_agg(jsonb_build_object('code', upper(p.barcode), 'part_id', p.id, 'name', p.name)), '[]'::jsonb) from public.parts p where p.account_id = acct and coalesce(p.barcode, '') <> ''),
    'work_orders', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'number', w.number, 'title', w.title, 'location_id', w.location_id, 'equipment_id', w.equipment_id)), '[]'::jsonb)
                    from public.work_orders w where w.account_id = acct and w.status in ('open', 'in_progress', 'on_hold') and w.location_id = any (public.auth_site_ids())),
    'tools', (select coalesce(jsonb_agg(to_jsonb(t) - 'notes'), '[]'::jsonb) from public.mi_tools t where t.account_id = acct and (t.custodian_user_id = auth.uid() or t.home_location_id = any (vis))),
    'locations', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'site_id', l.site_id, 'type', l.type)), '[]'::jsonb) from public.mi_stock_locations l where l.id = any (vis)));
end;
$$;

-- ---- The list shows a sticker's condition ------------------------------------------
create or replace function public.mi_equipment_list(p_include_retired boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  sites uuid[] := public.auth_site_ids();
  today date := public.mi__today(acct);
begin
  return jsonb_build_object(
    'today', today,
    'rows', (
      with eq as (
        select e.* from public.equipment e
        where e.account_id = acct and e.location_id = any (sites) and (p_include_retired or e.status <> 'retired')
      ),
      resets as (
        select g.asset_id, max(public.mi__local_date(acct, g.performed_at)) as on_date
        from public.mi_log_entries g
        where g.account_id = acct and g.resets_usage and g.voided_at is null and g.asset_id is not null
        group by 1
      ),
      kids as (
        select x.parent_asset_id as id, count(*) as n from public.equipment x
        where x.account_id = acct and x.parent_asset_id is not null and x.status <> 'retired' group by 1
      ),
      bom as (select pa.asset_id as id, count(*) as n from public.part_assets pa join eq on eq.id = pa.asset_id group by 1),
      wos as (
        select w.equipment_id as id, count(*) as n from public.work_orders w
        where w.account_id = acct and w.equipment_id is not null and w.status in ('open', 'in_progress', 'on_hold') group by 1
      ),
      diag as (select distinct i.asset_id as id from public.mi_tunnel_items i where i.account_id = acct and i.asset_id is not null)
      select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', e.id, 'location_id', e.location_id, 'name', e.name, 'type', e.type, 'status', e.status, 'parent_id', e.parent_asset_id,
        'area_id', e.area_id, 'crit_class', e.crit_class, 'manufacturer', e.manufacturer, 'model', e.model, 'serial_number', e.serial_number,
        'asset_number', e.asset_number, 'install_date', e.install_date, 'warranty_expiry', e.warranty_expiry,
        'last_serviced_at', e.last_serviced_at, 'last_audited_at', e.last_audited_at, 'retired_at', e.retired_at,
        'usage_basis', e.usage_basis, 'maintainx_id', e.maintainx_id,
        'tag', t.code, 'tag_printed', t.printed_count > 0, 'tag_condition', t.condition,
        'on_diagram', case when dg.id is not null then true end,
        'children', coalesce(k.n, 0), 'bom_lines', coalesce(b.n, 0), 'open_wos', coalesce(w.n, 0),
        'usage_since', u.since,
        'cars_since', case when u.since is not null and e.usage_basis <> 'none' then (
          select coalesce(sum(coalesce(m.drb_cars, 0) - coalesce(m.drb_test_cars, 0) + coalesce(m.flex_cars, 0)), 0)
          from public.site_daily_metrics m
          where m.account_id = acct and m.site_number = public.mi__site_number(e.location_id) and m.date >= u.since and m.date <= today) end
      ))), '[]'::jsonb)
      from eq e
      left join public.mi_tags t on t.entity_type = 'asset' and t.entity_id = e.id
      left join kids k on k.id = e.id
      left join bom b on b.id = e.id
      left join wos w on w.id = e.id
      left join resets r on r.asset_id = e.id
      left join diag dg on dg.id = e.id
      cross join lateral (select greatest(e.install_date, r.on_date) as since) u
    ),
    'areas', (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'site_id', a.site_id, 'name', a.name, 'sort_order', a.sort_order)
             order by a.sort_order, a.name), '[]'::jsonb)
      from public.mi_areas a where a.account_id = acct and a.site_id = any (sites)
    ),
    'sites', (
      select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'site_number', sn.n, 'cars_30d', c.c30, 'data_through', c.last)
             order by l.name), '[]'::jsonb)
      from public.locations l
      cross join lateral (select public.mi__site_number(l.id) as n) sn
      left join lateral (
        select sum(coalesce(m.drb_cars, 0) - coalesce(m.drb_test_cars, 0) + coalesce(m.flex_cars, 0)) as c30, max(m.date) as last
        from public.site_daily_metrics m where m.account_id = acct and m.site_number = sn.n and m.date > today - 30
      ) c on true
      where l.id = any (sites)
    )
  );
end;
$$;

-- ---- Grants ---------------------------------------------------------------------------
revoke all on function public.mi__tags_guard() from public, anon, authenticated;
revoke all on function public.mi_generate_blank_tags(integer, uuid) from public, anon;
revoke all on function public.mi_blank_tags(uuid) from public, anon;
revoke all on function public.mi_claim_tag(text, uuid, boolean) from public, anon;
revoke all on function public.mi_retire_tag(text, text) from public, anon;
revoke all on function public.mi_set_tag_condition(text[], text) from public, anon;
revoke all on function public.mi_sticker_queue(uuid) from public, anon;
revoke all on function public.mi_mark_printed(text[]) from public, anon;
revoke all on function public.mi_resolve_scan(text) from public, anon;
revoke all on function public.mi_offline_snapshot() from public, anon;
revoke all on function public.mi_equipment_list(boolean) from public, anon;
grant execute on function public.mi_generate_blank_tags(integer, uuid) to authenticated;
grant execute on function public.mi_blank_tags(uuid) to authenticated;
grant execute on function public.mi_claim_tag(text, uuid, boolean) to authenticated;
grant execute on function public.mi_retire_tag(text, text) to authenticated;
grant execute on function public.mi_set_tag_condition(text[], text) to authenticated;
grant execute on function public.mi_sticker_queue(uuid) to authenticated;
grant execute on function public.mi_mark_printed(text[]) to authenticated;
grant execute on function public.mi_resolve_scan(text) to authenticated;
grant execute on function public.mi_offline_snapshot() to authenticated;
grant execute on function public.mi_equipment_list(boolean) to authenticated;

-- ---- The machine page shows its sticker's condition ------------------------------------
create or replace function public.mi_equipment_detail(p_asset uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  d jsonb := public.mi_asset_detail(p_asset);
  e public.equipment;
  t public.mi_tags;
begin
  if d ? 'hidden' then return d; end if;
  select * into e from public.equipment where id = p_asset;
  select * into t from public.mi_tags where entity_type = 'asset' and entity_id = p_asset;
  return d || jsonb_build_object(
    'asset', (d -> 'asset') || jsonb_build_object(
      'tag_printed_count', coalesce(t.printed_count, 0),
      'tag_last_printed_at', t.last_printed_at,
      'tag_condition', t.condition,
      'site_number', public.mi__site_number(e.location_id),
      'can_manage', public.mi_rank() >= 2,
      'can_move_site', public.mi_rank() >= 4),
    'children', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'type', c.type, 'status', c.status, 'crit_class', c.crit_class,
               'children', (select count(*) from public.equipment g where g.parent_asset_id = c.id and g.status <> 'retired'))
             order by c.status = 'retired', c.name), '[]'::jsonb)
      from public.equipment c where c.parent_asset_id = e.id),
    'ancestors', (
      with recursive up as (
        select p.id, p.name, p.parent_asset_id, 1 as depth from public.equipment p where p.id = e.parent_asset_id
        union all
        select p.id, p.name, p.parent_asset_id, up.depth + 1 from public.equipment p join up on p.id = up.parent_asset_id where up.depth < 10
      )
      select coalesce(jsonb_agg(jsonb_build_object('id', up.id, 'name', up.name) order by up.depth desc), '[]'::jsonb) from up),
    'usage', (select to_jsonb(u) from public.mi__usage(acct, array[p_asset]) u),
    'resets', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('id', g.id, 'on', public.mi__local_date(acct, g.performed_at), 'notes', g.notes, 'by', g.performed_by_name) as x
        from public.mi_log_entries g
        where g.asset_id = e.id and g.resets_usage and g.voided_at is null
        order by g.performed_at desc limit 10) q),
    -- Where it is on its site's drawing; a component shows through its machine.
    'diagram', (
      with recursive up as (
        select e.id, e.parent_asset_id, 0 as depth
        union all
        select p.id, p.parent_asset_id, up.depth + 1 from public.equipment p join up on p.id = up.parent_asset_id where up.depth < 10
      )
      select coalesce(jsonb_agg(jsonb_build_object('layout_id', l.id, 'item_id', i.id, 'label', i.label, 'tunnel_no', l.tunnel_no, 'via_parent', up.depth > 0)
             order by up.depth, l.tunnel_no, i.sort_order), '[]'::jsonb)
      from up
      join public.mi_tunnel_items i on i.asset_id = up.id
      join public.mi_tunnel_layouts l on l.id = i.layout_id and l.location_id = e.location_id));
end;
$$;

revoke all on function public.mi_equipment_detail(uuid) from public, anon;
grant execute on function public.mi_equipment_detail(uuid) to authenticated;
