-- Maintenance Inventory: the spec's acceptance criteria and who can do what.
--
-- Runs inside one transaction that always rolls back: any failure raises "FAIL n: ...",
-- and a clean run ends by raising "ALL PASS", so nothing it does is ever committed.
-- Impersonates users the way PostgREST does. Uses real Mighty Wash sites and regions,
-- which is what the region rules read.
--
--   sql.sh supabase/tests/maintenance_inventory.sql

begin;

select set_config('t.acct', '54f3e299-1f61-4ed2-9921-3d02160b72e6', true);
select set_config('t.mw01', (select id::text from public.locations where account_id = current_setting('t.acct')::uuid and name = 'MW01'), true);
select set_config('t.mw19', (select id::text from public.locations where account_id = current_setting('t.acct')::uuid and name = 'MW19'), true);
select set_config('t.conveyor', (select e.id::text from public.equipment e where e.location_id = current_setting('t.mw01')::uuid limit 1), true);
select set_config('t.kevan', (select id::text from public.users where lower(email) = 'kevan@washlyfe.com'), true);

-- Throwaway people, one per role.
do $$
declare
  a uuid := current_setting('t.acct')::uuid;
  u record;
begin
  for u in select * from (values
    ('tech_lbk', 'site_tech', array[current_setting('t.mw01')::uuid], '{}'::text[]),
    ('mgr_lbk', 'site_manager', array[current_setting('t.mw01')::uuid], '{}'::text[]),
    ('reg_lbk', 'regional_manager', '{}'::uuid[], array['Lubbock Region']),
    ('reg_nm', 'regional_manager', '{}'::uuid[], array['New Mexico Region']),
    ('tech_nm', 'site_tech', array[current_setting('t.mw19')::uuid], '{}'::text[]),
    ('mgr_nm', 'site_manager', array[current_setting('t.mw19')::uuid], '{}'::text[]),
    ('director', 'corporate_maintenance_director', '{}'::uuid[], '{}'::text[])) v(k, r, sites, regions)
  loop
    perform set_config('t.' || u.k, gen_random_uuid()::text, true);
    insert into auth.users (id, email, instance_id, aud, role)
    values (current_setting('t.' || u.k)::uuid, u.k || '@mi-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.users (id, account_id, location_ids, role, name, email)
    values (current_setting('t.' || u.k)::uuid, a, u.sites, 'manager', 'Test ' || u.k, u.k || '@mi-test.invalid');
    insert into public.mi_members (user_id, account_id, role, site_ids, region_names)
    values (current_setting('t.' || u.k)::uuid, a, u.r, u.sites, u.regions);
  end loop;
  -- A real Admin on the account with no membership: Operator role alone gets them nothing.
  perform set_config('t.outsider', gen_random_uuid()::text, true);
  insert into auth.users (id, email, instance_id, aud, role)
  values (current_setting('t.outsider')::uuid, 'outsider@mi-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  insert into public.users (id, account_id, location_ids, role, name, email)
  values (current_setting('t.outsider')::uuid, a, '{}', 'owner', 'Test outsider', 'outsider@mi-test.invalid');
end $$;

-- Places, parts and stock.
do $$
declare
  a uuid := current_setting('t.acct')::uuid;
  v1 uuid;
  v2 uuid;
begin
  insert into public.mi_stock_locations (account_id, site_id, name, type) values (a, current_setting('t.mw01')::uuid, 'TEST Lubbock 1 stockroom', 'stockroom');
  insert into public.mi_stock_locations (account_id, site_id, name, type) values (a, current_setting('t.mw19')::uuid, 'TEST Hobbs Lube cabinet', 'cabinet');
  insert into public.mi_stock_locations (account_id, region_name, name, type) values (a, 'Lubbock Region', 'TEST Lubbock warehouse', 'regional_warehouse');
  perform set_config('t.lbk', (select id::text from public.mi_stock_locations where name = 'TEST Lubbock 1 stockroom'), true);
  perform set_config('t.hobbs', (select id::text from public.mi_stock_locations where name = 'TEST Hobbs Lube cabinet'), true);
  perform set_config('t.wh', (select id::text from public.mi_stock_locations where name = 'TEST Lubbock warehouse'), true);
  insert into public.mi_bins (account_id, location_id, name) values (a, current_setting('t.lbk')::uuid, 'TEST A-1');
  perform set_config('t.bin', (select id::text from public.mi_bins where name = 'TEST A-1'), true);

  insert into public.parts (account_id, name, sku, is_critical, manufacturer, mfr_part_number, barcode, unit_cost)
  values (a, 'TEST Conveyor Roller Assembly', 'TEST-ROLLER', true, 'TestCo', 'TC-100', '0012345678905', 40);
  perform set_config('t.roller', (select id::text from public.parts where sku = 'TEST-ROLLER'), true);
  insert into public.parts (account_id, name, sku, pack_qty) values (a, 'TEST Spray Tip', 'TEST-TIP', 1);
  perform set_config('t.tip', (select id::text from public.parts where sku = 'TEST-TIP'), true);
  insert into public.parts (account_id, name, sku) values (a, 'TEST Grease Tube', 'TEST-GREASE');
  perform set_config('t.grease', (select id::text from public.parts where sku = 'TEST-GREASE'), true);

  select id into v1 from public.vendors where account_id = a and name = 'Sonny''s Car Wash';
  select id into v2 from public.vendors where account_id = a and name = 'Grainger';
  perform set_config('t.vendor1', v1::text, true);
  perform set_config('t.vendor2', v2::text, true);
  insert into public.mi_part_vendors (account_id, part_id, vendor_id, price, pack_qty, preferred)
  values (a, current_setting('t.tip')::uuid, v1, 2, 4, true),
         (a, current_setting('t.roller')::uuid, v1, 40, 1, true),
         (a, current_setting('t.grease')::uuid, v2, 6, 1, true);

  -- 3 rollers on hand at $40, min 2.
  perform public.mi__post(a, current_setting('t.roller')::uuid, current_setting('t.lbk')::uuid, 'adjust', 3, 40, p_reason => 'test', p_blend_cost => true);
  update public.mi_stock_levels set bin_id = current_setting('t.bin')::uuid, min_qty = 2, max_qty = 6, reorder_point = 2
  where part_id = current_setting('t.roller')::uuid and location_id = current_setting('t.lbk')::uuid;
  perform public.mi__post(a, current_setting('t.roller')::uuid, current_setting('t.hobbs')::uuid, 'adjust', 4, 40, p_reason => 'test', p_blend_cost => true);
  perform public.mi__post(a, current_setting('t.grease')::uuid, current_setting('t.wh')::uuid, 'adjust', 20, 6, p_reason => 'test', p_blend_cost => true);

  insert into public.work_orders (account_id, location_id, title, status, priority, equipment_id)
  values (a, current_setting('t.mw01')::uuid, 'TEST conveyor rollers', 'open', 'high', current_setting('t.conveyor')::uuid);
  perform set_config('t.wo', (select id::text from public.work_orders where title = 'TEST conveyor rollers'), true);
end $$;

-- ===== Criterion 8: who can see and write what =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.mi_stock_levels where location_id = current_setting('t.lbk')::uuid) = 0 then raise exception 'FAIL 1: Lubbock tech can''t see own stock'; end if;
  if (select count(*) from public.mi_stock_levels where location_id = current_setting('t.hobbs')::uuid) <> 0 then raise exception 'FAIL 2: Lubbock tech can read Hobbs stock'; end if;
  if (select count(*) from public.mi_inventory_transactions where location_id = current_setting('t.hobbs')::uuid) <> 0 then raise exception 'FAIL 3: Lubbock tech can read Hobbs ledger'; end if;
  if (select count(*) from public.mi_stock_locations where id = current_setting('t.hobbs')::uuid) <> 0 then raise exception 'FAIL 4: Lubbock tech can see the Hobbs location'; end if;
end $$;
do $$ begin
  insert into public.mi_inventory_transactions (account_id, part_id, location_id, type, qty, qty_before, qty_after)
  values (current_setting('t.acct')::uuid, current_setting('t.roller')::uuid, current_setting('t.lbk')::uuid, 'adjust', 100, 0, 100);
  raise exception 'FAIL 5: tech wrote the ledger directly';
exception when insufficient_privilege then null; end $$;
do $$ begin
  update public.mi_stock_levels set on_hand = 999 where location_id = current_setting('t.lbk')::uuid;
  raise exception 'FAIL 6: tech updated stock directly';
exception when insufficient_privilege then null; end $$;
do $$ begin
  delete from public.mi_inventory_transactions;
  raise exception 'FAIL 7: tech deleted from the ledger';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.mi_issue_part(current_setting('t.roller')::uuid, current_setting('t.hobbs')::uuid, 1);
  raise exception 'FAIL 8: Lubbock tech issued Hobbs stock';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.mi__post(current_setting('t.acct')::uuid, current_setting('t.roller')::uuid, current_setting('t.lbk')::uuid, 'adjust', 100);
  raise exception 'FAIL 9: tech called an internal function';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.mi_adjust_stock(current_setting('t.roller')::uuid, current_setting('t.lbk')::uuid, 5, 'x');
  raise exception 'FAIL 10: tech adjusted stock';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.mi_save_part(jsonb_build_object('name', 'TEST by tech'));
  raise exception 'FAIL 11: tech edited the catalog';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.mi_part_categories (account_id, name) values (current_setting('t.acct')::uuid, 'TEST by tech');
  raise exception 'FAIL 12: tech added a category';
exception when insufficient_privilege then null; end $$;
do $$
declare r public.mi_part_requests;
begin
  r := public.mi_request_part('TEST proposed part');
  if r.status <> 'pending' then raise exception 'FAIL 13: tech couldn''t propose a part'; end if;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.reg_nm'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.mi_stock_levels where location_id = current_setting('t.hobbs')::uuid) = 0 then raise exception 'FAIL 14: NM regional can''t see Hobbs'; end if;
  if (select count(*) from public.mi_stock_levels where location_id = current_setting('t.lbk')::uuid) <> 0 then raise exception 'FAIL 15: NM regional can see Lubbock'; end if;
  if (select count(*) from public.mi_stock_levels where location_id = current_setting('t.wh')::uuid) <> 0 then raise exception 'FAIL 16: NM regional can see the Lubbock warehouse'; end if;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.director'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if (select count(distinct location_id) from public.mi_stock_levels where location_id = any (array[current_setting('t.lbk')::uuid, current_setting('t.hobbs')::uuid, current_setting('t.wh')::uuid])) <> 3 then
    raise exception 'FAIL 17: director doesn''t see all sites';
  end if;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.outsider'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.mi_stock_levels) <> 0 then raise exception 'FAIL 18: a non-member Admin read stock'; end if;
  if (select count(*) from public.mi_tools) <> 0 then raise exception 'FAIL 19: a non-member Admin read tools'; end if;
  if (select count(*) from public.mi_purchase_orders) <> 0 then raise exception 'FAIL 20: a non-member Admin read POs'; end if;
  if (select count(*) from public.mi_settings) <> 0 then raise exception 'FAIL 21: a non-member Admin read settings'; end if;
  if (public.mi_me() ->> 'member')::boolean then raise exception 'FAIL 22: outsider counted as a member'; end if;
end $$;
do $$ begin
  perform public.mi_issue_part(current_setting('t.roller')::uuid, current_setting('t.lbk')::uuid, 1);
  raise exception 'FAIL 23: a non-member Admin issued stock';
exception when insufficient_privilege then null; end $$;
reset role;

-- ===== Criterion 11: scanning =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  code text;
  r jsonb;
begin
  code := public.mi_ensure_tag('bin', current_setting('t.bin')::uuid);
  if code !~ '^MF-B-[0-9]+$' then raise exception 'FAIL 24: bin tag format %', code; end if;
  if public.mi_ensure_tag('bin', current_setting('t.bin')::uuid) <> code then raise exception 'FAIL 25: a second tag was made'; end if;
  r := public.mi_resolve_scan(lower(code));
  if r ->> 'kind' <> 'bin' or jsonb_array_length(r -> 'stock') <> 1 or not (r ->> 'can_act')::boolean then raise exception 'FAIL 26: bin scan %', r; end if;
  r := public.mi_resolve_scan('0012345678905');
  if r ->> 'kind' <> 'part' then raise exception 'FAIL 27: UPC scan %', r; end if;
  if jsonb_array_length(r -> 'stock') <> 1 then raise exception 'FAIL 28: a part scan showed stock at Hobbs: %', r; end if;
  r := public.mi_resolve_scan('NOT-A-THING');
  if r ->> 'kind' <> 'unknown' then raise exception 'FAIL 29: unknown scan %', r; end if;
end $$;
reset role;

-- A bin at another site doesn't open its menu.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_nm'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.mi_resolve_scan(public.mi_ensure_tag('bin', current_setting('t.bin')::uuid));
  if r ->> 'kind' <> 'other_site' then raise exception 'FAIL 30: other-site bin %', r; end if;
end $$;
reset role;

-- ===== Criteria 1, 2 and 9: consume against a work order, alerts, offline replay =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  r jsonb;
  c jsonb;
  wop public.work_order_parts;
begin
  c := public.mi_consume_context(current_setting('t.roller')::uuid, current_setting('t.lbk')::uuid, current_setting('t.conveyor')::uuid);
  if c -> 'work_orders' -> 0 ->> 'id' <> current_setting('t.wo') then raise exception 'FAIL 31: the open WO isn''t the first suggestion: %', c -> 'work_orders' -> 0; end if;

  r := public.mi_issue_part(current_setting('t.roller')::uuid, current_setting('t.lbk')::uuid, 2, current_setting('t.wo')::uuid, current_setting('t.conveyor')::uuid, 'mobile', 'txn-issue-1');
  if (r ->> 'on_hand')::numeric <> 1 then raise exception 'FAIL 32: on hand after issuing 2 of 3: %', r; end if;

  if (select count(*) from public.mi_inventory_transactions where client_txn_id = 'txn-issue-1'
      and type = 'issue' and qty = -2 and work_order_id = current_setting('t.wo')::uuid and asset_id = current_setting('t.conveyor')::uuid and unit_cost = 40 and qty_before = 3 and qty_after = 1) <> 1 then
    raise exception 'FAIL 33: ledger row missing or wrong';
  end if;
  select * into wop from public.work_order_parts where work_order_id = current_setting('t.wo')::uuid and catalog_part_id = current_setting('t.roller')::uuid;
  if wop.qty_issued <> 2 or wop.quantity <> 2 or wop.unit_cost <> 40 then raise exception 'FAIL 34: WO parts cost qty=% cost=%', wop.quantity, wop.unit_cost; end if;

  -- Criterion 9: replay of the same action changes nothing.
  r := public.mi_issue_part(current_setting('t.roller')::uuid, current_setting('t.lbk')::uuid, 2, current_setting('t.wo')::uuid, current_setting('t.conveyor')::uuid, 'mobile', 'txn-issue-1');
  if not coalesce((r ->> 'deduped')::boolean, false) then raise exception 'FAIL 35: replay wasn''t deduped: %', r; end if;
  if (select on_hand from public.mi_stock_levels where part_id = current_setting('t.roller')::uuid and location_id = current_setting('t.lbk')::uuid) <> 1 then raise exception 'FAIL 36: replay posted twice'; end if;

  -- Can't go below zero by default.
  begin
    perform public.mi_issue_part(current_setting('t.roller')::uuid, current_setting('t.lbk')::uuid, 5, current_setting('t.wo')::uuid);
    raise exception 'FAIL 37: issued more than on hand';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
reset role;

-- Below min: one alert, to the site manager and the regional, not the director.
do $$
declare
  n int;
  a public.mi_alerts;
  who uuid[];
begin
  select count(*) into n from public.mi_alerts where part_id = current_setting('t.roller')::uuid and kind = 'critical_below_min';
  if n <> 1 then raise exception 'FAIL 38: % below-min alerts', n; end if;
  select * into a from public.mi_alerts where part_id = current_setting('t.roller')::uuid and kind = 'critical_below_min';
  select array_agg(user_id) into who from public.mi__alert_recipients(a.id);
  if not (current_setting('t.mgr_lbk')::uuid = any (who) and current_setting('t.reg_lbk')::uuid = any (who)) then raise exception 'FAIL 39: below-min missed manager or regional'; end if;
  if current_setting('t.director')::uuid = any (who) then raise exception 'FAIL 40: below-min went to the director'; end if;
  if current_setting('t.reg_nm')::uuid = any (who) or current_setting('t.mgr_nm')::uuid = any (who) then raise exception 'FAIL 41: below-min went to another region'; end if;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mi_issue_part(current_setting('t.roller')::uuid, current_setting('t.lbk')::uuid, 1, current_setting('t.wo')::uuid);
  -- Restock and run out again: the same alert within 24 hours doesn't repeat.
  perform public.mi_receive_stock(current_setting('t.roller')::uuid, current_setting('t.lbk')::uuid, 1, 40);
  perform public.mi_issue_part(current_setting('t.roller')::uuid, current_setting('t.lbk')::uuid, 1, current_setting('t.wo')::uuid);
end $$;
reset role;
do $$
declare
  a public.mi_alerts;
  who uuid[];
begin
  if (select count(*) from public.mi_alerts where part_id = current_setting('t.roller')::uuid and kind = 'critical_zero') <> 1 then raise exception 'FAIL 42: zero alert repeated or missing'; end if;
  if (select count(*) from public.mi_alerts where part_id = current_setting('t.roller')::uuid and kind = 'critical_below_min') <> 1 then raise exception 'FAIL 43: below-min alert repeated'; end if;
  select * into a from public.mi_alerts where part_id = current_setting('t.roller')::uuid and kind = 'critical_zero';
  if not a.bypass_quiet then raise exception 'FAIL 44: a stockout should ignore quiet hours'; end if;
  select array_agg(user_id) into who from public.mi__alert_recipients(a.id);
  if not (current_setting('t.director')::uuid = any (who) and current_setting('t.mgr_lbk')::uuid = any (who) and current_setting('t.reg_lbk')::uuid = any (who)) then raise exception 'FAIL 45: zero alert recipients'; end if;
end $$;

-- A site that allows it can go negative, and that forces a count.
do $$ begin
  insert into public.mi_site_settings (site_id, account_id, allow_negative) values (current_setting('t.mw01')::uuid, current_setting('t.acct')::uuid, true);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.mi_issue_part(current_setting('t.roller')::uuid, current_setting('t.lbk')::uuid, 1, current_setting('t.wo')::uuid);
  if not (r ->> 'negative')::boolean then raise exception 'FAIL 46: expected negative stock: %', r; end if;
  if (select count(*) from public.mi_cycle_counts where location_id = current_setting('t.lbk')::uuid and forced and status = 'open') <> 1 then raise exception 'FAIL 47: no forced count'; end if;
end $$;
reset role;
delete from public.mi_site_settings where site_id = current_setting('t.mw01')::uuid;

-- Planned parts reserve stock, and issuing uses the reservation up.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_nm'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  wo public.work_orders;
  s public.mi_stock_levels;
begin
  wo := public.mi_create_work_order(current_setting('t.mw19')::uuid, 'TEST lube job');
  perform set_config('t.wo2', wo.id::text, true);
  perform public.mi_reserve_parts(wo.id, current_setting('t.roller')::uuid, current_setting('t.hobbs')::uuid, 3);
  select * into s from public.mi_stock_levels where part_id = current_setting('t.roller')::uuid and location_id = current_setting('t.hobbs')::uuid;
  if s.on_hand <> 4 or s.reserved <> 3 or s.available <> 1 then raise exception 'FAIL 48: reserve on_hand=% reserved=% available=%', s.on_hand, s.reserved, s.available; end if;
  begin
    perform public.mi_reserve_parts(wo.id, current_setting('t.roller')::uuid, current_setting('t.hobbs')::uuid, 5);
    raise exception 'FAIL 49: reserved more than available';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  perform public.mi_issue_part(current_setting('t.roller')::uuid, current_setting('t.hobbs')::uuid, 2, wo.id);
  select * into s from public.mi_stock_levels where part_id = current_setting('t.roller')::uuid and location_id = current_setting('t.hobbs')::uuid;
  if s.on_hand <> 2 or s.reserved <> 1 or s.available <> 1 then raise exception 'FAIL 50: after issue on_hand=% reserved=% available=%', s.on_hand, s.reserved, s.available; end if;
  perform public.mi_return_part(current_setting('t.roller')::uuid, current_setting('t.hobbs')::uuid, 1, wo.id);
  if (select quantity from public.work_order_parts where work_order_id = wo.id and catalog_part_id = current_setting('t.roller')::uuid) <> 1 then raise exception 'FAIL 51: return didn''t reduce the WO'; end if;
end $$;
reset role;

-- ===== Criterion 10: duplicates =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.director'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  d jsonb;
  caught boolean := false;
begin
  begin
    perform public.mi_save_part(jsonb_build_object('name', 'Something else', 'manufacturer', 'testco', 'mfr_part_number', 'tc-100'));
  exception when unique_violation then caught := true; end;
  if not caught then raise exception 'FAIL 52: manufacturer + part number wasn''t blocked'; end if;
  caught := false;
  begin
    perform public.mi_save_part(jsonb_build_object('name', 'Something else', 'barcode', '0012345678905'));
  exception when unique_violation then caught := true; end;
  if not caught then raise exception 'FAIL 53: barcode wasn''t blocked'; end if;
  d := public.mi_check_part_duplicates('TEST Conveyor Roller Assy');
  if jsonb_array_length(d -> 'similar') = 0 or jsonb_array_length(d -> 'exact') <> 0 then raise exception 'FAIL 54: similar name check %', d; end if;
  perform public.mi_save_part(jsonb_build_object('name', 'TEST Conveyor Roller Assy', 'sku', 'TEST-ROLLER-2'));
end $$;
reset role;

-- ===== Criteria 3 and 4: reorder board and purchasing =====
do $$ begin
  -- 2 tips on hand, reorder at 3, max 11: needs 9, pack of 4 rounds up to 12.
  perform public.mi__post(current_setting('t.acct')::uuid, current_setting('t.tip')::uuid, current_setting('t.lbk')::uuid, 'adjust', 2, 2, p_reason => 'test', p_blend_cost => true);
  update public.mi_stock_levels set min_qty = 3, reorder_point = 3, max_qty = 11 where part_id = current_setting('t.tip')::uuid and location_id = current_setting('t.lbk')::uuid;
  -- Grease: 0 here, plenty over max at the Lubbock warehouse.
  insert into public.mi_stock_levels (account_id, part_id, location_id, min_qty, reorder_point, max_qty)
  values (current_setting('t.acct')::uuid, current_setting('t.grease')::uuid, current_setting('t.lbk')::uuid, 2, 2, 6);
  update public.mi_stock_levels set max_qty = 8 where part_id = current_setting('t.grease')::uuid and location_id = current_setting('t.wh')::uuid;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.reg_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  b jsonb;
  tip jsonb;
  gr jsonb;
  res jsonb;
begin
  b := public.mi_reorder_suggestions(current_setting('t.lbk')::uuid);
  select x into tip from jsonb_array_elements(b) x where x ->> 'part_id' = current_setting('t.tip');
  select x into gr from jsonb_array_elements(b) x where x ->> 'part_id' = current_setting('t.grease');
  if (tip ->> 'suggested_qty')::numeric <> 12 then raise exception 'FAIL 55: suggested % (want 12)', tip; end if;
  if tip ->> 'vendor_id' <> current_setting('t.vendor1') then raise exception 'FAIL 56: wrong preferred vendor'; end if;
  if jsonb_array_length(gr -> 'overstock') <> 1 then raise exception 'FAIL 57: overstock elsewhere not shown: %', gr; end if;

  res := public.mi_create_draft_pos((
    select jsonb_agg(jsonb_build_object('part_id', x ->> 'part_id', 'location_id', x ->> 'location_id', 'vendor_id', x ->> 'vendor_id', 'qty', x ->> 'suggested_qty', 'unit_cost', x ->> 'unit_cost'))
    from jsonb_array_elements(b) x));
  if jsonb_array_length(res -> 'created') <> 2 then raise exception 'FAIL 58: one PO per vendor: %', res; end if;
  if (select count(*) from jsonb_array_elements(public.mi_reorder_suggestions(current_setting('t.lbk')::uuid)) x where x ->> 'part_id' = current_setting('t.tip')) <> 0 then
    raise exception 'FAIL 59: a drafted part stayed on the board';
  end if;
end $$;
reset role;

-- Roles and limits. The site manager's limit is $500.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mi_create_draft_pos(jsonb_build_array(jsonb_build_object('part_id', current_setting('t.tip'), 'location_id', current_setting('t.lbk'), 'vendor_id', current_setting('t.vendor1'), 'qty', 4, 'unit_cost', 2)));
  raise exception 'FAIL 60: a tech created a PO';
exception when insufficient_privilege then null; end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  o public.mi_purchase_orders;
begin
  begin
    perform public.mi_create_draft_pos(jsonb_build_array(jsonb_build_object('part_id', current_setting('t.tip'), 'location_id', current_setting('t.lbk'), 'vendor_id', current_setting('t.vendor1'), 'qty', 1000, 'unit_cost', 2)));
    raise exception 'FAIL 61: site manager went over the draft limit';
  exception when insufficient_privilege then null; end;
  -- 10 rollers at $12: the partial-receipt case from the spec. On hand is 5 at $10.
  o := public.mi_create_po(current_setting('t.vendor2')::uuid, current_setting('t.lbk')::uuid);
  perform set_config('t.po', o.id::text, true);
  perform public.mi_save_po_line(o.id, current_setting('t.grease')::uuid, 10, 12);
  perform public.mi_submit_po(o.id);
end $$;
reset role;
do $$ begin
  perform public.mi__post(current_setting('t.acct')::uuid, current_setting('t.grease')::uuid, current_setting('t.lbk')::uuid, 'adjust', 5, 10, p_reason => 'test', p_blend_cost => true);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.director'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mi_approve_po(current_setting('t.po')::uuid);
  perform public.mi_mark_po_sent(current_setting('t.po')::uuid, 'test@mi-test.invalid');
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  line uuid;
  r jsonb;
begin
  select id into line from public.mi_po_lines where po_id = current_setting('t.po')::uuid;
  r := public.mi_receive_po_line(line, 5);
  if r ->> 'po_status' <> 'partially_received' then raise exception 'FAIL 62: status after 5 of 10: %', r; end if;
  if (r ->> 'on_hand')::numeric <> 10 or (r ->> 'avg_cost')::numeric <> 11 then raise exception 'FAIL 63: stock or average cost after 5 of 10: %', r; end if;
  -- Defaults to what's still due.
  r := public.mi_receive_po_line(line);
  if r ->> 'po_status' <> 'received' or (r ->> 'line_open')::numeric <> 0 then raise exception 'FAIL 64: after the rest: %', r; end if;
  if (r ->> 'on_hand')::numeric <> 15 or (r ->> 'avg_cost')::numeric <> 11.3333 then raise exception 'FAIL 65: stock or average after the rest: %', r; end if;
end $$;
reset role;

-- ===== Criterion 5: transfers =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_nm'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.mi_start_transfer(current_setting('t.wh')::uuid, current_setting('t.hobbs')::uuid,
    jsonb_build_array(jsonb_build_object('part_id', current_setting('t.grease'), 'qty', 6)));
  perform set_config('t.xfer', r ->> 'transfer_id', true);
  begin
    perform public.mi_decide_transfer((r ->> 'transfer_id')::uuid, true);
    raise exception 'FAIL 66: a tech approved a transfer';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- A regional manager covering only one end can't approve between regions.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.reg_nm'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mi_decide_transfer(current_setting('t.xfer')::uuid, true);
  raise exception 'FAIL 67: approved a transfer they only see one end of';
exception when insufficient_privilege then null; end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.director'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin perform public.mi_decide_transfer(current_setting('t.xfer')::uuid, true); end $$;
reset role;
-- Only the source can ship.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_nm'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mi_ship_transfer(current_setting('t.xfer')::uuid);
  raise exception 'FAIL 68: the destination shipped';
exception when insufficient_privilege then null; end $$;
do $$ begin
  if (select count(*) from public.mi_transfers where id = current_setting('t.xfer')::uuid) <> 1 then raise exception 'FAIL 69: destination can''t see the transfer'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.reg_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin perform public.mi_ship_transfer(current_setting('t.xfer')::uuid); end $$;
do $$ begin
  perform public.mi_receive_transfer(current_setting('t.xfer')::uuid);
  raise exception 'FAIL 70: the source received its own shipment';
exception when insufficient_privilege then null; end $$;
reset role;
do $$
declare
  wh numeric;
  ho numeric;
begin
  select on_hand into wh from public.mi_stock_levels where part_id = current_setting('t.grease')::uuid and location_id = current_setting('t.wh')::uuid;
  select on_hand into ho from public.mi_stock_levels where part_id = current_setting('t.grease')::uuid and location_id = current_setting('t.hobbs')::uuid;
  if wh <> 14 then raise exception 'FAIL 71: warehouse % after shipping 6 of 20', wh; end if;
  if coalesce(ho, 0) <> 0 then raise exception 'FAIL 72: in-transit stock is already at Hobbs (%)', ho; end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_nm'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  l public.mi_transfer_lines;
  r jsonb;
begin
  select * into l from public.mi_transfer_lines where transfer_id = current_setting('t.xfer')::uuid;
  r := public.mi_receive_transfer(current_setting('t.xfer')::uuid, jsonb_build_array(jsonb_build_object('line_id', l.id, 'qty', 5)), 'One tube split open');
  if (r ->> 'variance')::numeric <> 1 then raise exception 'FAIL 73: short receipt %', r; end if;
  if (select on_hand from public.mi_stock_levels where part_id = current_setting('t.grease')::uuid and location_id = current_setting('t.hobbs')::uuid) <> 5 then raise exception 'FAIL 74: Hobbs didn''t get the stock'; end if;
  if (select variance_qty from public.mi_transfer_lines where id = l.id) <> -1 then raise exception 'FAIL 75: no variance record'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.mi_alerts where kind = 'transfer_variance' and message like 'Transfer #%') <> 1 then raise exception 'FAIL 76: no variance alert'; end if;
end $$;

-- ===== Criterion 6: blind counts =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.mi_create_count(current_setting('t.lbk')::uuid, 'part', current_setting('t.grease'), true);
  perform set_config('t.count', r ->> 'count_id', true);
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  d jsonb;
  line uuid;
begin
  if (select count(*) from public.mi_cycle_count_lines where count_id = current_setting('t.count')::uuid) <> 0 then raise exception 'FAIL 77: tech read count lines directly'; end if;
  d := public.mi_count_detail(current_setting('t.count')::uuid);
  if (d -> 'lines' -> 0 ->> 'expected_qty') is not null then raise exception 'FAIL 78: blind count showed expected: %', d; end if;
  line := (d -> 'lines' -> 0 ->> 'id')::uuid;
  perform public.mi_enter_count(line, 10);
  perform public.mi_submit_count(current_setting('t.count')::uuid);
  d := public.mi_count_detail(current_setting('t.count')::uuid);
  if (d -> 'lines' -> 0 ->> 'expected_qty') is not null then raise exception 'FAIL 79: tech saw expected after turning it in'; end if;
  -- 5 short at about $11.33 is over the $50 threshold: a tech can't post it.
  if public.mi_post_count(current_setting('t.count')::uuid) ->> 'status' <> 'in_review' then raise exception 'FAIL 80: a tech posted a large variance'; end if;
  if (select on_hand from public.mi_stock_levels where part_id = current_setting('t.grease')::uuid and location_id = current_setting('t.lbk')::uuid) <> 15 then raise exception 'FAIL 81: stock moved before approval'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  d jsonb;
  line uuid;
  r jsonb;
begin
  d := public.mi_count_detail(current_setting('t.count')::uuid);
  if (d -> 'lines' -> 0 ->> 'expected_qty')::numeric <> 15 then raise exception 'FAIL 82: manager can''t see expected: %', d; end if;
  line := (d -> 'lines' -> 0 ->> 'id')::uuid;
  -- No reason given: still held.
  if public.mi_post_count(current_setting('t.count')::uuid) ->> 'status' <> 'in_review' then raise exception 'FAIL 83: posted with no reason'; end if;
  r := public.mi_post_count(current_setting('t.count')::uuid, jsonb_build_array(jsonb_build_object('line_id', line, 'reason_code', 'theft_loss')));
  if r ->> 'status' <> 'posted' then raise exception 'FAIL 84: %', r; end if;
  if (select on_hand from public.mi_stock_levels where part_id = current_setting('t.grease')::uuid and location_id = current_setting('t.lbk')::uuid) <> 10 then raise exception 'FAIL 85: variance didn''t post'; end if;
  if (select count(*) from public.mi_inventory_transactions where count_id = current_setting('t.count')::uuid and type = 'count_adjust' and qty = -5 and reason_code = 'theft_loss') <> 1 then raise exception 'FAIL 86: no count_adjust row'; end if;
end $$;
reset role;

-- ===== Criterion 7: tools =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare t public.mi_tools;
begin
  t := public.mi_save_tool(jsonb_build_object('name', 'TEST torque wrench', 'home_location_id', current_setting('t.lbk'), 'cost', 300));
  perform set_config('t.tool', t.id::text, true);
  if t.status <> 'available' or t.custodian_location_id <> current_setting('t.lbk')::uuid then raise exception 'FAIL 87: new tool custody %', t; end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  r jsonb;
  t public.mi_tools;
begin
  r := public.mi_checkout_tool(current_setting('t.tool')::uuid, null, null, now() - interval '3 days', 'mobile', 'txn-tool-1');
  if r ->> 'status' <> 'checked_out' or r ->> 'custodian_user_id' <> current_setting('t.tech_lbk') then raise exception 'FAIL 88: checkout %', r; end if;
  r := public.mi_checkout_tool(current_setting('t.tool')::uuid, null, null, null, 'mobile', 'txn-tool-1');
  if not coalesce((r ->> 'deduped')::boolean, false) then raise exception 'FAIL 89: tool replay not deduped'; end if;
  perform public.mi_start_tool_transfer(current_setting('t.tool')::uuid, current_setting('t.mgr_lbk')::uuid);
  select * into t from public.mi_tools where id = current_setting('t.tool')::uuid;
  if t.custodian_user_id <> current_setting('t.tech_lbk')::uuid then raise exception 'FAIL 90: custody moved before acceptance'; end if;
  begin
    perform public.mi_accept_tool_transfer(current_setting('t.tool')::uuid);
    raise exception 'FAIL 91: the sender accepted their own hand-off';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.mi_accept_tool_transfer(current_setting('t.tool')::uuid);
  if r ->> 'custodian_user_id' <> current_setting('t.mgr_lbk') then raise exception 'FAIL 92: accept %', r; end if;
  perform public.mi_return_tool(current_setting('t.tool')::uuid, 'damaged', null, 'Dropped it');
  if (select status from public.mi_tools where id = current_setting('t.tool')::uuid) <> 'in_repair' then raise exception 'FAIL 93: a damaged return should go to repair'; end if;
  if (select count(*) from public.mi_tool_checkouts where tool_id = current_setting('t.tool')::uuid) <> 5 then raise exception 'FAIL 94: custody chain has % rows', (select count(*) from public.mi_tool_checkouts where tool_id = current_setting('t.tool')::uuid); end if;
end $$;
reset role;

-- Overdue: the custodian first, the manager after 24 hours. Nobody can rewrite the chain.
do $$
declare
  r jsonb;
  a public.mi_alerts;
  who uuid[];
begin
  update public.mi_tools set status = 'checked_out', custodian_user_id = current_setting('t.tech_lbk')::uuid, custodian_location_id = null, due_at = now() - interval '2 days'
  where id = current_setting('t.tool')::uuid;
  r := public.mi__nightly(current_setting('t.acct')::uuid);
  if (r ->> 'overdue_tools')::int < 1 then raise exception 'FAIL 95: overdue tool missed %', r; end if;
  select * into a from public.mi_alerts where tool_id = current_setting('t.tool')::uuid and kind = 'tool_overdue';
  select array_agg(user_id) into who from public.mi__alert_recipients(a.id);
  if who <> array[current_setting('t.tech_lbk')::uuid] then raise exception 'FAIL 96: overdue went to %', who; end if;
  select * into a from public.mi_alerts where tool_id = current_setting('t.tool')::uuid and kind = 'tool_overdue_manager';
  select array_agg(user_id) into who from public.mi__alert_recipients(a.id);
  if not current_setting('t.mgr_lbk')::uuid = any (who) then raise exception 'FAIL 97: the manager wasn''t told after 24 hours'; end if;
  begin
    delete from public.mi_tool_checkouts where tool_id = current_setting('t.tool')::uuid;
    raise exception 'FAIL 98: the custody chain was deleted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin
    update public.mi_inventory_transactions set qty = 0 where part_id = current_setting('t.grease')::uuid;
    raise exception 'FAIL 99: the ledger was edited';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;

-- ===== Roles, reports =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.director'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  d jsonb;
begin
  begin
    perform public.mi_set_member(current_setting('t.tech_lbk')::uuid, 'admin');
    raise exception 'FAIL 100: the director changed roles';
  exception when insufficient_privilege then null; end;
  d := public.mi_dashboard();
  if (d ->> 'inventory_value')::numeric <= 0 then raise exception 'FAIL 101: dashboard value %', d ->> 'inventory_value'; end if;
  if jsonb_array_length(d -> 'value_by_site') = 0 or jsonb_array_length(d -> 'value_by_category') = 0 then raise exception 'FAIL 102: dashboard is empty'; end if;
  if (d -> 'count_accuracy' ->> 'lines')::int < 1 then raise exception 'FAIL 103: count accuracy is empty'; end if;
  if (d ->> 'parts_cost')::numeric <= 0 then raise exception 'FAIL 104: parts cost %', d ->> 'parts_cost'; end if;
  if (d -> 'fill_rate' ->> 'lines')::int < 1 then raise exception 'FAIL 105: fill rate is empty'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mi_dashboard();
  raise exception 'FAIL 106: a tech opened the dashboard';
exception when insufficient_privilege then null; end $$;
reset role;

-- ===== Criterion 13: CSV import =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.kevan'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  rows_in jsonb;
  bad jsonb;
  r jsonb;
  started timestamptz := clock_timestamp();
  before_parts int := (select count(*) from public.parts);
begin
  select jsonb_agg(jsonb_build_object('sku', 'IMP-' || (n / 2), 'name', 'TEST imported part ' || (n / 2), 'category', 'Filters', 'uom', 'ea', 'is_critical', 'no',
    'location', case when n % 2 = 0 then 'TEST Lubbock 1 stockroom' else 'TEST Hobbs Lube cabinet' end, 'bin', 'IMP-' || (n % 20), 'on_hand', '5', 'min_qty', '1', 'max_qty', '9', 'unit_cost', '3.50', 'vendor', 'Grainger'))
  into rows_in from generate_series(0, 499) n;

  -- Preview writes nothing, and counts 250 new parts and 250 second rows for them.
  r := public.mi_import_parts(rows_in, false);
  if (r ->> 'created')::int <> 250 or (r ->> 'updated')::int <> 250 or (r ->> 'errors')::int <> 0 then raise exception 'FAIL 107: preview %', r - 'rows'; end if;
  if (r ->> 'committed')::boolean then raise exception 'FAIL 108: a preview committed'; end if;
  if (select count(*) from public.parts) <> before_parts then raise exception 'FAIL 109: a preview wrote parts'; end if;

  -- One bad row means nothing lands.
  bad := rows_in || jsonb_build_array(jsonb_build_object('sku', 'IMP-BAD', 'name', 'Bad', 'location', 'Nowhere'));
  r := public.mi_import_parts(bad, true);
  if (r ->> 'errors')::int <> 1 or (r ->> 'committed')::boolean then raise exception 'FAIL 110: %', r - 'rows'; end if;
  if (r -> 'rows' -> 500 ->> 'status') <> 'error' then raise exception 'FAIL 111: the bad row wasn''t flagged'; end if;
  if (select count(*) from public.parts) <> before_parts then raise exception 'FAIL 112: a failed import left parts behind'; end if;

  r := public.mi_import_parts(rows_in, true);
  if not (r ->> 'committed')::boolean or (r ->> 'created')::int <> 250 then raise exception 'FAIL 113: commit %', r - 'rows'; end if;
  if (select count(*) from public.parts) <> before_parts + 250 then raise exception 'FAIL 114: commit part count'; end if;
  if (select count(*) from public.mi_inventory_transactions where notes = 'CSV import') <> 500 then raise exception 'FAIL 115: import ledger rows'; end if;
  -- Run again: nothing new, no extra stock movements.
  r := public.mi_import_parts(rows_in, true);
  if (r ->> 'created')::int <> 0 or (select count(*) from public.mi_inventory_transactions where notes = 'CSV import') <> 500 then raise exception 'FAIL 116: re-import wasn''t a no-op'; end if;
  perform set_config('t.import_ms', (extract(epoch from clock_timestamp() - started) * 1000)::int::text, true);
end $$;
reset role;

do $$ begin
  raise exception 'ALL PASS (import previews + commits of 500 rows took % ms in total)', current_setting('t.import_ms');
end $$;

rollback;
