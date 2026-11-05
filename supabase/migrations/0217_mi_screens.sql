-- Maintenance Inventory: what each screen reads, one round trip per screen so the phone
-- views stay quick. All of it respects the caller's locations.

create or replace function public.mi_parts_list(
  p_q text default null, p_category uuid default null, p_filter text default null, p_limit integer default 100, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  acct uuid := public.mi__account();
  vis uuid[] := public.mi_visible_location_ids();
  q text := nullif(trim(p_q), '');
begin
  return (
    with base as (
      select p.id, p.name, p.sku, p.manufacturer, p.mfr_part_number, p.barcode, p.uom, p.is_critical, p.abc_class, p.photo_path, p.is_sample, c.name as category,
        coalesce(st.on_hand, 0) as on_hand, coalesce(st.available, 0) as available, coalesce(st.locations, 0) as locations, coalesce(st.low, false) as low,
        coalesce(st.value, 0) as value
      from public.parts p
      left join public.mi_part_categories c on c.id = p.category_id
      left join lateral (
        select sum(s.on_hand) as on_hand, sum(s.available) as available, count(*) as locations, sum(s.on_hand * s.avg_cost) as value,
               bool_or(s.reorder_point is not null and s.available <= s.reorder_point) as low
        from public.mi_stock_levels s where s.part_id = p.id and s.location_id = any (vis)
      ) st on true
      where p.account_id = acct
        and (p_category is null or p.category_id = p_category)
        and (q is null
          or p.name ilike '%' || q || '%' or p.sku ilike '%' || q || '%' or p.mfr_part_number ilike '%' || q || '%' or p.barcode = q
          or c.name ilike '%' || q || '%' or p.name % q
          or exists (select 1 from public.mi_part_vendors pv where pv.part_id = p.id and pv.vendor_part_number ilike '%' || q || '%'))
    ), filtered as (
      select * from base
      where p_filter is null
        or (p_filter = 'critical' and is_critical)
        or (p_filter = 'low' and low)
        or (p_filter = 'stocked' and locations > 0)
        or (p_filter = 'out' and locations > 0 and on_hand <= 0)
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'rows', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from (
        select * from filtered
        order by case when q is not null and name ilike q || '%' then 0 else 1 end, low desc, name
        limit greatest(p_limit, 1) offset greatest(p_offset, 0)) r)));
end;
$$;

create or replace function public.mi_part_detail(p_part uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  vis uuid[] := public.mi_visible_location_ids();
  p public.parts;
begin
  select * into p from public.parts where id = p_part and account_id = acct;
  if not found then raise exception 'Part not found.'; end if;
  return jsonb_build_object(
    'part', to_jsonb(p) || jsonb_build_object('category', (select name from public.mi_part_categories where id = p.category_id)),
    'stock', (select coalesce(jsonb_agg(public.mi__stock_row(s) || jsonb_build_object('reorder_point', s.reorder_point, 'on_order', public.mi__on_order(s.part_id, s.location_id), 'last_moved_at', s.last_moved_at, 'can_manage', public.mi_can_manage_at(s.location_id))), '[]'::jsonb)
              from public.mi_stock_levels s where s.part_id = p.id and s.location_id = any (vis)),
    'elsewhere', public.mi_stock_elsewhere(p.id),
    'vendors', (select coalesce(jsonb_agg(jsonb_build_object('id', pv.id, 'vendor_id', pv.vendor_id, 'vendor_name', v.name, 'vendor_part_number', pv.vendor_part_number, 'price', pv.price, 'pack_qty', pv.pack_qty, 'lead_time_days', pv.lead_time_days, 'preferred', pv.preferred) order by pv.preferred desc, v.name), '[]'::jsonb)
                from public.mi_part_vendors pv join public.vendors v on v.id = pv.vendor_id where pv.part_id = p.id),
    'assets', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'site_name', l.name, 'qty_per', pa.qty_per) order by l.name, e.name), '[]'::jsonb)
               from public.part_assets pa join public.equipment e on e.id = pa.asset_id join public.locations l on l.id = e.location_id
               where pa.part_id = p.id and e.location_id = any (public.auth_site_ids())),
    'history', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select jsonb_build_object('id', m.id, 'type', m.type, 'qty', m.qty, 'qty_after', m.qty_after, 'unit_cost', m.unit_cost, 'created_at', m.created_at, 'reason_code', m.reason_code, 'notes', m.notes,
        'location_name', l.name, 'by', u.name, 'work_order_id', m.work_order_id, 'work_order_number', w.number, 'asset_name', e.name) as x
      from public.mi_inventory_transactions m
      join public.mi_stock_locations l on l.id = m.location_id
      left join public.users u on u.id = m.performed_by
      left join public.work_orders w on w.id = m.work_order_id
      left join public.equipment e on e.id = m.asset_id
      where m.part_id = p.id and m.location_id = any (vis)
      order by m.created_at desc limit 40) q),
    'attachments', (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb) from public.mi_attachments a where a.entity_type = 'part' and a.entity_id = p.id));
end;
$$;

-- Stock at one location, for its menu and for picking what to work with.
create or replace function public.mi_location_stock(p_location uuid, p_q text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  q text := nullif(trim(p_q), '');
begin
  if not p_location = any (public.mi_visible_location_ids()) then raise exception 'Location not found.'; end if;
  return (
    select coalesce(jsonb_agg(public.mi__stock_row(s) order by p.name), '[]'::jsonb)
    from public.mi_stock_levels s join public.parts p on p.id = s.part_id
    where s.location_id = p_location and (q is null or p.name ilike '%' || q || '%' or p.sku ilike '%' || q || '%'));
end;
$$;

create or replace function public.mi_home() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  vis uuid[] := public.mi_visible_location_ids();
  sites uuid[] := public.auth_site_ids();
  r integer := public.mi_rank();
  me uuid := auth.uid();
begin
  return jsonb_build_object(
    'my_tools', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'status', t.status, 'due_at', t.due_at, 'overdue', t.due_at < now()) order by t.due_at nulls last, t.name), '[]'::jsonb)
                 from public.mi_tools t where t.account_id = acct and t.custodian_user_id = me),
    'handoffs', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'from', u.name)), '[]'::jsonb)
                 from public.mi_tools t left join public.users u on u.id = t.pending_from_user_id where t.account_id = acct and t.pending_to_user_id = me),
    'my_work_orders', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select jsonb_build_object('id', w.id, 'number', w.number, 'title', w.title, 'site_name', l.name, 'priority', w.priority, 'asset_name', e.name) as x
      from public.work_orders w join public.locations l on l.id = w.location_id left join public.equipment e on e.id = w.equipment_id
      where w.account_id = acct and w.status in ('open', 'in_progress', 'on_hold') and w.location_id = any (sites)
        and (w.created_by = me or exists (select 1 from public.work_order_assignees a where a.work_order_id = w.id and a.user_id = me))
      order by w.created_at desc limit 8) q),
    'low_stock', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select public.mi__stock_row(s) as x
      from public.mi_stock_levels s join public.parts p on p.id = s.part_id
      where s.location_id = any (vis) and s.reorder_point is not null and s.available <= s.reorder_point
      order by p.is_critical desc, (s.available - s.reorder_point), p.name limit 8) q),
    'low_stock_total', (select count(*) from public.mi_stock_levels s where s.location_id = any (vis) and s.reorder_point is not null and s.available <= s.reorder_point),
    'to_do', jsonb_build_object(
      'transfers_to_approve', case when r >= 2 then (select count(*) from public.mi_transfers t where t.account_id = acct and t.status = 'requested' and public.mi__can_approve_transfer(t.from_location_id, t.to_location_id)) else 0 end,
      'transfers_to_ship', (select count(*) from public.mi_transfers t where t.account_id = acct and t.status = 'approved' and public.mi_can_act_at(t.from_location_id)),
      'transfers_to_receive', (select count(*) from public.mi_transfers t where t.account_id = acct and t.status = 'in_transit' and public.mi_can_act_at(t.to_location_id)),
      'counts_open', (select count(*) from public.mi_cycle_counts c where c.account_id = acct and c.status = 'open' and c.location_id = any (vis)),
      'counts_to_review', case when r >= 2 then (select count(*) from public.mi_cycle_counts c where c.account_id = acct and c.status = 'in_review' and public.mi_can_manage_at(c.location_id)) else 0 end,
      'pos_to_approve', case when r >= 2 then (select count(*) from public.mi_purchase_orders o where o.account_id = acct and o.status = 'submitted' and (r >= 4 or o.ship_to_location_id = any (vis))) else 0 end,
      'pos_to_receive', (select count(*) from public.mi_purchase_orders o where o.account_id = acct and o.status in ('sent', 'partially_received', 'approved') and o.ship_to_location_id = any (vis)),
      'part_requests', case when r >= 4 then (select count(*) from public.mi_part_requests q where q.account_id = acct and q.status = 'pending') else 0 end));
end;
$$;

create or replace function public.mi_tools_list(p_q text default null, p_status text default null, p_mine boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  vis uuid[] := public.mi_visible_location_ids();
  q text := nullif(trim(p_q), '');
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'category', t.category, 'serial_number', t.serial_number, 'status', t.status, 'condition', t.condition, 'due_at', t.due_at, 'overdue', t.due_at < now(),
      'custodian', coalesce(u.name, cl.name), 'custodian_is_me', t.custodian_user_id = auth.uid(), 'home_name', hl.name, 'pending', t.pending_to_user_id is not null or t.pending_to_location_id is not null) order by t.name), '[]'::jsonb)
    from public.mi_tools t
    left join public.users u on u.id = t.custodian_user_id
    left join public.mi_stock_locations cl on cl.id = t.custodian_location_id
    left join public.mi_stock_locations hl on hl.id = t.home_location_id
    where t.account_id = acct and (public.mi_rank() >= 4 or t.custodian_user_id = auth.uid() or t.pending_to_user_id = auth.uid() or t.home_location_id = any (vis) or t.custodian_location_id = any (vis))
      and (p_status is null or (p_status = 'overdue' and t.status = 'checked_out' and t.due_at < now()) or t.status = p_status)
      and (not coalesce(p_mine, false) or t.custodian_user_id = auth.uid())
      and (q is null or t.name ilike '%' || q || '%' or t.serial_number ilike '%' || q || '%' or t.category ilike '%' || q || '%'));
end;
$$;

create or replace function public.mi_tool_detail(p_tool uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  t public.mi_tools;
  me uuid := auth.uid();
begin
  select * into t from public.mi_tools where id = p_tool and account_id = acct;
  if not found then raise exception 'Tool not found.'; end if;
  if not (public.mi_rank() >= 4 or t.custodian_user_id = me or t.pending_to_user_id = me
          or t.home_location_id = any (public.mi_visible_location_ids()) or t.custodian_location_id = any (public.mi_visible_location_ids())) then
    return jsonb_build_object('hidden', true, 'message', 'That tool is at a location you can''t see.');
  end if;
  return jsonb_build_object(
    'tool', to_jsonb(t) || jsonb_build_object(
      'custodian', (select coalesce((select name from public.users where id = t.custodian_user_id), (select name from public.mi_stock_locations where id = t.custodian_location_id))),
      'home_name', (select name from public.mi_stock_locations where id = t.home_location_id),
      'pending_to', (select coalesce((select name from public.users where id = t.pending_to_user_id), (select name from public.mi_stock_locations where id = t.pending_to_location_id))),
      'tag', (select code from public.mi_tags where entity_type = 'tool' and entity_id = t.id),
      'can_accept', t.pending_to_user_id = me or (t.pending_to_location_id is not null and public.mi_can_act_at(t.pending_to_location_id)),
      'holds_it', t.custodian_user_id = me,
      'can_manage', public.mi_can_manage_at(t.home_location_id)),
    'chain', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'action', e.action, 'created_at', e.created_at, 'condition', e.condition, 'status', e.status, 'due_at', e.due_at, 'notes', e.notes,
        'from', coalesce(fu.name, fl.name), 'to', coalesce(tu.name, tl.name), 'by', bu.name) order by e.created_at desc), '[]'::jsonb)
      from public.mi_tool_checkouts e
      left join public.users fu on fu.id = e.from_user_id
      left join public.mi_stock_locations fl on fl.id = e.from_location_id
      left join public.users tu on tu.id = e.to_user_id
      left join public.mi_stock_locations tl on tl.id = e.to_location_id
      left join public.users bu on bu.id = e.performed_by
      where e.tool_id = t.id));
end;
$$;

-- Assets are the existing equipment table (about 130 rows a site, parents and children).
create or replace function public.mi_assets_list(p_site uuid, p_q text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  q text := nullif(trim(p_q), '');
begin
  if not p_site = any (public.auth_site_ids()) then raise exception 'That site isn''t one of yours.' using errcode = '42501'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'type', e.type, 'status', e.status, 'parent_id', e.parent_asset_id, 'crit_class', e.crit_class,
      'area_id', e.area_id, 'area_name', a.name, 'bom_lines', (select count(*) from public.part_assets pa where pa.asset_id = e.id)) order by a.sort_order nulls last, a.name nulls last, e.name), '[]'::jsonb)
    from public.equipment e left join public.mi_areas a on a.id = e.area_id
    where e.account_id = acct and e.location_id = p_site
      and (q is null or e.name ilike '%' || q || '%' or e.type ilike '%' || q || '%' or e.serial_number ilike '%' || q || '%'));
end;
$$;

create or replace function public.mi_asset_detail(p_asset uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  e public.equipment;
begin
  select * into e from public.equipment where id = p_asset and account_id = acct;
  if not found then raise exception 'Asset not found.'; end if;
  if not e.location_id = any (public.auth_site_ids()) then
    return jsonb_build_object('hidden', true, 'message', 'That asset is at a site you can''t see.');
  end if;
  return jsonb_build_object(
    'asset', to_jsonb(e) || jsonb_build_object(
      'site_name', (select name from public.locations where id = e.location_id),
      'area_name', (select name from public.mi_areas where id = e.area_id),
      'vendor_name', (select name from public.vendors where id = e.vendor_id),
      'parent_name', (select name from public.equipment where id = e.parent_asset_id),
      'tag', (select code from public.mi_tags where entity_type = 'asset' and entity_id = e.id),
      'can_manage', public.mi_rank() >= 2),
    'children', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name), '[]'::jsonb) from public.equipment c where c.parent_asset_id = e.id),
    'bom', (select coalesce(jsonb_agg(jsonb_build_object('part_id', p.id, 'part_name', p.name, 'sku', p.sku, 'qty_per', pa.qty_per, 'is_critical', p.is_critical,
        'on_hand_at_site', (select coalesce(sum(s.on_hand), 0) from public.mi_stock_levels s join public.mi_stock_locations l on l.id = s.location_id where s.part_id = p.id and l.site_id = e.location_id)) order by p.name), '[]'::jsonb)
      from public.part_assets pa join public.parts p on p.id = pa.part_id where pa.asset_id = e.id),
    'open_work_orders', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'number', w.number, 'title', w.title, 'status', w.status, 'priority', w.priority) order by w.created_at desc), '[]'::jsonb)
      from public.work_orders w where w.equipment_id = e.id and w.status in ('open', 'in_progress', 'on_hold')),
    'service_history', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select jsonb_build_object('id', w.id, 'number', w.number, 'title', w.title, 'status', w.status, 'completed_at', w.completed_at, 'created_at', w.created_at) as x
      from public.work_orders w where w.equipment_id = e.id and w.status in ('done', 'skipped') order by coalesce(w.completed_at, w.created_at) desc limit 15) q),
    'parts_cost', (select coalesce(round(sum(-m.qty * m.unit_cost), 2), 0) from public.mi_inventory_transactions m where m.asset_id = e.id and m.type in ('issue', 'return')),
    'parts_used', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select jsonb_build_object('part_id', p.id, 'part_name', p.name, 'qty', -m.qty, 'cost', round(-m.qty * m.unit_cost, 2), 'created_at', m.created_at, 'type', m.type) as x
      from public.mi_inventory_transactions m join public.parts p on p.id = m.part_id
      where m.asset_id = e.id and m.type in ('issue', 'return') order by m.created_at desc limit 15) q));
end;
$$;

create or replace function public.mi_work_orders_list(p_site uuid default null, p_q text default null, p_status text default 'open') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  sites uuid[] := public.auth_site_ids();
  q text := nullif(trim(p_q), '');
begin
  return (
    select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select jsonb_build_object('id', w.id, 'number', w.number, 'title', w.title, 'status', w.status, 'priority', w.priority, 'site_name', l.name, 'asset_name', e.name, 'created_at', w.created_at,
        'parts_lines', (select count(*) from public.work_order_parts wp where wp.work_order_id = w.id),
        'parts_cost', (select coalesce(round(sum(wp.quantity * coalesce(wp.unit_cost, 0)), 2), 0) from public.work_order_parts wp where wp.work_order_id = w.id)) as x
      from public.work_orders w join public.locations l on l.id = w.location_id left join public.equipment e on e.id = w.equipment_id
      where w.account_id = acct and w.location_id = any (sites) and (p_site is null or w.location_id = p_site)
        and (case when p_status = 'open' then w.status in ('open', 'in_progress', 'on_hold') when p_status is null then true else w.status = p_status end)
        and (q is null or w.title ilike '%' || q || '%' or w.number::text = q or e.name ilike '%' || q || '%')
      order by w.created_at desc limit 100) r);
end;
$$;

create or replace function public.mi_work_order_detail(p_wo uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  w public.work_orders;
begin
  select * into w from public.work_orders where id = p_wo and account_id = acct;
  if not found or not w.location_id = any (public.auth_site_ids()) then raise exception 'Work order not found.'; end if;
  return jsonb_build_object(
    'work_order', to_jsonb(w) || jsonb_build_object('site_name', (select name from public.locations where id = w.location_id), 'asset_name', (select name from public.equipment where id = w.equipment_id)),
    'parts', (select coalesce(jsonb_agg(jsonb_build_object('id', wp.id, 'part_id', wp.catalog_part_id, 'part_name', wp.part_name, 'qty_planned', wp.qty_planned, 'qty_issued', wp.qty_issued, 'qty_returned', wp.qty_returned, 'quantity', wp.quantity,
        'unit_cost', wp.unit_cost, 'cost', round(wp.quantity * coalesce(wp.unit_cost, 0), 2), 'location_id', wp.mi_location_id, 'location_name', l.name) order by wp.created_at), '[]'::jsonb)
      from public.work_order_parts wp left join public.mi_stock_locations l on l.id = wp.mi_location_id where wp.work_order_id = w.id),
    'parts_cost', (select coalesce(round(sum(wp.quantity * coalesce(wp.unit_cost, 0)), 2), 0) from public.work_order_parts wp where wp.work_order_id = w.id),
    'bom', (select coalesce(jsonb_agg(jsonb_build_object('part_id', p.id, 'part_name', p.name, 'qty_per', pa.qty_per) order by p.name), '[]'::jsonb)
      from public.part_assets pa join public.parts p on p.id = pa.part_id where pa.asset_id = w.equipment_id),
    'locations', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name)), '[]'::jsonb) from public.mi_stock_locations l where l.site_id = w.location_id and l.active and public.mi_can_act_at(l.id)));
end;
$$;

-- Stock a person can pull for a job at this site: their locations there, then their trucks.
create or replace function public.mi_part_stock_for_site(p_part uuid, p_site uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.mi__stock_row(s) order by (l.site_id = p_site) desc nulls last, s.available desc), '[]'::jsonb)
  from public.mi_stock_levels s join public.mi_stock_locations l on l.id = s.location_id
  where s.account_id = public.mi__account() and s.part_id = p_part and public.mi_can_act_at(s.location_id) and (l.site_id = p_site or l.assigned_user_id = auth.uid() or l.site_id is null)
$$;

create or replace function public.mi_pos_list(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  vis uuid[] := public.mi_visible_location_ids();
begin
  return (
    select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'urgent', o.urgent, 'vendor_name', v.name, 'location_name', l.name, 'created_at', o.created_at, 'is_sample', o.is_sample,
        'total', public.mi_po_total(o.id), 'lines', (select count(*) from public.mi_po_lines pl where pl.po_id = o.id)) as x
      from public.mi_purchase_orders o join public.vendors v on v.id = o.vendor_id join public.mi_stock_locations l on l.id = o.ship_to_location_id
      where o.account_id = acct and (public.mi_rank() >= 4 or o.ship_to_location_id = any (vis))
        and (p_status is null or (p_status = 'open' and o.status in ('draft', 'submitted', 'approved', 'sent', 'partially_received')) or o.status = p_status)
      order by o.number desc limit 200) q);
end;
$$;

create or replace function public.mi_po_detail(p_po uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  o public.mi_purchase_orders;
  r integer := public.mi_rank();
  lim numeric;
  total numeric := public.mi_po_total(p_po);
begin
  select * into o from public.mi_purchase_orders where id = p_po and account_id = acct;
  if not found or not (r >= 4 or o.ship_to_location_id = any (public.mi_visible_location_ids())) then raise exception 'Purchase order not found.'; end if;
  select (po_limits ->> public.mi_role())::numeric into lim from public.mi_settings where account_id = acct;
  return jsonb_build_object(
    'po', to_jsonb(o) || jsonb_build_object('total', total,
      'can_manage', public.mi_can_manage_at(o.ship_to_location_id), 'can_receive', public.mi_can_act_at(o.ship_to_location_id),
      'can_approve', r >= 4 or (r >= 2 and public.mi_can_manage_at(o.ship_to_location_id) and lim is not null and total <= lim), 'approval_limit', lim),
    'vendor', (select jsonb_build_object('id', v.id, 'name', v.name, 'email', v.email, 'phone', v.phone, 'address', v.address) from public.vendors v where v.id = o.vendor_id),
    'location', (select jsonb_build_object('id', l.id, 'name', l.name, 'site_name', s.name, 'address', s.address) from public.mi_stock_locations l left join public.locations s on s.id = l.site_id where l.id = o.ship_to_location_id),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('id', pl.id, 'part_id', pl.part_id, 'part_name', p.name, 'sku', p.sku, 'uom', p.uom, 'vendor_part_number', pl.vendor_part_number, 'barcode', p.barcode,
        'qty_ordered', pl.qty_ordered, 'qty_received', pl.qty_received, 'qty_open', greatest(pl.qty_ordered - pl.qty_received, 0), 'unit_cost', pl.unit_cost, 'normal_unit_cost', pl.normal_unit_cost, 'line_total', round(pl.qty_ordered * pl.unit_cost, 2)) order by p.name), '[]'::jsonb)
      from public.mi_po_lines pl join public.parts p on p.id = pl.part_id where pl.po_id = o.id),
    'receipts', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'received_at', x.received_at, 'by', u.name, 'packing_slip_path', x.packing_slip_path,
        'lines', (select jsonb_agg(jsonb_build_object('part_name', p.name, 'qty', rl.qty, 'unit_cost', rl.unit_cost)) from public.mi_receipt_lines rl join public.parts p on p.id = rl.part_id where rl.receipt_id = x.id)) order by x.received_at desc), '[]'::jsonb)
      from public.mi_receipts x left join public.users u on u.id = x.received_by where x.po_id = o.id));
end;
$$;

-- What's still due for a part coming to a location: what scanning it should receive against.
create or replace function public.mi_open_po_lines(p_part uuid, p_location uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', pl.id, 'po_id', o.id, 'number', o.number, 'vendor_name', v.name, 'qty_open', pl.qty_ordered - pl.qty_received, 'unit_cost', pl.unit_cost) order by o.number), '[]'::jsonb)
  from public.mi_po_lines pl join public.mi_purchase_orders o on o.id = pl.po_id join public.vendors v on v.id = o.vendor_id
  where o.account_id = public.mi__account() and pl.part_id = p_part and o.ship_to_location_id = p_location and public.mi_can_act_at(p_location)
    and o.status in ('approved', 'sent', 'partially_received') and pl.qty_ordered > pl.qty_received
$$;

create or replace function public.mi_transfers_list(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  vis uuid[] := public.mi_visible_location_ids();
begin
  return (
    select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select jsonb_build_object('id', t.id, 'number', t.number, 'status', t.status, 'notes', t.notes, 'requested_at', t.requested_at, 'shipped_at', t.shipped_at, 'received_at', t.received_at,
        'from_id', t.from_location_id, 'from_name', a.name, 'to_id', t.to_location_id, 'to_name', b.name, 'requested_by', u.name,
        'can_approve', t.status = 'requested' and public.mi__can_approve_transfer(t.from_location_id, t.to_location_id),
        'can_ship', t.status = 'approved' and public.mi_can_act_at(t.from_location_id),
        'can_receive', t.status = 'in_transit' and public.mi_can_act_at(t.to_location_id),
        'can_cancel', t.status in ('requested', 'approved') and (t.requested_by = auth.uid() or public.mi__can_approve_transfer(t.from_location_id, t.to_location_id)),
        'lines', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'part_id', l.part_id, 'part_name', p.name, 'qty_requested', l.qty_requested, 'qty_shipped', l.qty_shipped, 'qty_received', l.qty_received, 'variance_qty', l.variance_qty,
           'available_at_source', (select s.available from public.mi_stock_levels s where s.part_id = l.part_id and s.location_id = t.from_location_id)) order by p.name), '[]'::jsonb)
           from public.mi_transfer_lines l join public.parts p on p.id = l.part_id where l.transfer_id = t.id)) as x
      from public.mi_transfers t
      join public.mi_stock_locations a on a.id = t.from_location_id
      join public.mi_stock_locations b on b.id = t.to_location_id
      left join public.users u on u.id = t.requested_by
      where t.account_id = acct and (t.from_location_id = any (vis) or t.to_location_id = any (vis))
        and (p_status is null or (p_status = 'open' and t.status in ('requested', 'approved', 'in_transit')) or t.status = p_status)
      order by t.number desc limit 150) q);
end;
$$;

create or replace function public.mi_counts_list(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  vis uuid[] := public.mi_visible_location_ids();
begin
  return (
    select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select jsonb_build_object('id', c.id, 'number', c.number, 'status', c.status, 'blind', c.blind, 'forced', c.forced, 'scheduled', c.scheduled, 'scope_type', c.scope_type, 'due_date', c.due_date, 'notes', c.notes, 'created_at', c.created_at,
        'location_id', c.location_id, 'location_name', l.name,
        'lines', (select count(*) from public.mi_cycle_count_lines cl where cl.count_id = c.id),
        'counted', (select count(*) from public.mi_cycle_count_lines cl where cl.count_id = c.id and cl.counted_qty is not null)) as x
      from public.mi_cycle_counts c join public.mi_stock_locations l on l.id = c.location_id
      where c.account_id = acct and c.location_id = any (vis)
        and (p_status is null or (p_status = 'open' and c.status in ('open', 'in_review')) or c.status = p_status)
      order by c.number desc limit 150) q);
end;
$$;

-- The open count that covers this part here, if there is one: what scanning a bin counts into.
create or replace function public.mi_open_count_line(p_part uuid, p_location uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('line_id', l.id, 'count_id', c.id, 'number', c.number, 'blind', c.blind, 'counted_qty', l.counted_qty)
  from public.mi_cycle_count_lines l join public.mi_cycle_counts c on c.id = l.count_id
  where c.account_id = public.mi__account() and c.location_id = p_location and c.status = 'open' and l.part_id = p_part and public.mi_can_act_at(p_location)
  order by c.number limit 1
$$;

create or replace function public.mi_alerts_list(p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.mi__require_rank(2, 'see alerts');
  return (
    select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select jsonb_build_object('id', a.id, 'kind', a.kind, 'message', a.message, 'status', a.status, 'created_at', a.created_at, 'sent_at', a.sent_at, 'detail', a.detail) as x
      from public.mi_alerts a
      where a.account_id = public.mi__account() and (a.location_id is null or a.location_id = any (public.mi_visible_location_ids()))
      order by a.created_at desc limit greatest(p_limit, 1)) q);
end;
$$;

-- CSV export of stock: one row per part per location, same columns as the import.
create or replace function public.mi_export_stock() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  vis uuid[] := public.mi_visible_location_ids();
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'sku', p.sku, 'name', p.name, 'description', p.description, 'category', c.name, 'manufacturer', p.manufacturer, 'mfr_part_number', p.mfr_part_number, 'uom', p.uom,
      'is_critical', case when p.is_critical then 'yes' else 'no' end, 'location', l.name, 'bin', b.name, 'on_hand', s.on_hand, 'min_qty', s.min_qty, 'max_qty', s.max_qty, 'unit_cost', s.avg_cost,
      'vendor', v.name, 'vendor_part_number', pv.vendor_part_number, 'lead_time_days', coalesce(pv.lead_time_days, p.lead_time_days), 'barcode', p.barcode) order by p.name, l.name), '[]'::jsonb)
    from public.mi_stock_levels s
    join public.parts p on p.id = s.part_id
    join public.mi_stock_locations l on l.id = s.location_id
    left join public.mi_bins b on b.id = s.bin_id
    left join public.mi_part_categories c on c.id = p.category_id
    left join public.mi_part_vendors pv on pv.part_id = p.id and pv.preferred
    left join public.vendors v on v.id = pv.vendor_id
    where s.account_id = acct and s.location_id = any (vis));
end;
$$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'mi\_%'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname like 'mi\_\_%' then
      execute format('revoke all on function %s from authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
