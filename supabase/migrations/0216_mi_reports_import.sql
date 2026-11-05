-- Maintenance Inventory: dashboards, CSV import, the nightly job, who gets each alert,
-- and removing sample data.

-- The part categories are real, not sample data. Kevan's list from the spec.
insert into public.mi_part_categories (account_id, name, sort_order)
select s.account_id, c.name, c.ord
from public.mi_settings s,
  unnest(array['Janitorial & Vending','Signage & Facility','Lighting','Prep','Spray Nozzles & Swivels','Tunnel Parts','Hydraulic Parts','Electronics',
    'Brushes/Cloth/Foam','Pumps','Pressure Flow Parts','Fittings','Hose & Tubing','Foam Generators','Chemical Injector Parts','Water Treatment','Chemicals',
    'Vacuum Hose','Equipment','Lube Equipment Parts','Filters']) with ordinality as c(name, ord)
on conflict (account_id, name) do nothing;

-- ---- Inventory signal per site --------------------------------------------------
-- Green, yellow (a required spare is short) or red (a kit part at zero: a part that
-- would keep a tunnel down isn't there).
create or replace function public.mi_site_signals(p_site uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  sites uuid[] := public.auth_site_ids();
begin
  return (
    select coalesce(jsonb_agg(row_data order by row_data ->> 'site_name'), '[]'::jsonb) from (
      select jsonb_build_object(
        'site_id', k.site_id, 'site_name', max(loc.name), 'required_lines', count(*),
        'ok_lines', count(*) filter (where h.qty >= i.qty * k.tunnels),
        'compliance_pct', round(100.0 * count(*) filter (where h.qty >= i.qty * k.tunnels) / nullif(count(*), 0), 1),
        'missing', coalesce(jsonb_agg(jsonb_build_object('part_id', i.part_id, 'part_name', p.name, 'need', i.qty * k.tunnels, 'have', h.qty)) filter (where h.qty < i.qty * k.tunnels), '[]'::jsonb),
        'signal', case when bool_or(h.qty <= 0) then 'red' when bool_or(h.qty < i.qty * k.tunnels) then 'yellow' else 'green' end
      ) as row_data
      from public.mi_site_kits k
      join public.mi_kit_items i on i.kit_id = k.kit_id
      join public.parts p on p.id = i.part_id
      join public.locations loc on loc.id = k.site_id
      cross join lateral (
        select coalesce(sum(s.on_hand), 0) as qty
        from public.mi_stock_levels s join public.mi_stock_locations l on l.id = s.location_id
        where s.part_id = i.part_id and l.site_id = k.site_id
      ) h
      where k.account_id = acct and k.site_id = any (sites) and (p_site is null or k.site_id = p_site)
      group by k.site_id
    ) q);
end;
$$;

-- ---- Dashboard ------------------------------------------------------------------
create or replace function public.mi_dashboard(p_from date default null, p_to date default null, p_site uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  d_from date := coalesce(p_from, current_date - 89);
  d_to date := coalesce(p_to, current_date);
  t_from timestamptz := d_from::timestamptz;
  t_to timestamptz := (d_to + 1)::timestamptz;
  locs uuid[];
  st public.mi_settings;
  out jsonb := '{}'::jsonb;
  stock_value numeric;
  avg_value numeric;
  issue_12m numeric;
  cars numeric;
  parts_cost numeric;
  v_sites jsonb;
begin
  perform public.mi__require_rank(2, 'see dashboards');
  select * into st from public.mi_settings where account_id = acct;
  select coalesce(array_agg(l.id), '{}') into locs from public.mi_stock_locations l
  where l.id = any (public.mi_visible_location_ids()) and (p_site is null or l.site_id = p_site);

  select coalesce(sum(s.on_hand * s.avg_cost), 0) into stock_value from public.mi_stock_levels s where s.location_id = any (locs);

  out := out || jsonb_build_object('range', jsonb_build_object('from', d_from, 'to', d_to), 'inventory_value', round(stock_value, 2));

  out := out || jsonb_build_object('value_by_site', (
    select coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', v) order by v desc), '[]'::jsonb) from (
      select coalesce(loc.name, l.name) as label, round(sum(s.on_hand * s.avg_cost), 2) as v
      from public.mi_stock_levels s join public.mi_stock_locations l on l.id = s.location_id left join public.locations loc on loc.id = l.site_id
      where s.location_id = any (locs) group by 1) q));
  out := out || jsonb_build_object('value_by_location', (
    select coalesce(jsonb_agg(jsonb_build_object('label', label, 'type', type, 'value', v) order by v desc), '[]'::jsonb) from (
      select l.name as label, l.type, round(sum(s.on_hand * s.avg_cost), 2) as v
      from public.mi_stock_levels s join public.mi_stock_locations l on l.id = s.location_id
      where s.location_id = any (locs) group by 1, 2) q));
  out := out || jsonb_build_object('value_by_category', (
    select coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', v) order by v desc), '[]'::jsonb) from (
      select coalesce(c.name, 'Uncategorized') as label, round(sum(s.on_hand * s.avg_cost), 2) as v
      from public.mi_stock_levels s join public.parts p on p.id = s.part_id left join public.mi_part_categories c on c.id = p.category_id
      where s.location_id = any (locs) group by 1) q));

  out := out || jsonb_build_object('in_transit_value', (
    select coalesce(round(sum(tl.qty_shipped * tl.unit_cost), 2), 0)
    from public.mi_transfers t join public.mi_transfer_lines tl on tl.transfer_id = t.id
    where t.account_id = acct and t.status = 'in_transit' and (t.from_location_id = any (locs) or t.to_location_id = any (locs))));

  -- Stockouts: anything out that's meant to be stocked, and how long critical spares sat at zero.
  out := out || jsonb_build_object('stockouts', (
    select coalesce(jsonb_agg(jsonb_build_object('part_id', p.id, 'part_name', p.name, 'location_name', l.name, 'is_critical', p.is_critical) order by p.is_critical desc, p.name), '[]'::jsonb)
    from public.mi_stock_levels s join public.parts p on p.id = s.part_id join public.mi_stock_locations l on l.id = s.location_id
    where s.location_id = any (locs) and s.on_hand <= 0 and (coalesce(s.min_qty, 0) > 0 or p.is_critical)));
  out := out || jsonb_build_object('critical_zero_days', (
    select coalesce(round(sum(extract(epoch from (least(coalesce(x.next_at, now()), t_to) - greatest(x.created_at, t_from))) / 86400)::numeric, 1), 0)
    from (
      select m.created_at, m.qty_after, lead(m.created_at) over (partition by m.part_id, m.location_id order by m.created_at) as next_at
      from public.mi_inventory_transactions m join public.parts p on p.id = m.part_id
      where m.location_id = any (locs) and p.is_critical and m.type not in ('reserve', 'unreserve')
    ) x
    where x.qty_after <= 0 and x.created_at < t_to and coalesce(x.next_at, now()) > t_from));

  v_sites := public.mi_site_signals(p_site);
  out := out || jsonb_build_object('site_signals', v_sites, 'critical_compliance_pct', (
    select round(avg((e ->> 'compliance_pct')::numeric), 1) from jsonb_array_elements(v_sites) e));

  -- Fill rate: a work-order issue counts as filled from stock unless that part came in
  -- at that location by transfer or urgent PO in the 7 days before it.
  out := out || jsonb_build_object('fill_rate', (
    select jsonb_build_object('lines', count(*), 'filled', count(*) filter (where not x.brought_in),
      'pct', round(100.0 * count(*) filter (where not x.brought_in) / nullif(count(*), 0), 1))
    from (
      select exists (
        select 1 from public.mi_inventory_transactions i
        left join public.mi_po_lines pl on pl.id = i.po_line_id
        left join public.mi_purchase_orders po on po.id = pl.po_id
        where i.part_id = m.part_id and i.location_id = m.location_id and i.created_at between m.created_at - interval '7 days' and m.created_at
          and (i.type = 'transfer_in' or (i.type = 'receive' and po.urgent))
      ) as brought_in
      from public.mi_inventory_transactions m
      where m.location_id = any (locs) and m.type = 'issue' and m.work_order_id is not null and m.created_at >= t_from and m.created_at < t_to
    ) x));

  -- Turns: 12 months of issue cost over the average of 13 month-end inventory values.
  select coalesce(sum(-m.qty * m.unit_cost), 0) into issue_12m
  from public.mi_inventory_transactions m
  where m.location_id = any (locs) and m.type in ('issue', 'return') and m.created_at >= now() - interval '12 months';
  select avg(month_value) into avg_value from (
    select g.at_date, sum(coalesce(h.qty_after, 0) * s.avg_cost) as month_value
    from generate_series(0, 12) n
    cross join lateral (select (date_trunc('month', now()) - make_interval(months => n)) as at_date) g
    cross join public.mi_stock_levels s
    left join lateral (
      select m.qty_after from public.mi_inventory_transactions m
      where m.part_id = s.part_id and m.location_id = s.location_id and m.created_at < g.at_date and m.type not in ('reserve', 'unreserve')
      order by m.created_at desc limit 1
    ) h on true
    where s.location_id = any (locs)
    group by g.at_date
  ) mv;
  avg_value := greatest(coalesce(avg_value, 0), 0);
  out := out || jsonb_build_object(
    'issue_cost_12m', round(issue_12m, 2),
    'avg_inventory_value', round(avg_value, 2),
    'turns', case when avg_value > 0 then round(issue_12m / avg_value, 2) end,
    'carrying_cost', round(avg_value * st.carrying_rate, 2),
    'carrying_rate', st.carrying_rate);

  out := out || jsonb_build_object('dead_stock', (
    with x as (
      select p.id as part_id, p.name as part_name, l.name as location_name, round(s.on_hand * s.avg_cost, 2) as value, s.last_moved_at
      from public.mi_stock_levels s join public.parts p on p.id = s.part_id join public.mi_stock_locations l on l.id = s.location_id
      where s.location_id = any (locs) and s.on_hand > 0
        and coalesce(s.last_moved_at, '-infinity'::timestamptz) < now() - make_interval(days => coalesce(p.stale_days, st.stale_days))
    )
    select jsonb_build_object('value', (select coalesce(round(sum(value), 2), 0) from x), 'lines', (select count(*) from x),
      'top', (select coalesce(jsonb_agg(to_jsonb(y) order by y.value desc), '[]'::jsonb) from (select * from x order by value desc limit 10) y))));

  -- Parts cost, net of returns, by site and per car washed.
  select coalesce(sum(-m.qty * m.unit_cost), 0) into parts_cost
  from public.mi_inventory_transactions m
  where m.location_id = any (locs) and m.type in ('issue', 'return') and m.created_at >= t_from and m.created_at < t_to;
  select coalesce(sum(t.cars), 0) into cars
  from public.site_daily_totals(d_from, d_to) t
  where t.site_number in (
    select substring(loc.name from '[0-9]+')::int from public.locations loc
    where loc.account_id = acct and loc.name ~ '[0-9]' and loc.id = any (public.auth_site_ids()) and (p_site is null or loc.id = p_site));
  out := out || jsonb_build_object('parts_cost', round(parts_cost, 2), 'cars', cars,
    'parts_cost_per_car', case when cars > 0 then round(parts_cost / cars, 4) end);
  out := out || jsonb_build_object('parts_cost_by_site', (
    select coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', v, 'cars', c, 'per_car', case when c > 0 then round(v / c, 4) end) order by v desc), '[]'::jsonb) from (
      select coalesce(loc.name, l.name) as label, round(sum(-m.qty * m.unit_cost), 2) as v,
        coalesce(max(tot.cars), 0) as c
      from public.mi_inventory_transactions m
      join public.mi_stock_locations l on l.id = m.location_id
      left join public.locations loc on loc.id = l.site_id
      left join public.site_daily_totals(d_from, d_to) tot on tot.site_number = substring(loc.name from '[0-9]+')::int
      where m.location_id = any (locs) and m.type in ('issue', 'return') and m.created_at >= t_from and m.created_at < t_to
      group by 1) q));
  out := out || jsonb_build_object('top_assets', (
    select coalesce(jsonb_agg(jsonb_build_object('asset_id', asset_id, 'label', label, 'value', v) order by v desc), '[]'::jsonb) from (
      select m.asset_id, e.name as label, round(sum(-m.qty * m.unit_cost), 2) as v
      from public.mi_inventory_transactions m join public.equipment e on e.id = m.asset_id
      where m.location_id = any (locs) and m.type in ('issue', 'return') and m.created_at >= t_from and m.created_at < t_to
      group by 1, 2 order by 3 desc limit 10) q));

  -- Count accuracy.
  out := out || jsonb_build_object('count_accuracy', (
    select jsonb_build_object('lines', count(*),
      'within_tolerance', count(*) filter (where abs(cl.variance_qty) <= greatest(cl.expected_qty, 1) * st.count_tolerance_pct / 100),
      'pct', round(100.0 * count(*) filter (where abs(cl.variance_qty) <= greatest(cl.expected_qty, 1) * st.count_tolerance_pct / 100) / nullif(count(*), 0), 1),
      'net_variance', coalesce(round(sum(cl.variance_qty * cl.unit_cost), 2), 0),
      'gross_variance', coalesce(round(sum(abs(cl.variance_qty * cl.unit_cost)), 2), 0))
    from public.mi_cycle_count_lines cl join public.mi_cycle_counts c on c.id = cl.count_id
    where c.location_id = any (locs) and cl.counted_at >= t_from and cl.counted_at < t_to and cl.counted_qty is not null));

  -- Tools.
  out := out || jsonb_build_object('tools', (
    select jsonb_build_object(
      'total', count(*) filter (where t.status <> 'retired'),
      'checked_out', count(*) filter (where t.status = 'checked_out'),
      'overdue', count(*) filter (where t.status = 'checked_out' and t.due_at < now()),
      'utilization_pct', round(100.0 * count(*) filter (where t.status = 'checked_out') / nullif(count(*) filter (where t.status <> 'retired'), 0), 1),
      'overdue_list', coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'due_at', t.due_at, 'custodian', u.name)) filter (where t.status = 'checked_out' and t.due_at < now()), '[]'::jsonb),
      'lost_or_damaged_value', (
        select coalesce(round(sum(tt.cost), 2), 0) from public.mi_tool_checkouts ev join public.mi_tools tt on tt.id = ev.tool_id
        where ev.account_id = acct and ev.created_at >= t_from and ev.created_at < t_to
          and (ev.status = 'lost' or ev.condition = 'damaged') and (tt.home_location_id = any (locs)))
    )
    from public.mi_tools t left join public.users u on u.id = t.custodian_user_id
    where t.account_id = acct and t.home_location_id = any (locs)));

  -- Equipment: repair time from downtime records, by the asset's type.
  out := out || jsonb_build_object('equipment_reliability', (
    select coalesce(jsonb_agg(jsonb_build_object('category', cat, 'events', n, 'mttr_hours', mttr, 'mtbf_days', mtbf) order by n desc), '[]'::jsonb) from (
      select coalesce(e.type, 'Other') as cat, count(*) as n,
        round(avg(extract(epoch from (de.ended_at - de.started_at)) / 3600)::numeric, 1) as mttr,
        round(((d_to - d_from + 1)::numeric * count(distinct de.equipment_id) / count(*)), 1) as mtbf
      from public.downtime_events de join public.equipment e on e.id = de.equipment_id
      where e.account_id = acct and de.started_at >= t_from and de.started_at < t_to and de.ended_at is not null
        and e.location_id = any (public.auth_site_ids()) and (p_site is null or e.location_id = p_site)
      group by 1 order by 2 desc limit 12) q));

  -- Urgent buys and what the rush cost over the usual price.
  out := out || jsonb_build_object('emergency', (
    select jsonb_build_object('orders', count(distinct o.id),
      'total', coalesce(round(sum(l.qty_ordered * l.unit_cost), 2), 0),
      'premium', coalesce(round(sum(greatest(l.unit_cost - coalesce(l.normal_unit_cost, l.unit_cost), 0) * l.qty_ordered), 2), 0))
    from public.mi_purchase_orders o join public.mi_po_lines l on l.po_id = o.id
    where o.account_id = acct and o.urgent and o.status <> 'cancelled' and o.created_at >= t_from and o.created_at < t_to and o.ship_to_location_id = any (locs)));

  out := out || jsonb_build_object('monthly_issue_cost', (
    select coalesce(jsonb_agg(jsonb_build_object('month', m, 'value', v) order by m), '[]'::jsonb) from (
      select to_char(date_trunc('month', i.created_at), 'YYYY-MM') as m, round(sum(-i.qty * i.unit_cost), 2) as v
      from public.mi_inventory_transactions i
      where i.location_id = any (locs) and i.type in ('issue', 'return') and i.created_at >= now() - interval '12 months'
      group by 1) q));
  return out;
end;
$$;

-- ---- CSV import -----------------------------------------------------------------
-- Preview and commit run the same code. A preview raises at the end so everything it
-- did rolls back, which makes it exact, including several rows for one new part. A
-- commit with any bad row rolls back too, so an import lands whole or not at all.
create or replace function public.mi_import_parts(p_rows jsonb, p_commit boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  results jsonb := '[]'::jsonb;
  errors integer := 0;
  created integer := 0;
  updated integer := 0;
begin
  perform public.mi__require_rank(5, 'import parts');
  begin
    declare
      r jsonb;
      i integer := 0;
      pid uuid;
      loc uuid;
      bin uuid;
      cat uuid;
      ven uuid;
      was_new boolean;
      msg text;
      cur numeric;
      new_qty numeric;
      cost numeric;
      other uuid;
    begin
      for r in select * from jsonb_array_elements(p_rows) loop
        i := i + 1;
        msg := null; pid := null; loc := null; bin := null; cat := null; ven := null; was_new := false;
        begin
          if coalesce(trim(r ->> 'name'), '') = '' and coalesce(trim(r ->> 'sku'), '') = '' then
            raise exception 'Needs a name or a SKU.';
          end if;
          if coalesce(trim(r ->> 'category'), '') <> '' then
            insert into public.mi_part_categories (account_id, name) values (acct, trim(r ->> 'category'))
            on conflict (account_id, name) do update set name = excluded.name returning id into cat;
          end if;
          if coalesce(trim(r ->> 'vendor'), '') <> '' then
            select id into ven from public.vendors where account_id = acct and lower(name) = lower(trim(r ->> 'vendor')) limit 1;
            if ven is null then raise exception 'Vendor "%" isn''t in Operator yet.', trim(r ->> 'vendor'); end if;
          end if;
          if coalesce(trim(r ->> 'location'), '') <> '' then
            select id into loc from public.mi_stock_locations where account_id = acct and lower(name) = lower(trim(r ->> 'location'));
            if loc is null then raise exception 'Location "%" doesn''t exist.', trim(r ->> 'location'); end if;
          end if;

          -- Match: SKU, then manufacturer part number, then barcode.
          if coalesce(trim(r ->> 'sku'), '') <> '' then
            select id into pid from public.parts where account_id = acct and lower(sku) = lower(trim(r ->> 'sku')) order by created_at limit 1;
          end if;
          if pid is null and coalesce(trim(r ->> 'manufacturer'), '') <> '' and coalesce(trim(r ->> 'mfr_part_number'), '') <> '' then
            select id into pid from public.parts where account_id = acct and lower(manufacturer) = lower(trim(r ->> 'manufacturer')) and lower(mfr_part_number) = lower(trim(r ->> 'mfr_part_number')) limit 1;
          end if;
          if pid is null and coalesce(trim(r ->> 'barcode'), '') <> '' then
            select id into pid from public.parts where account_id = acct and barcode = trim(r ->> 'barcode') limit 1;
          end if;

          -- A barcode or part number can't quietly move from one part to another.
          if coalesce(trim(r ->> 'barcode'), '') <> '' then
            select id into other from public.parts where account_id = acct and barcode = trim(r ->> 'barcode') and id is distinct from pid limit 1;
            if other is not null then raise exception 'Barcode % is on another part.', trim(r ->> 'barcode'); end if;
          end if;

          if pid is null then
            if coalesce(trim(r ->> 'name'), '') = '' then raise exception 'A new part needs a name.'; end if;
            insert into public.parts (account_id, name, description, sku, manufacturer, mfr_part_number, uom, is_critical, lead_time_days, barcode, category_id, unit_cost)
            values (acct, trim(r ->> 'name'), r ->> 'description', nullif(trim(r ->> 'sku'), ''), nullif(trim(r ->> 'manufacturer'), ''), nullif(trim(r ->> 'mfr_part_number'), ''),
              coalesce(nullif(trim(r ->> 'uom'), ''), 'ea'), coalesce(lower(r ->> 'is_critical') in ('true', 't', 'yes', 'y', '1'), false),
              nullif(r ->> 'lead_time_days', '')::int, nullif(trim(r ->> 'barcode'), ''), cat, nullif(r ->> 'unit_cost', '')::numeric)
            returning id into pid;
            was_new := true;
          else
            update public.parts set
              name = coalesce(nullif(trim(r ->> 'name'), ''), name), description = coalesce(nullif(r ->> 'description', ''), description),
              manufacturer = coalesce(nullif(trim(r ->> 'manufacturer'), ''), manufacturer), mfr_part_number = coalesce(nullif(trim(r ->> 'mfr_part_number'), ''), mfr_part_number),
              uom = coalesce(nullif(trim(r ->> 'uom'), ''), uom),
              is_critical = case when coalesce(r ->> 'is_critical', '') = '' then is_critical else lower(r ->> 'is_critical') in ('true', 't', 'yes', 'y', '1') end,
              lead_time_days = coalesce(nullif(r ->> 'lead_time_days', '')::int, lead_time_days), barcode = coalesce(nullif(trim(r ->> 'barcode'), ''), barcode),
              category_id = coalesce(cat, category_id), unit_cost = coalesce(nullif(r ->> 'unit_cost', '')::numeric, unit_cost)
            where id = pid;
          end if;

          if ven is not null then
            insert into public.mi_part_vendors (account_id, part_id, vendor_id, vendor_part_number, price, lead_time_days, preferred)
            values (acct, pid, ven, nullif(trim(r ->> 'vendor_part_number'), ''), nullif(r ->> 'unit_cost', '')::numeric, nullif(r ->> 'lead_time_days', '')::int,
              not exists (select 1 from public.mi_part_vendors x where x.part_id = pid and x.preferred))
            on conflict (part_id, vendor_id) do update set
              vendor_part_number = coalesce(excluded.vendor_part_number, public.mi_part_vendors.vendor_part_number),
              price = coalesce(excluded.price, public.mi_part_vendors.price), lead_time_days = coalesce(excluded.lead_time_days, public.mi_part_vendors.lead_time_days);
          end if;

          if loc is not null then
            if coalesce(trim(r ->> 'bin'), '') <> '' then
              insert into public.mi_bins (account_id, location_id, name) values (acct, loc, trim(r ->> 'bin'))
              on conflict (location_id, name) do update set name = excluded.name returning id into bin;
            end if;
            insert into public.mi_stock_levels (account_id, part_id, location_id, bin_id, min_qty, max_qty, reorder_point)
            values (acct, pid, loc, bin, nullif(r ->> 'min_qty', '')::numeric, nullif(r ->> 'max_qty', '')::numeric, nullif(r ->> 'min_qty', '')::numeric)
            on conflict (part_id, location_id) do update set
              bin_id = coalesce(excluded.bin_id, public.mi_stock_levels.bin_id), min_qty = coalesce(excluded.min_qty, public.mi_stock_levels.min_qty),
              max_qty = coalesce(excluded.max_qty, public.mi_stock_levels.max_qty), reorder_point = coalesce(excluded.reorder_point, public.mi_stock_levels.reorder_point);
            new_qty := nullif(r ->> 'on_hand', '')::numeric;
            cost := nullif(r ->> 'unit_cost', '')::numeric;
            if new_qty is not null then
              select on_hand into cur from public.mi_stock_levels where part_id = pid and location_id = loc;
              if new_qty < 0 then raise exception 'On hand can''t be negative.'; end if;
              if new_qty <> cur then
                perform public.mi__post(acct, pid, loc, 'adjust', new_qty - cur, cost, null, null, null, null, null, 'import', 'CSV import', 'import', null, false, cost is not null);
              elsif cost is not null and cur > 0 then
                update public.mi_stock_levels set avg_cost = cost where part_id = pid and location_id = loc and avg_cost = 0;
              end if;
            end if;
          end if;

          if was_new then created := created + 1; else updated := updated + 1; end if;
          results := results || jsonb_build_object('row', i, 'status', case when was_new then 'create' else 'update' end, 'part', coalesce(nullif(trim(r ->> 'name'), ''), r ->> 'sku'), 'location', r ->> 'location');
        exception when others then
          errors := errors + 1;
          results := results || jsonb_build_object('row', i, 'status', 'error', 'part', coalesce(nullif(trim(r ->> 'name'), ''), r ->> 'sku'), 'location', r ->> 'location', 'message', sqlerrm);
        end;
      end loop;
    end;
    if not p_commit or errors > 0 then
      raise exception 'mi_import_rollback' using errcode = 'MI001';
    end if;
  exception when sqlstate 'MI001' then
    null; -- rolled back on purpose; `results` still holds what would have happened
  end;
  return jsonb_build_object('ok', errors = 0, 'committed', p_commit and errors = 0, 'created', created, 'updated', updated, 'errors', errors, 'rows', results);
end;
$$;

-- ---- Who gets each alert --------------------------------------------------------
-- Managers of the site, then the region. A stockout adds the director. If nobody holds
-- those roles yet, it goes to the director and admins rather than to no one.
create or replace function public.mi__alert_recipients(p_alert uuid)
returns table (user_id uuid, name text, phone text, sms_ok boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  a public.mi_alerts;
  site uuid;
  region text;
  ids uuid[] := '{}';
begin
  select * into a from public.mi_alerts where id = p_alert;
  if a.kind in ('tool_overdue', 'tool_transfer') then
    ids := array[a.target_user_id];
  else
    if a.tool_id is not null then
      select l.site_id, l.region_name into site, region from public.mi_tools t join public.mi_stock_locations l on l.id = t.home_location_id where t.id = a.tool_id;
    else
      select l.site_id, l.region_name into site, region from public.mi_stock_locations l where l.id = a.location_id;
    end if;
    select coalesce(array_agg(m.user_id), '{}') into ids from public.mi_members m
    where m.account_id = a.account_id and (
      (m.role = 'site_manager' and site = any (m.site_ids))
      or (m.role = 'regional_manager' and (
        site = any (m.site_ids) or site = any (public.mi__region_sites(m.account_id, m.region_names)) or region = any (m.region_names)))
    );
    if a.kind = 'critical_zero' or coalesce(array_length(ids, 1), 0) = 0 then
      ids := ids || (select coalesce(array_agg(m.user_id), '{}') from public.mi_members m
                     where m.account_id = a.account_id and m.role in ('corporate_maintenance_director', 'admin'));
    end if;
  end if;
  return query
    select u.id, u.name, u.phone, (coalesce(u.phone, '') <> '' and coalesce(u.sms_opt_in, false))
    from public.users u where u.id = any (ids);
end;
$$;

-- ---- Nightly: reorder points, overdue tools, scheduled counts -------------------
create or replace function public.mi__nightly(p_account uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s record;
  t record;
  st public.mi_settings;
  l record;
  scanned integer := 0;
  overdue integer := 0;
  counts integer := 0;
  sched jsonb;
  spec record;
begin
  select * into st from public.mi_settings where account_id = p_account;
  for s in select part_id, location_id from public.mi_stock_levels where account_id = p_account loop
    perform public.mi__eval_stock(s.part_id, s.location_id);
    scanned := scanned + 1;
  end loop;

  for t in
    select tt.*, u.name as custodian_name from public.mi_tools tt left join public.users u on u.id = tt.custodian_user_id
    where tt.account_id = p_account and tt.status = 'checked_out' and tt.due_at < now()
  loop
    overdue := overdue + 1;
    if t.custodian_user_id is not null then
      perform public.mi__raise_alert(p_account, 'tool_overdue', 'tool_overdue:' || t.id,
        t.name || ' was due back ' || to_char(t.due_at at time zone st.timezone, 'Mon DD') || '. Please return it or update the due date.',
        p_tool => t.id, p_target => t.custodian_user_id);
    end if;
    if t.due_at < now() - interval '24 hours' then
      perform public.mi__raise_alert(p_account, 'tool_overdue_manager', 'tool_overdue_manager:' || t.id,
        t.name || ' is overdue with ' || coalesce(t.custodian_name, 'a truck or crib') || ' since ' || to_char(t.due_at at time zone st.timezone, 'Mon DD') || '.',
        p_tool => t.id);
    end if;
  end loop;

  if st.auto_counts_enabled then
    sched := st.count_schedule;
    for l in select id from public.mi_stock_locations where account_id = p_account and active loop
      for spec in
        select * from (values
          ('critical', null::text, (sched ->> 'critical_days')::int),
          ('abc', 'A', (sched ->> 'a_days')::int),
          ('abc', 'B', (sched ->> 'b_days')::int),
          ('abc', 'C', (sched ->> 'c_days')::int)) v(scope_type, scope_value, days)
      loop
        if spec.days is not null
           and not exists (select 1 from public.mi_cycle_counts c
                           where c.location_id = l.id and c.scope_type = spec.scope_type and c.scope_value is not distinct from spec.scope_value
                             and c.scheduled and c.status <> 'cancelled' and c.created_at > now() - make_interval(days => spec.days))
           and exists (select 1 from public.mi_stock_levels x join public.parts p on p.id = x.part_id
                       where x.location_id = l.id and case when spec.scope_type = 'critical' then p.is_critical else p.abc_class = spec.scope_value end)
        then
          perform public.mi__make_count(p_account, l.id, spec.scope_type, spec.scope_value, true, current_date + 3, 'Scheduled count', true);
          counts := counts + 1;
        end if;
      end loop;
    end loop;
  end if;
  return jsonb_build_object('stock_rows', scanned, 'overdue_tools', overdue, 'counts_created', counts);
end;
$$;

-- ---- Sample data ----------------------------------------------------------------
-- The one thing allowed to delete from the ledgers. Anything done at a sample location
-- goes with it, so this is only for clearing the demo before going live.
create or replace function public.mi_remove_sample_data() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  locs uuid[];
  n_parts integer;
begin
  perform public.mi__require_rank(5, 'remove sample data');
  perform set_config('mi.purge', 'on', true);
  select coalesce(array_agg(id), '{}') into locs from public.mi_stock_locations where account_id = acct and is_sample;

  delete from public.mi_tags t where t.account_id = acct and (
    (t.entity_type = 'location' and t.entity_id = any (locs))
    or (t.entity_type = 'bin' and t.entity_id in (select b.id from public.mi_bins b where b.location_id = any (locs)))
    or (t.entity_type = 'tool' and t.entity_id in (select id from public.mi_tools where account_id = acct and is_sample)));
  delete from public.mi_alerts where account_id = acct and (location_id = any (locs) or tool_id in (select id from public.mi_tools where account_id = acct and is_sample)
    or part_id in (select id from public.parts where account_id = acct and is_sample));
  delete from public.mi_receipts where account_id = acct and location_id = any (locs);
  delete from public.mi_inventory_transactions where account_id = acct and (is_sample or location_id = any (locs)
    or part_id in (select id from public.parts where account_id = acct and is_sample));
  delete from public.mi_purchase_orders where account_id = acct and (is_sample or ship_to_location_id = any (locs));
  delete from public.mi_transfers where account_id = acct and (is_sample or from_location_id = any (locs) or to_location_id = any (locs));
  delete from public.mi_cycle_counts where account_id = acct and (is_sample or location_id = any (locs));
  delete from public.mi_tool_audits where account_id = acct and location_id = any (locs);
  delete from public.mi_tools where account_id = acct and (is_sample or home_location_id = any (locs) or custodian_location_id = any (locs));
  delete from public.mi_kits where account_id = acct and is_sample;
  delete from public.mi_stock_levels where account_id = acct and (is_sample or location_id = any (locs)
    or part_id in (select id from public.parts where account_id = acct and is_sample));
  delete from public.work_order_parts wp where wp.catalog_part_id in (select id from public.parts where account_id = acct and is_sample);
  delete from public.parts where account_id = acct and is_sample;
  get diagnostics n_parts = row_count;
  delete from public.mi_stock_locations where account_id = acct and is_sample;
  perform set_config('mi.purge', 'off', true);
  return jsonb_build_object('ok', true, 'locations', coalesce(array_length(locs, 1), 0), 'parts', n_parts);
end;
$$;

-- Everything a phone needs to keep working with no signal: tags, parts and stock at
-- this person's locations, open work orders, their tools.
create or replace function public.mi_offline_snapshot() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  vis uuid[] := public.mi_visible_location_ids();
begin
  return jsonb_build_object(
    'at', now(),
    'tags', (select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'entity_type', t.entity_type, 'entity_id', t.entity_id)), '[]'::jsonb) from public.mi_tags t where t.account_id = acct),
    'stock', (select coalesce(jsonb_agg(public.mi__stock_row(s)), '[]'::jsonb) from public.mi_stock_levels s where s.location_id = any (vis)),
    'barcodes', (select coalesce(jsonb_agg(jsonb_build_object('code', upper(p.barcode), 'part_id', p.id, 'name', p.name)), '[]'::jsonb) from public.parts p where p.account_id = acct and coalesce(p.barcode, '') <> ''),
    'work_orders', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'number', w.number, 'title', w.title, 'location_id', w.location_id, 'equipment_id', w.equipment_id)), '[]'::jsonb)
                    from public.work_orders w where w.account_id = acct and w.status in ('open', 'in_progress', 'on_hold') and w.location_id = any (public.auth_site_ids())),
    'tools', (select coalesce(jsonb_agg(to_jsonb(t) - 'notes'), '[]'::jsonb) from public.mi_tools t where t.account_id = acct and (t.custodian_user_id = auth.uid() or t.home_location_id = any (vis))),
    'locations', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'site_id', l.site_id, 'type', l.type)), '[]'::jsonb) from public.mi_stock_locations l where l.id = any (vis)));
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
