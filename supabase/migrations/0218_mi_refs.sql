-- Maintenance Inventory: everything the shell needs on load: sites, locations, bins,
-- categories, vendors and people, limited to what this person can see.
create or replace function public.mi_refs() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  vis uuid[] := public.mi_visible_location_ids();
  sites uuid[] := public.auth_site_ids();
begin
  return jsonb_build_object(
    'sites', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name) order by l.name), '[]'::jsonb) from public.locations l where l.id = any (sites)),
    'locations', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'type', l.type, 'site_id', l.site_id, 'region_name', l.region_name, 'active', l.active, 'assigned_user_id', l.assigned_user_id,
        'is_sample', l.is_sample, 'can_act', public.mi_can_act_at(l.id), 'can_manage', public.mi_can_manage_at(l.id)) order by l.name), '[]'::jsonb)
      from public.mi_stock_locations l where l.id = any (vis)),
    'bins', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'location_id', b.location_id) order by b.name), '[]'::jsonb) from public.mi_bins b where b.location_id = any (vis)),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort_order, c.name), '[]'::jsonb) from public.mi_part_categories c where c.account_id = acct),
    'vendors', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'email', v.email) order by v.name), '[]'::jsonb) from public.vendors v where v.account_id = acct),
    'people', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from public.mi_people() p),
    'regions', (select coalesce(jsonb_agg(r ->> 'name'), '[]'::jsonb) from public.accounts a, lateral jsonb_array_elements(coalesce(a.company_settings -> 'regions', '[]'::jsonb)) r where a.id = acct));
end;
$$;
revoke all on function public.mi_refs() from public, anon;
grant execute on function public.mi_refs() to authenticated;

-- A UPC and the same code read as EAN-13 differ by a leading zero: treat them as one.
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
