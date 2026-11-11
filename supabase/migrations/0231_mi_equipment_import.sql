-- Maintenance Inventory: import equipment from a spreadsheet (docs/maintenance-inventory/EQUIPMENT.md).
--
-- One row per machine or component. Rows match an existing machine by sticker tag, then
-- asset number, then MaintainX id, then site and name; anything else is added. "parent"
-- names the machine a component belongs to (by name or sticker, at the same site, and it
-- can be a row higher up in the same file). A tag column claims a blank sticker or
-- records one already on the machine. The preview runs the real import and rolls it
-- back, so it shows exactly what will happen; committing is all or nothing.

create or replace function public.mi_import_equipment(p_rows jsonb, p_commit boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  sites uuid[] := public.auth_site_ids();
  results jsonb := '[]'::jsonb;
  errors integer := 0;
  created integer := 0;
  updated integer := 0;
begin
  perform public.mi__require_rank(4, 'import equipment');
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be a list.'; end if;
  if jsonb_array_length(p_rows) > 3000 then raise exception 'That''s more than 3,000 rows. Split the file.'; end if;
  begin
    declare
      r jsonb;
      i integer := 0;
      v_site uuid;
      v_id uuid;
      v_parent uuid;
      v_area uuid;
      v_vendor uuid;
      v_status text;
      v_crit text;
      v_basis text;
      v_tag text;
      t public.mi_tags;
      was_new boolean;
      nm text;
      raw text;
    begin
      perform set_config('mi.action', 'imported', true);
      for r in select * from jsonb_array_elements(p_rows) loop
        i := i + 1;
        v_site := null; v_id := null; v_parent := null; v_area := null; v_vendor := null; v_status := null; v_crit := null; v_basis := null; was_new := false;
        nm := nullif(trim(coalesce(r ->> 'name', '')), '');
        begin
          if coalesce(trim(r ->> 'site'), '') = '' then raise exception 'Needs a site.'; end if;
          select id into v_site from public.locations
          where account_id = acct and not archived and lower(name) = lower(trim(r ->> 'site')) and id = any (sites);
          if v_site is null then raise exception 'Site "%" isn''t one of yours.', trim(r ->> 'site'); end if;

          v_tag := nullif(upper(trim(coalesce(r ->> 'tag', ''))), '');
          if v_tag is not null and v_tag !~ '^[A-Z0-9][A-Z0-9-]{1,31}$' then raise exception 'Sticker "%" isn''t a sticker code.', v_tag; end if;

          -- Which machine this row is: sticker, asset number, MaintainX id, then site and name.
          if v_tag is not null then
            select * into t from public.mi_tags where account_id = acct and code = v_tag;
            if t.status = 'applied' and t.entity_type = 'asset' then v_id := t.entity_id; end if;
            if t.status = 'applied' and t.entity_type <> 'asset' then raise exception 'Sticker % is on a %.', v_tag, t.entity_type; end if;
            if t.status = 'retired' then raise exception 'Sticker % was retired.', v_tag; end if;
          end if;
          if v_id is null and coalesce(trim(r ->> 'asset_number'), '') <> '' then
            select id into v_id from public.equipment where account_id = acct and asset_number = nullif(regexp_replace(r ->> 'asset_number', '[^0-9]', '', 'g'), '')::int;
          end if;
          if v_id is null and coalesce(trim(r ->> 'maintainx_id'), '') <> '' then
            select id into v_id from public.equipment where account_id = acct and maintainx_id = nullif(regexp_replace(r ->> 'maintainx_id', '[^0-9]', '', 'g'), '')::bigint;
          end if;
          if v_id is null and nm is not null then
            select id into v_id from public.equipment where account_id = acct and location_id = v_site and lower(name) = lower(nm) order by created_at limit 1;
          end if;
          if v_id is not null and not exists (select 1 from public.equipment where id = v_id and location_id = v_site) then
            raise exception 'That machine is at another site. Move it there first.';
          end if;

          if coalesce(trim(r ->> 'parent'), '') <> '' then
            raw := trim(r ->> 'parent');
            select e.id into v_parent from public.equipment e
            left join public.mi_tags pt on pt.entity_type = 'asset' and pt.entity_id = e.id
            where e.account_id = acct and e.location_id = v_site
              and (lower(e.name) = lower(raw) or upper(pt.code) = upper(raw) or lower(regexp_replace(e.name, '^#?\s*\d+\s*[-:]\s*', '')) = lower(raw))
            order by (lower(e.name) = lower(raw)) desc, e.parent_asset_id is null desc limit 1;
            if v_parent is null then raise exception 'Parent "%" isn''t at %.', raw, trim(r ->> 'site'); end if;
            if v_parent = v_id then raise exception 'A machine can''t be part of itself.'; end if;
          end if;

          if coalesce(trim(r ->> 'zone'), '') <> '' then v_area := public.mi__area_for(acct, v_site, r ->> 'zone'); end if;
          if coalesce(trim(r ->> 'vendor'), '') <> '' then
            select id into v_vendor from public.vendors where account_id = acct and lower(name) = lower(trim(r ->> 'vendor')) limit 1;
            if v_vendor is null then raise exception 'Vendor "%" isn''t in Operator yet.', trim(r ->> 'vendor'); end if;
          end if;
          raw := lower(trim(coalesce(r ->> 'status', '')));
          v_status := case
            when raw = '' then null
            when raw in ('running', 'online', 'up', 'ok', 'in service') then 'online'
            when raw in ('down for maintenance', 'planned', 'offline_planned', 'maintenance') then 'offline_planned'
            when raw in ('broken', 'broken down', 'down', 'offline', 'offline_unplanned') then 'offline_unplanned'
            when raw = 'retired' then 'retired' end;
          if raw <> '' and v_status is null then raise exception 'Status "%": use running, down for maintenance, broken down or retired.', r ->> 'status'; end if;
          v_crit := nullif(upper(trim(coalesce(r ->> 'criticality', ''))), '');
          if v_crit is not null and v_crit not in ('A', 'B', 'C') then raise exception 'Criticality is A, B or C.'; end if;
          raw := lower(trim(coalesce(r ->> 'use_counted', '')));
          v_basis := case when raw = '' then null when raw in ('every car', 'all', 'all_cars', 'yes') then 'all_cars'
                          when raw in ('no', 'none', 'not counted') then 'none' when raw in ('packages', 'some packages') then 'packages' end;
          if raw <> '' and v_basis is null then raise exception 'Use counted: every car, some packages or no.'; end if;

          if v_id is null then
            if nm is null then raise exception 'A new machine needs a name.'; end if;
            insert into public.equipment (account_id, location_id, name, type, description, status, retired_at, parent_asset_id, area_id, vendor_id,
              crit_class, criticality, manufacturer, model, serial_number, purchase_date, install_date, warranty_expiry, usage_basis, maintainx_id)
            values (acct, v_site, nm, nullif(trim(coalesce(r ->> 'type', '')), ''), nullif(trim(coalesce(r ->> 'notes', '')), ''),
              coalesce(v_status, 'online'), case when v_status = 'retired' then now() end, v_parent, v_area, v_vendor,
              v_crit, case v_crit when 'A' then 'high' when 'B' then 'medium' when 'C' then 'low' else 'none' end,
              nullif(trim(coalesce(r ->> 'manufacturer', '')), ''), nullif(trim(coalesce(r ->> 'model', '')), ''), nullif(trim(coalesce(r ->> 'serial', '')), ''),
              nullif(trim(coalesce(r ->> 'bought', '')), '')::date, nullif(trim(coalesce(r ->> 'installed', '')), '')::date, nullif(trim(coalesce(r ->> 'warranty', '')), '')::date,
              coalesce(v_basis, 'all_cars'), nullif(regexp_replace(coalesce(r ->> 'maintainx_id', ''), '[^0-9]', '', 'g'), '')::bigint)
            returning id into v_id;
            was_new := true;
          else
            update public.equipment set
              name = coalesce(nm, name),
              type = coalesce(nullif(trim(coalesce(r ->> 'type', '')), ''), type),
              description = coalesce(nullif(trim(coalesce(r ->> 'notes', '')), ''), description),
              status = coalesce(v_status, status),
              retired_at = case when v_status = 'retired' and status <> 'retired' then now() when v_status is not null and v_status <> 'retired' then null else retired_at end,
              parent_asset_id = coalesce(v_parent, parent_asset_id),
              area_id = coalesce(v_area, area_id),
              vendor_id = coalesce(v_vendor, vendor_id),
              crit_class = coalesce(v_crit, crit_class),
              criticality = case v_crit when 'A' then 'high' when 'B' then 'medium' when 'C' then 'low' else criticality end,
              manufacturer = coalesce(nullif(trim(coalesce(r ->> 'manufacturer', '')), ''), manufacturer),
              model = coalesce(nullif(trim(coalesce(r ->> 'model', '')), ''), model),
              serial_number = coalesce(nullif(trim(coalesce(r ->> 'serial', '')), ''), serial_number),
              purchase_date = coalesce(nullif(trim(coalesce(r ->> 'bought', '')), '')::date, purchase_date),
              install_date = coalesce(nullif(trim(coalesce(r ->> 'installed', '')), '')::date, install_date),
              warranty_expiry = coalesce(nullif(trim(coalesce(r ->> 'warranty', '')), '')::date, warranty_expiry),
              usage_basis = coalesce(v_basis, usage_basis)
            where id = v_id;
          end if;

          -- The sticker: a blank from the roll is claimed, a new code is recorded as on it.
          if v_tag is not null then
            if t.id is null then
              if exists (select 1 from public.mi_tags where entity_type = 'asset' and entity_id = v_id) then
                raise exception 'This machine already has a sticker; % would be a second one.', v_tag;
              end if;
              insert into public.mi_tags (account_id, code, entity_type, entity_id, status, source, site_id)
              values (acct, v_tag, 'asset', v_id, 'applied', 'imported', v_site);
            elsif t.status = 'unused' then
              if exists (select 1 from public.mi_tags where entity_type = 'asset' and entity_id = v_id) then
                raise exception 'This machine already has a sticker; % would be a second one.', v_tag;
              end if;
              update public.mi_tags set status = 'applied', entity_id = v_id, site_id = v_site where id = t.id;
            end if;
          end if;

          if was_new then created := created + 1; else updated := updated + 1; end if;
          results := results || jsonb_build_object('row', i, 'status', case when was_new then 'create' else 'update' end, 'machine', coalesce(nm, v_tag), 'site', r ->> 'site');
        exception when others then
          errors := errors + 1;
          results := results || jsonb_build_object('row', i, 'status', 'error', 'machine', coalesce(nm, v_tag, r ->> 'asset_number'), 'site', r ->> 'site', 'message', sqlerrm);
        end;
        t := null;
      end loop;
      perform set_config('mi.action', '', true);
    end;
    if not p_commit or errors > 0 then
      raise exception 'mi_import_rollback' using errcode = 'MI001';
    end if;
  exception when sqlstate 'MI001' then
    perform set_config('mi.action', '', true);
  end;
  return jsonb_build_object('ok', errors = 0, 'committed', p_commit and errors = 0, 'created', created, 'updated', updated, 'errors', errors, 'rows', results);
end;
$$;

revoke all on function public.mi_import_equipment(jsonb, boolean) from public, anon;
grant execute on function public.mi_import_equipment(jsonb, boolean) to authenticated;
