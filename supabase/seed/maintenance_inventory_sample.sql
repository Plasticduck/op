-- Maintenance Inventory sample data, for Mighty Wash. Run once by hand:
--   sql.sh supabase/seed/maintenance_inventory_sample.sql
-- Everything is flagged is_sample, and Settings > Sample data removes it (mi_remove_sample_data).
--
-- Departures from the spec's seed list, on purpose:
-- - No fake "Lubbock 1" or "Hobbs Lube" sites. Real sites appear in every list in the
--   app, so the sample stock sits at real MW01 (Lubbock) and MW19 (Hobbs) instead.
-- - No sample work orders: those would show on the real Work Orders pages.
-- - Vendors are ones Operator already has. AVW, Vaughan and a Graco distributor aren't
--   in Operator yet and aren't added here.
-- - Asset categories aren't seeded: the 2,149 real equipment rows already carry types.
do $$
declare
  a uuid := '54f3e299-1f61-4ed2-9921-3d02160b72e6';
  mw01 uuid;
  mw19 uuid;
  kevan uuid;
  lbk uuid;
  hobbs uuid;
  wh uuid;
  truck1 uuid;
  truck2 uuid;
  tunnel_kit uuid;
  lube_kit uuid;
  p record;
  pid uuid;
  vid uuid;
  cid uuid;
  bin uuid;
  n integer := 0;
  m integer;
  cur numeric;
  used numeric;
  at_time timestamptz;
  moves integer;
  asset uuid;
  t record;
  tid uuid;
  po uuid;
  pl uuid;
  xfer uuid;
  cnt uuid;
  grease uuid;
  tips uuid;
  roller uuid;
  chain uuid;
  motor uuid;
begin
  if exists (select 1 from public.mi_stock_locations where account_id = a and is_sample) then
    raise exception 'Sample data is already loaded.';
  end if;
  select id into mw01 from public.locations where account_id = a and name = 'MW01';
  select id into mw19 from public.locations where account_id = a and name = 'MW19';
  select id into kevan from public.users where lower(email) = 'kevan@washlyfe.com';

  insert into public.mi_stock_locations (account_id, site_id, name, type, is_sample) values (a, mw01, 'MW01 Stockroom', 'stockroom', true) returning id into lbk;
  insert into public.mi_stock_locations (account_id, site_id, name, type, is_sample) values (a, mw19, 'MW19 Lube Cabinet', 'cabinet', true) returning id into hobbs;
  insert into public.mi_stock_locations (account_id, region_name, name, type, is_sample) values (a, 'Lubbock Region', 'Lubbock Regional Warehouse', 'regional_warehouse', true) returning id into wh;
  insert into public.mi_stock_locations (account_id, region_name, name, type, assigned_user_id, is_sample) values (a, 'Lubbock Region', 'Truck 1', 'truck', kevan, true) returning id into truck1;
  insert into public.mi_stock_locations (account_id, region_name, name, type, is_sample) values (a, 'New Mexico Region', 'Truck 2', 'truck', true) returning id into truck2;

  insert into public.mi_areas (account_id, site_id, name, sort_order)
  select a, mw01, x.name, x.ord from unnest(array['Tunnel Entrance', 'Wash Zone', 'Dryer Zone', 'Equipment Room', 'Vacuum Island', 'Pay Station Lane']) with ordinality as x(name, ord)
  on conflict do nothing;
  insert into public.mi_areas (account_id, site_id, name, sort_order)
  select a, mw19, x.name, x.ord from unnest(array['Lube Bay', 'Equipment Room']) with ordinality as x(name, ord)
  on conflict do nothing;

  insert into public.mi_kits (account_id, name, kind, description, is_sample) values (a, 'Tunnel Down Kit', 'tunnel', 'Per tunnel. Everything that keeps a conveyor stop short.', true) returning id into tunnel_kit;
  insert into public.mi_kits (account_id, name, kind, description, is_sample) values (a, 'Lube Bay Down Kit', 'lube', 'What keeps a lube bay running.', true) returning id into lube_kit;
  insert into public.mi_site_kits (site_id, kit_id, account_id) values (mw01, tunnel_kit, a), (mw19, lube_kit, a);

  -- kit: T tunnel, L lube, C common. qty = kit quantity or the site's min.
  for p in select * from (values
    ('T01', 'Conveyor chain, 10 ft', 'Tunnel Parts', 'T', 1, 'A', 640.00, 'Sonny''s Car Wash', 1, 3),
    ('T02', 'Conveyor roller assembly', 'Tunnel Parts', 'T', 2, 'A', 42.50, 'Sonny''s Car Wash', 1, 6),
    ('T03', 'Double-action air cylinder', 'Pressure Flow Parts', 'T', 2, 'B', 118.00, 'Macneil', 1, 3),
    ('T04', 'Drive sprocket', 'Tunnel Parts', 'T', 1, 'B', 210.00, 'Sonny''s Car Wash', 1, 1),
    ('T05', 'Spring fork return', 'Tunnel Parts', 'T', 1, 'C', 36.00, 'Motor City Wash Works', 1, 2),
    ('T06', 'Call-up fork', 'Tunnel Parts', 'T', 1, 'C', 58.00, 'Motor City Wash Works', 1, 2),
    ('T07', '1 in flange bearing', 'Tunnel Parts', 'T', 2, 'B', 24.00, 'Grainger', 1, 4),
    ('T08', 'Take-up drum', 'Tunnel Parts', 'T', 1, 'C', 395.00, 'Sonny''s Car Wash', 1, 1),
    ('T09', 'Conveyor tension cylinder', 'Hydraulic Parts', 'T', 1, 'B', 265.00, 'Sonny''s Car Wash', 1, 1),
    ('T10', 'Return door', 'Tunnel Parts', 'T', 1, 'C', 180.00, 'Motor City Wash Works', 1, 0),
    ('T11', 'Rotary encoder', 'Electronics', 'T', 1, 'A', 325.00, 'Macneil', 1, 2),
    ('T12', 'Gear reducer', 'Hydraulic Parts', 'T', 1, 'A', 980.00, 'Sonny''s Car Wash', 1, 1),
    ('T13', 'Critical level switch', 'Electronics', 'T', 1, 'B', 74.00, 'Grainger', 1, 2),
    ('T14', 'Proximity photo eye', 'Electronics', 'T', 2, 'B', 89.00, 'Grainger', 1, 1),
    ('T15', 'Solenoid valve', 'Pressure Flow Parts', 'T', 2, 'A', 66.00, 'Macneil', 1, 4),
    ('T16', 'Hydraulic hose assembly', 'Hydraulic Parts', 'T', 2, 'B', 92.00, 'Lubbock Gasket & Supply', 1, 3),
    ('T17', 'High-pressure nozzle assortment', 'Spray Nozzles & Swivels', 'T', 1, 'B', 145.00, 'Hydra-Flex', 1, 2),
    ('T18', 'Swivel', 'Spray Nozzles & Swivels', 'T', 2, 'B', 48.00, 'Hydra-Flex', 1, 4),
    ('T19', 'Brush motor', 'Equipment', 'T', 1, 'A', 720.00, 'Macneil', 1, 1),
    ('T20', 'Dryer motor contactor and overload', 'Electronics', 'T', 1, 'B', 138.00, 'Grainger', 1, 1),
    ('L01', 'Oil pump repair kit', 'Lube Equipment Parts', 'L', 1, 'A', 210.00, 'O''Reilly', 1, 2),
    ('L02', 'Control valve and meter repair kit', 'Lube Equipment Parts', 'L', 1, 'B', 165.00, 'O''Reilly', 1, 1),
    ('L03', 'Hose reel spring and swivel kit', 'Lube Equipment Parts', 'L', 1, 'B', 95.00, 'O''Reilly', 1, 1),
    ('L04', 'Drain receiver hose', 'Hose & Tubing', 'L', 1, 'C', 42.00, 'Lubbock Gasket & Supply', 1, 0),
    ('L05', 'Grease gun coupler', 'Lube Equipment Parts', 'L', 2, 'C', 14.00, 'O''Reilly', 1, 4),
    ('L06', 'Air regulator and filter element', 'Filters', 'L', 1, 'C', 38.00, 'Grainger', 1, 2),
    ('L07', 'Lift safety lock parts', 'Lube Equipment Parts', 'L', 1, 'B', 120.00, 'Grainger', 1, 1),
    ('C01', 'Spray tips', 'Spray Nozzles & Swivels', 'C', 10, 'B', 6.50, 'Hydra-Flex', 10, 34),
    ('C02', 'HP pump O-ring and seal kit', 'Pumps', 'C', 2, 'B', 58.00, 'Car Wash Super Store', 1, 5),
    ('C03', 'Pump oil, quart', 'Pumps', 'C', 4, 'C', 11.00, 'Car Wash Super Store', 12, 18),
    ('C04', 'Grease tube', 'Hydraulic Parts', 'C', 6, 'C', 5.25, 'Grainger', 10, 28),
    ('C05', 'RO prefilter', 'Filters', 'C', 4, 'B', 19.00, 'Car Wash Super Store', 4, 3),
    ('C06', 'Brush cloth element', 'Brushes/Cloth/Foam', 'C', 4, 'A', 74.00, 'Macneil', 1, 9),
    ('C07', 'Vacuum hose, 15 ft', 'Vacuum Hose', 'C', 2, 'C', 62.00, 'Kleen Rite', 1, 6),
    ('C08', 'Vacuum cuff', 'Vacuum Hose', 'C', 4, 'C', 9.50, 'Kleen Rite', 4, 16),
    ('C09', 'LED lamp', 'Lighting', 'C', 6, 'C', 18.00, 'Grainger', 6, 22),
    ('C10', 'Fuse assortment', 'Electronics', 'C', 2, 'C', 22.00, 'Grainger', 1, 5),
    ('C11', 'Zip ties, bag of 100', 'Janitorial & Vending', 'C', 2, 'C', 7.50, 'Uline', 1, 8),
    ('C12', 'Pipe fittings, assorted', 'Fittings', 'C', 3, 'C', 16.00, 'Lubbock Gasket & Supply', 1, 12),
    ('C13', 'RFID tags, roll', 'Electronics', 'C', 1, 'B', 145.00, 'Car Wash Super Store', 1, 2),
    ('C14', 'Receipt paper, case', 'Janitorial & Vending', 'C', 2, 'C', 39.00, 'Uline', 1, 5)
  ) v(sku, name, category, kit, qty, abc, cost, vendor, pack, start_qty)
  loop
    select id into cid from public.mi_part_categories where account_id = a and name = p.category;
    select id into vid from public.vendors where account_id = a and name = p.vendor;
    insert into public.parts (account_id, name, sku, category_id, is_critical, abc_class, unit_cost, pack_qty, uom, lead_time_days, is_sample)
    values (a, p.name, 'SAMPLE-' || p.sku, cid, p.kit in ('T', 'L'), p.abc, p.cost, p.pack, 'ea', 3 + abs(hashtext(p.sku)) % 12, true)
    returning id into pid;
    insert into public.mi_part_vendors (account_id, part_id, vendor_id, vendor_part_number, price, pack_qty, lead_time_days, preferred)
    values (a, pid, vid, 'V-' || p.sku, p.cost, p.pack, 3 + abs(hashtext(p.sku)) % 12, true);
    if p.kit = 'T' then insert into public.mi_kit_items (kit_id, part_id, qty) values (tunnel_kit, pid, p.qty); end if;
    if p.kit = 'L' then insert into public.mi_kit_items (kit_id, part_id, qty) values (lube_kit, pid, p.qty); end if;
    if p.sku = 'T02' then roller := pid; end if;
    if p.sku = 'T01' then chain := pid; end if;
    if p.sku = 'T19' then motor := pid; end if;
    if p.sku = 'C04' then grease := pid; end if;
    if p.sku = 'C01' then tips := pid; end if;

    n := n + 1;
    -- Where it lives: lube parts at the Hobbs cabinet, everything else at the MW01 stockroom.
    insert into public.mi_bins (account_id, location_id, name)
    values (a, case when p.kit = 'L' then hobbs else lbk end, case when p.kit = 'L' then 'L-' else 'A-' end || lpad(n::text, 2, '0'))
    returning id into bin;

    -- A year of history, so the reports have something to show: an opening receipt, then
    -- monthly use. Slow movers (class C, kit parts) barely move; some don't at all.
    cur := p.start_qty * 2 + 2;
    asset := case when p.sku in ('T01', 'T02', 'T19') then (select e.id from public.equipment e where e.location_id = mw01 and e.name = case p.sku when 'T01' then '#01 - Chain' when 'T02' then '#01 - Chain Rollers' else '#01 - Top Brush 1 - Motor' end limit 1) end;
    at_time := now() - interval '13 months';
    insert into public.mi_inventory_transactions (account_id, part_id, location_id, type, qty, qty_before, qty_after, unit_cost, notes, source, is_sample, created_at)
    values (a, pid, case when p.kit = 'L' then hobbs else lbk end, 'receive', cur, 0, cur, p.cost, 'Sample opening stock', 'import', true, at_time);
    moves := case p.abc when 'A' then 12 when 'B' then 8 else case when abs(hashtext(p.sku)) % 3 = 0 then 0 else 4 end end;
    if moves > 0 then
      for m in 1 .. moves loop
        at_time := now() - make_interval(months => 12 - (m - 1) * 12 / moves, days => abs(hashtext(p.sku || m)) % 20);
        -- Even use across the year, so recent months have movement too.
        used := least(greatest(cur - p.start_qty, 0), ceil(greatest(cur - p.start_qty, 0) / (moves - m + 1)));
        exit when used <= 0;
        insert into public.mi_inventory_transactions (account_id, part_id, location_id, type, qty, qty_before, qty_after, unit_cost, asset_id, source, is_sample, created_at)
        values (a, pid, case when p.kit = 'L' then hobbs else lbk end, 'issue', -used, cur, cur - used, p.cost, asset, 'mobile', true, at_time);
        cur := cur - used;
      end loop;
    end if;
    -- Land on the quantity this sample is meant to show today.
    if cur <> p.start_qty then
      insert into public.mi_inventory_transactions (account_id, part_id, location_id, type, qty, qty_before, qty_after, unit_cost, asset_id, source, is_sample, created_at)
      values (a, pid, case when p.kit = 'L' then hobbs else lbk end, 'issue', p.start_qty - cur, cur, p.start_qty, p.cost, asset, 'mobile', true, now() - interval '9 days');
    end if;
    insert into public.mi_stock_levels (account_id, part_id, location_id, bin_id, on_hand, min_qty, max_qty, reorder_point, avg_cost, last_moved_at, is_sample)
    values (a, pid, case when p.kit = 'L' then hobbs else lbk end, bin, p.start_qty, p.qty, greatest(p.qty * 3, p.qty + p.pack), p.qty, p.cost,
      (select max(created_at) from public.mi_inventory_transactions x where x.part_id = pid), true);

    -- The warehouse holds extra of the fast movers, some of it over max, so the reorder
    -- board has somewhere to suggest a transfer from.
    if p.abc = 'A' or p.sku in ('C01', 'C04') then
      insert into public.mi_inventory_transactions (account_id, part_id, location_id, type, qty, qty_before, qty_after, unit_cost, notes, source, is_sample, created_at)
      values (a, pid, wh, 'receive', p.qty * 5, 0, p.qty * 5, p.cost, 'Sample opening stock', 'import', true, now() - interval '60 days');
      insert into public.mi_stock_levels (account_id, part_id, location_id, on_hand, min_qty, max_qty, reorder_point, avg_cost, last_moved_at, is_sample)
      values (a, pid, wh, p.qty * 5, p.qty, p.qty * 2, p.qty, p.cost, now() - interval '60 days', true);
    end if;
  end loop;

  -- BOM on real MW01 equipment. These links only show inside this module.
  insert into public.part_assets (part_id, asset_id, qty_per)
  select roller, e.id, 2 from public.equipment e where e.location_id = mw01 and e.name = '#01 - Chain Rollers' limit 1;
  insert into public.part_assets (part_id, asset_id, qty_per)
  select chain, e.id, 1 from public.equipment e where e.location_id = mw01 and e.name = '#01 - Chain' limit 1;
  insert into public.part_assets (part_id, asset_id, qty_per)
  select motor, e.id, 1 from public.equipment e where e.location_id = mw01 and e.name = '#01 - Top Brush 1 - Motor' limit 1;

  -- Tools.
  for t in select * from (values
    ('Cordless impact driver', 'Power tools', 'DeWalt', 'DCF887', 'SN-1001', 229.00, 'available', 0),
    ('Torque wrench', 'Hand tools', 'Tekton', '24340', 'SN-1002', 139.00, 'overdue', 3),
    ('Chain breaker', 'Hand tools', 'Sonny''s', 'CB-1', 'SN-1003', 185.00, 'available', 0),
    ('Pressure gauge kit', 'Test gear', 'Hydra-Flex', 'PG-5', 'SN-1004', 96.00, 'out', 0),
    ('Multimeter', 'Test gear', 'Fluke', '117', 'SN-1005', 249.00, 'available', 0),
    ('Grease gun', 'Hand tools', 'Lincoln', '1134', 'SN-1006', 62.00, 'available', 0),
    ('Pipe wrench set', 'Hand tools', 'Ridgid', '31020', 'SN-1007', 118.00, 'available', 0),
    ('Ladder, 8 ft', 'Access', 'Werner', 'FS108', 'SN-1008', 149.00, 'repair', 0),
    ('Pressure washer', 'Power tools', 'Simpson', 'MSH3125', 'SN-1009', 399.00, 'available', 0)
  ) v(name, category, make, model, serial, cost, state, days_over)
  loop
    insert into public.mi_tools (account_id, name, category, make, model, serial_number, cost, home_location_id, custodian_location_id, is_sample, created_by)
    values (a, t.name, t.category, t.make, t.model, t.serial, t.cost, lbk, lbk, true, kevan) returning id into tid;
    insert into public.mi_tool_checkouts (account_id, tool_id, action, to_location_id, condition, status, performed_by, created_at)
    values (a, tid, 'created', lbk, 'good', 'available', kevan, now() - interval '120 days');
    if t.state in ('overdue', 'out') then
      update public.mi_tools set status = 'checked_out', custodian_user_id = kevan, custodian_location_id = null, checked_out_at = now() - interval '6 days',
        due_at = case when t.state = 'overdue' then now() - make_interval(days => t.days_over) else now() + interval '5 days' end where id = tid;
      insert into public.mi_tool_checkouts (account_id, tool_id, action, from_location_id, to_user_id, condition, status, performed_by, created_at)
      values (a, tid, 'check_out', lbk, kevan, 'good', 'checked_out', kevan, now() - interval '6 days');
    elsif t.state = 'repair' then
      update public.mi_tools set status = 'in_repair', condition = 'damaged' where id = tid;
      insert into public.mi_tool_checkouts (account_id, tool_id, action, from_location_id, to_location_id, condition, status, notes, performed_by, created_at)
      values (a, tid, 'report_issue', lbk, lbk, 'damaged', 'in_repair', 'Sample: bent rail', kevan, now() - interval '20 days');
    end if;
  end loop;

  -- A partly received PO, plus an urgent buy with a premium.
  insert into public.mi_purchase_orders (account_id, number, vendor_id, ship_to_location_id, status, created_by, submitted_by, submitted_at, approved_by, approved_at, sent_by, sent_at, sent_to, is_sample, created_at)
  select a, public.mi__next_number(a, 'po'), v.id, lbk, 'partially_received', kevan, kevan, now() - interval '9 days', kevan, now() - interval '9 days', kevan, now() - interval '8 days', 'Sample: by phone', true, now() - interval '9 days'
  from public.vendors v where v.account_id = a and v.name = 'Hydra-Flex' returning id into po;
  insert into public.mi_po_lines (po_id, part_id, qty_ordered, qty_received, unit_cost, normal_unit_cost, vendor_part_number) values (po, tips, 40, 20, 6.50, 6.50, 'V-C01') returning id into pl;

  insert into public.mi_purchase_orders (account_id, number, vendor_id, ship_to_location_id, status, urgent, created_by, approved_by, approved_at, is_sample, created_at, closed_at)
  select a, public.mi__next_number(a, 'po'), v.id, lbk, 'closed', true, kevan, kevan, now() - interval '40 days', true, now() - interval '40 days', now() - interval '35 days'
  from public.vendors v where v.account_id = a and v.name = 'Macneil' returning id into po;
  insert into public.mi_po_lines (po_id, part_id, qty_ordered, qty_received, unit_cost, normal_unit_cost, vendor_part_number) values (po, motor, 1, 1, 890.00, 720.00, 'V-T19');

  -- A transfer on the road: out of the warehouse, not yet at Hobbs.
  insert into public.mi_transfers (account_id, number, from_location_id, to_location_id, status, requested_by, requested_at, approved_by, approved_at, shipped_by, shipped_at, is_sample)
  values (a, public.mi__next_number(a, 'transfer'), wh, hobbs, 'in_transit', kevan, now() - interval '3 days', kevan, now() - interval '3 days', kevan, now() - interval '1 day', true) returning id into xfer;
  insert into public.mi_transfer_lines (transfer_id, part_id, qty_requested, qty_shipped, unit_cost) values (xfer, grease, 10, 10, 5.25);
  insert into public.mi_inventory_transactions (account_id, part_id, location_id, type, qty, qty_before, qty_after, unit_cost, transfer_id, source, is_sample, created_at)
  select a, grease, wh, 'transfer_out', -10, s.on_hand, s.on_hand - 10, 5.25, xfer, 'mobile', true, now() - interval '1 day' from public.mi_stock_levels s where s.part_id = grease and s.location_id = wh;
  update public.mi_stock_levels set on_hand = on_hand - 10, last_moved_at = now() - interval '1 day' where part_id = grease and location_id = wh;

  -- A posted count with some small differences, and one waiting for review.
  insert into public.mi_cycle_counts (account_id, number, location_id, scope_type, status, blind, posted_by, posted_at, submitted_by, submitted_at, created_by, created_at, is_sample)
  values (a, public.mi__next_number(a, 'count'), lbk, 'critical', 'posted', true, kevan, now() - interval '20 days', kevan, now() - interval '20 days', kevan, now() - interval '21 days', true) returning id into cnt;
  insert into public.mi_cycle_count_lines (count_id, part_id, bin_id, expected_qty, unit_cost, counted_qty, counted_by, counted_at, reason_code, posted, approved_by)
  select cnt, s.part_id, s.bin_id, s.on_hand, s.avg_cost,
    s.on_hand - case when abs(hashtext(s.part_id::text)) % 5 = 0 and s.on_hand > 0 then 1 else 0 end,
    kevan, now() - interval '20 days', case when abs(hashtext(s.part_id::text)) % 5 = 0 and s.on_hand > 0 then 'unknown' end, true, kevan
  from public.mi_stock_levels s join public.parts pp on pp.id = s.part_id where s.location_id = lbk and pp.is_critical;

  insert into public.mi_cycle_counts (account_id, number, location_id, scope_type, scope_value, status, blind, submitted_by, submitted_at, created_by, created_at, is_sample)
  values (a, public.mi__next_number(a, 'count'), lbk, 'abc', 'C', 'open', true, null, null, kevan, now() - interval '1 day', true) returning id into cnt;
  insert into public.mi_cycle_count_lines (count_id, part_id, bin_id, expected_qty, unit_cost)
  select cnt, s.part_id, s.bin_id, s.on_hand, s.avg_cost
  from public.mi_stock_levels s join public.parts pp on pp.id = s.part_id where s.location_id = lbk and pp.abc_class = 'C';

  -- Stickers ready to print and scan, in the same number series the app uses.
  insert into public.mi_tags (account_id, code, entity_type, entity_id)
  select a, 'MF-B-' || lpad(public.mi__next_number(a, 'MF-B-')::text, 5, '0'), 'bin', b.id
  from public.mi_bins b join public.mi_stock_locations l on l.id = b.location_id where l.account_id = a and l.is_sample order by b.name;
  insert into public.mi_tags (account_id, code, entity_type, entity_id)
  select a, 'MF-T-' || lpad(public.mi__next_number(a, 'MF-T-')::text, 5, '0'), 'tool', x.id
  from public.mi_tools x where x.account_id = a and x.is_sample order by x.name;
  insert into public.mi_tags (account_id, code, entity_type, entity_id)
  select a, 'MF-L-' || lpad(public.mi__next_number(a, 'MF-L-')::text, 5, '0'), 'location', l.id
  from public.mi_stock_locations l where l.account_id = a and l.is_sample order by l.name;

  raise notice 'Loaded % sample parts', n;
end $$;
