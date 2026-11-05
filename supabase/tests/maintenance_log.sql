-- Maintenance Log: schedules, the log, and who can do what.
--
-- Same rules as maintenance_inventory.sql: one transaction that always rolls back, a
-- failure raises "FAIL n: ...", a clean run ends by raising "ALL PASS". Impersonates
-- users the way PostgREST does, on real Mighty Wash sites and real car counts.
--
--   sql.sh supabase/tests/maintenance_log.sql

begin;

select set_config('t.acct', '54f3e299-1f61-4ed2-9921-3d02160b72e6', true);
select set_config('t.mw01', (select id::text from public.locations where account_id = current_setting('t.acct')::uuid and name = 'MW01'), true);
select set_config('t.mw19', (select id::text from public.locations where account_id = current_setting('t.acct')::uuid and name = 'MW19'), true);
select set_config('t.kevan', (select id::text from public.users where lower(email) = 'kevan@washlyfe.com'), true);
select set_config('t.today', public.mi__today(current_setting('t.acct')::uuid)::text, true);

-- Throwaway people.
do $$
declare
  a uuid := current_setting('t.acct')::uuid;
  u record;
begin
  for u in select * from (values
    ('tech_lbk', 'site_tech', array[current_setting('t.mw01')::uuid]),
    ('mgr_lbk', 'site_manager', array[current_setting('t.mw01')::uuid]),
    ('tech_nm', 'site_tech', array[current_setting('t.mw19')::uuid])) v(k, r, sites)
  loop
    perform set_config('t.' || u.k, gen_random_uuid()::text, true);
    insert into auth.users (id, email, instance_id, aud, role)
    values (current_setting('t.' || u.k)::uuid, u.k || '@ml-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.users (id, account_id, location_ids, role, name, email)
    values (current_setting('t.' || u.k)::uuid, a, u.sites, 'manager', 'Test ' || u.k, u.k || '@ml-test.invalid');
    insert into public.mi_members (user_id, account_id, role, site_ids)
    values (current_setting('t.' || u.k)::uuid, a, u.r, u.sites);
  end loop;
  perform set_config('t.outsider', gen_random_uuid()::text, true);
  insert into auth.users (id, email, instance_id, aud, role)
  values (current_setting('t.outsider')::uuid, 'outsider@ml-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  insert into public.users (id, account_id, location_ids, role, name, email)
  values (current_setting('t.outsider')::uuid, a, '{}', 'owner', 'Test outsider', 'outsider@ml-test.invalid');
end $$;

-- Stock, parts and machines.
do $$
declare
  a uuid := current_setting('t.acct')::uuid;
  x uuid;
begin
  insert into public.mi_stock_locations (account_id, site_id, name, type) values (a, current_setting('t.mw01')::uuid, 'TEST ML stockroom', 'stockroom') returning id into x;
  perform set_config('t.lbk', x::text, true);
  insert into public.parts (account_id, name, sku, unit_cost) values (a, 'TEST ML Grease', 'TEST-ML-GREASE', 6) returning id into x;
  perform set_config('t.grease', x::text, true);
  insert into public.parts (account_id, name, sku, unit_cost) values (a, 'TEST ML Cloth', 'TEST-ML-CLOTH', 120) returning id into x;
  perform set_config('t.cloth', x::text, true);
  insert into public.mi_part_vendors (account_id, part_id, vendor_id, price, pack_qty, preferred)
  select a, current_setting('t.grease')::uuid, v.id, 6, 1, true from public.vendors v where v.account_id = a and v.name = 'Grainger';
  perform public.mi__post(a, current_setting('t.grease')::uuid, current_setting('t.lbk')::uuid, 'adjust', 10, 6, p_reason => 'test', p_blend_cost => true);
  perform public.mi__post(a, current_setting('t.cloth')::uuid, current_setting('t.lbk')::uuid, 'adjust', 1, 120, p_reason => 'test', p_blend_cost => true);
  insert into public.equipment (account_id, location_id, name, asset_number, type, status)
  values (a, current_setting('t.mw01')::uuid, 'TEST ML Conveyor', 990101, 'TEST ML Conveyor', 'online') returning id into x;
  perform set_config('t.conv01', x::text, true);
  insert into public.equipment (account_id, location_id, name, asset_number, type, status)
  values (a, current_setting('t.mw19')::uuid, 'TEST ML Conveyor 19', 990102, 'TEST ML Conveyor', 'online') returning id into x;
  perform set_config('t.conv19', x::text, true);
  perform set_config('t.cars10', public.mi__site_cars(a, current_setting('t.mw01')::uuid, current_setting('t.today')::date - 10, current_setting('t.today')::date)::text, true);
  if current_setting('t.cars10')::numeric <= 0 then raise exception 'FAIL 0: no car counts at MW01 to test with'; end if;
end $$;

-- A tech can't set up schedules.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.mi_save_schedule(jsonb_build_object('title', 'x', 'every_n', 1, 'every_unit', 'weeks', 'site_ids', jsonb_build_array(current_setting('t.mw01'))));
    raise exception 'FAIL 1: a tech created a schedule';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
reset role;

-- A site manager sets one up for their site, with parts; two sites is one too many.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  r jsonb;
begin
  r := public.mi_save_schedule(jsonb_build_object('title', 'TEST Grease conveyor', 'task_type', 'lubricate', 'every_n', 1, 'every_unit', 'weeks',
    'site_ids', jsonb_build_array(current_setting('t.mw01')), 'asset_id', current_setting('t.conv01'),
    'next_due_date', (current_setting('t.today')::date - 2)::text,
    'parts', jsonb_build_array(jsonb_build_object('part_id', current_setting('t.grease'), 'qty', 2))));
  if (r ->> 'created')::int <> 1 then raise exception 'FAIL 2: %', r; end if;
  perform set_config('t.s_grease', r -> 'ids' ->> 0, true);
  begin
    perform public.mi_save_schedule(jsonb_build_object('title', 'TEST two', 'every_n', 1, 'every_unit', 'months',
      'site_ids', jsonb_build_array(current_setting('t.mw01'), current_setting('t.mw19'))));
    raise exception 'FAIL 3: a one-site manager set up a schedule at another site';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.mi_save_schedule(jsonb_build_object('title', 'TEST no interval', 'site_ids', jsonb_build_array(current_setting('t.mw01'))));
    raise exception 'FAIL 4: a schedule saved with no interval';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;

  r := public.mi_schedule_detail(current_setting('t.s_grease')::uuid);
  if r -> 'schedule' ->> 'status' <> 'overdue' or (r -> 'schedule' ->> 'days_left')::int <> -2 then raise exception 'FAIL 5: %', r -> 'schedule'; end if;
  if (r -> 'schedule' ->> 'parts_ready')::boolean is not true then raise exception 'FAIL 6: parts not ready with 10 on hand'; end if;
  if not exists (select 1 from jsonb_array_elements(public.mi_schedules_list(p_status => 'attention')) x where x ->> 'id' = current_setting('t.s_grease')) then
    raise exception 'FAIL 7: overdue schedule missing from the due list';
  end if;
end $$;
reset role;

-- An admin sets one up for two sites: the other site gets its own machine of that type.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.kevan'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  r jsonb;
begin
  r := public.mi_save_schedule(jsonb_build_object('title', 'TEST Inspect conveyor', 'task_type', 'inspect', 'every_n', 30, 'every_unit', 'days',
    'site_ids', jsonb_build_array(current_setting('t.mw01'), current_setting('t.mw19')), 'asset_id', current_setting('t.conv01')));
  if (r ->> 'created')::int <> 2 or (r ->> 'matched_assets')::int <> 1 then raise exception 'FAIL 8: %', r; end if;
  perform set_config('t.s_insp01', (select id::text from public.mi_schedules where title = 'TEST Inspect conveyor' and site_id = current_setting('t.mw01')::uuid), true);
  if (select asset_id from public.mi_schedules where title = 'TEST Inspect conveyor' and site_id = current_setting('t.mw19')::uuid) <> current_setting('t.conv19')::uuid then
    raise exception 'FAIL 9: MW19 didn''t get its own conveyor';
  end if;
  if public.mi_schedule_detail(current_setting('t.s_insp01')::uuid) -> 'schedule' ->> 'status' <> 'ok' then raise exception 'FAIL 10: new 30-day schedule isn''t ok'; end if;
end $$;
reset role;

-- A tech at another site sees none of it and can't log against it.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_nm'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if exists (select 1 from jsonb_array_elements(public.mi_schedules_list()) x where x ->> 'site_id' = current_setting('t.mw01')) then raise exception 'FAIL 11: sees MW01 schedules'; end if;
  if exists (select 1 from public.mi_schedules where id = current_setting('t.s_grease')::uuid) then raise exception 'FAIL 12: reads MW01 schedule row'; end if;
  begin
    perform public.mi_log_add(jsonb_build_object('schedule_id', current_setting('t.s_grease')));
    raise exception 'FAIL 13: logged against another site''s schedule';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
reset role;

-- The tech does the overdue job with two tubes of grease.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  r jsonb;
  r2 jsonb;
  n integer;
  s public.mi_schedules;
  g public.mi_log_entries;
  oh numeric;
  feed jsonb;
begin
  r := public.mi_log_add(jsonb_build_object('schedule_id', current_setting('t.s_grease'), 'notes', 'Greased both sides',
    'parts', jsonb_build_array(jsonb_build_object('part_id', current_setting('t.grease'), 'location_id', current_setting('t.lbk'), 'qty', 2))), 'mobile', 'txn-ml-1');
  if (r ->> 'ok') is distinct from 'true' then raise exception 'FAIL 14: %', r; end if;
  perform set_config('t.e1', r ->> 'id', true);
  r2 := public.mi_log_add(jsonb_build_object('schedule_id', current_setting('t.s_grease'),
    'parts', jsonb_build_array(jsonb_build_object('part_id', current_setting('t.grease'), 'location_id', current_setting('t.lbk'), 'qty', 2))), 'mobile', 'txn-ml-1');
  if (r2 ->> 'deduped') is distinct from 'true' then raise exception 'FAIL 15: replay wasn''t deduped: %', r2; end if;
  select on_hand into oh from public.mi_stock_levels where part_id = current_setting('t.grease')::uuid and location_id = current_setting('t.lbk')::uuid;
  if oh <> 8 then raise exception 'FAIL 16: % on hand, expected 8', oh; end if;
  select count(*) into n from public.mi_log_entries where schedule_id = current_setting('t.s_grease')::uuid;
  if n <> 1 then raise exception 'FAIL 17: % entries', n; end if;
  select * into s from public.mi_schedules where id = current_setting('t.s_grease')::uuid;
  if s.last_done_at is null or s.next_due_date <> current_setting('t.today')::date + 7 then raise exception 'FAIL 18: last % next %', s.last_done_at, s.next_due_date; end if;
  select * into g from public.mi_log_entries where id = current_setting('t.e1')::uuid;
  if g.on_time is distinct from false or g.due_date <> current_setting('t.today')::date - 2 or g.entry_type <> 'lubrication' or g.asset_id <> current_setting('t.conv01')::uuid then
    raise exception 'FAIL 19: on_time % due % type %', g.on_time, g.due_date, g.entry_type;
  end if;
  select count(*) into n from public.mi_inventory_transactions m join public.mi_log_entry_parts lp on lp.ledger_id = m.id
  where lp.entry_id = g.id and m.type = 'issue' and m.qty = -2 and m.asset_id = current_setting('t.conv01')::uuid;
  if n <> 1 then raise exception 'FAIL 20: ledger row for the entry''s parts: %', n; end if;

  -- Parts used off the shelf with no entry show on their own line; the entry's don't.
  r := public.mi_issue_part(current_setting('t.grease')::uuid, current_setting('t.lbk')::uuid, 1, null, current_setting('t.conv01')::uuid, 'mobile', 'txn-ml-adhoc');
  perform set_config('t.adhoc_ledger', r ->> 'ledger_id', true);
  feed := public.mi_log_feed(jsonb_build_object('site_id', current_setting('t.mw01'), 'kinds', jsonb_build_array('log', 'parts'), 'limit', 500));
  if not exists (select 1 from jsonb_array_elements(feed -> 'rows') x where x ->> 'kind' = 'log' and x ->> 'id' = current_setting('t.e1') and (x ->> 'parts_cost')::numeric = 12) then
    raise exception 'FAIL 21: entry missing from the feed or wrong cost';
  end if;
  if not exists (select 1 from jsonb_array_elements(feed -> 'rows') x where x ->> 'kind' = 'parts' and x ->> 'id' = current_setting('t.adhoc_ledger')) then
    raise exception 'FAIL 22: off-the-shelf use missing from the feed';
  end if;
  if exists (select 1 from jsonb_array_elements(feed -> 'rows') x join public.mi_log_entry_parts lp on lp.ledger_id = (x ->> 'id')::uuid where x ->> 'kind' = 'parts') then
    raise exception 'FAIL 23: the entry''s parts show twice';
  end if;
end $$;
reset role;

do $$
begin
  if (select last_serviced_at from public.equipment where id = current_setting('t.conv01')::uuid) <> current_setting('t.today')::date then
    raise exception 'FAIL 24: asset last serviced not set';
  end if;
end $$;

-- By cars washed: just past the count is due; half way with no warning window is ok.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  r jsonb;
  d jsonb;
  cars numeric := current_setting('t.cars10')::numeric;
begin
  r := public.mi_save_schedule(jsonb_build_object('title', 'TEST Replace wrap cloth', 'task_type', 'replace', 'every_cars', ceil(cars / 1.05),
    'start_date', (current_setting('t.today')::date - 10)::text, 'site_ids', jsonb_build_array(current_setting('t.mw01'))));
  perform set_config('t.s_car', r -> 'ids' ->> 0, true);
  d := public.mi_schedule_detail(current_setting('t.s_car')::uuid) -> 'schedule';
  if d ->> 'status' <> 'due' then raise exception 'FAIL 25: car schedule is % (% of %)', d ->> 'status', d ->> 'cars_since', d ->> 'every_cars'; end if;
  if (d ->> 'cars_pct')::numeric < 100 or (d ->> 'cars_pct')::numeric >= 110 then raise exception 'FAIL 26: % percent', d ->> 'cars_pct'; end if;

  r := public.mi_save_schedule(jsonb_build_object('title', 'TEST Top brush cloth', 'task_type', 'replace', 'every_cars', ceil(cars * 2), 'soon_days', 0,
    'start_date', (current_setting('t.today')::date - 10)::text, 'site_ids', jsonb_build_array(current_setting('t.mw01'))));
  d := public.mi_schedule_detail((r -> 'ids' ->> 0)::uuid) -> 'schedule';
  if d ->> 'status' <> 'ok' or d ->> 'cars_due_on' is null then raise exception 'FAIL 27: %', d; end if;
end $$;
reset role;

-- Skipping takes a manager. Voiding the skip puts the schedule back.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.mi_log_add(jsonb_build_object('schedule_id', current_setting('t.s_car'), 'result', 'skipped'));
    raise exception 'FAIL 28: a tech skipped scheduled maintenance';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  r jsonb;
begin
  r := public.mi_log_add(jsonb_build_object('schedule_id', current_setting('t.s_car'), 'result', 'skipped', 'notes', 'Cloth swapped last week'));
  perform set_config('t.e_skip', r ->> 'id', true);
  if (select on_time from public.mi_log_entries where id = (r ->> 'id')::uuid) is not null then raise exception 'FAIL 29: a skip counted for on-time'; end if;
  if public.mi_schedule_detail(current_setting('t.s_car')::uuid) -> 'schedule' ->> 'status' <> 'ok' then raise exception 'FAIL 30: skip didn''t restart the count'; end if;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.mi_log_void(current_setting('t.e_skip')::uuid, 'Not mine');
    raise exception 'FAIL 31: a tech voided a manager''s entry';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  perform public.mi_log_void(current_setting('t.e_skip')::uuid, 'Wrong schedule');
  if (select last_done_at from public.mi_schedules where id = current_setting('t.s_car')::uuid) is not null then raise exception 'FAIL 32: void didn''t restore last done'; end if;
  if public.mi_schedule_detail(current_setting('t.s_car')::uuid) -> 'schedule' ->> 'status' <> 'due' then raise exception 'FAIL 33: void didn''t restore the status'; end if;
  if jsonb_array_length(public.mi_log_feed(jsonb_build_object('schedule_id', current_setting('t.s_car'))) -> 'rows') <> 0 then
    raise exception 'FAIL 34: voided entry still in the feed';
  end if;
  if not exists (select 1 from jsonb_array_elements(public.mi_log_feed(jsonb_build_object('schedule_id', current_setting('t.s_car'), 'include_voided', true)) -> 'rows') x
                 where x ->> 'id' = current_setting('t.e_skip') and (x ->> 'voided')::boolean) then
    raise exception 'FAIL 34b: voided entry missing when asked for';
  end if;
end $$;
reset role;

-- A schedule that opens its own work order, assigned to the tech.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  r jsonb;
begin
  r := public.mi_save_schedule(jsonb_build_object('title', 'TEST Change filter', 'task_type', 'replace', 'every_n', 3, 'every_unit', 'months',
    'site_ids', jsonb_build_array(current_setting('t.mw01')), 'asset_id', current_setting('t.conv01'), 'auto_work_order', true,
    'next_due_date', (current_setting('t.today')::date + 3)::text, 'assigned_user_id', current_setting('t.tech_lbk'),
    'parts', jsonb_build_array(jsonb_build_object('part_id', current_setting('t.cloth'), 'qty', 1))));
  perform set_config('t.s_auto', r -> 'ids' ->> 0, true);
end $$;
reset role;

select set_config('request.jwt.claims', '{}', true);
do $$
declare
  a uuid := current_setting('t.acct')::uuid;
  w public.work_orders;
  n integer;
  al public.mi_alerts;
begin
  perform public.mi__schedules_nightly(a);
  select count(*) into n from public.work_orders where mi_schedule_id = current_setting('t.s_auto')::uuid and status = 'open';
  if n <> 1 then raise exception 'FAIL 35: % work orders for the coming-up schedule', n; end if;
  select * into w from public.work_orders where mi_schedule_id = current_setting('t.s_auto')::uuid;
  perform set_config('t.auto_wo', w.id::text, true);
  if w.work_type <> 'preventive' or w.equipment_id <> current_setting('t.conv01')::uuid then raise exception 'FAIL 36: %', to_jsonb(w); end if;
  if not exists (select 1 from public.work_order_parts where work_order_id = w.id and catalog_part_id = current_setting('t.cloth')::uuid and qty_planned = 0) then
    raise exception 'FAIL 37: schedule parts not suggested';
  end if;
  if not exists (select 1 from public.work_order_assignees where work_order_id = w.id and user_id = current_setting('t.tech_lbk')::uuid) then
    raise exception 'FAIL 38: not assigned';
  end if;
  select count(*) into n from public.mi_alerts where account_id = a and kind = 'maintenance_due' and (detail ->> 'schedule_id') = current_setting('t.s_car');
  if n <> 1 then raise exception 'FAIL 39: % reminders for the due car schedule', n; end if;
  select * into al from public.mi_alerts where account_id = a and kind = 'maintenance_due' and (detail ->> 'schedule_id') = current_setting('t.s_car');
  if al.status <> 'digest' then raise exception 'FAIL 40: reminder is %', al.status; end if;
  if not exists (select 1 from public.mi__alert_recipients(al.id) x where x.user_id = current_setting('t.mgr_lbk')::uuid) then
    raise exception 'FAIL 41: site manager doesn''t get the reminder';
  end if;

  perform public.mi__schedules_nightly(a);
  select count(*) into n from public.work_orders where mi_schedule_id = current_setting('t.s_auto')::uuid;
  if n <> 1 then raise exception 'FAIL 42: second run made another work order'; end if;
  select count(*) into n from public.mi_alerts where account_id = a and kind = 'maintenance_due' and (detail ->> 'schedule_id') = current_setting('t.s_car');
  if n <> 1 then raise exception 'FAIL 43: second run raised another reminder'; end if;
end $$;

-- Closing that work order anywhere logs it and moves the schedule on.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_lbk'), 'role', 'authenticated')::text, true);
update public.work_orders set status = 'done' where id = current_setting('t.auto_wo')::uuid;
do $$
declare
  g public.mi_log_entries;
  s public.mi_schedules;
begin
  select * into g from public.mi_log_entries where work_order_id = current_setting('t.auto_wo')::uuid;
  if not found or g.source <> 'work_order' or g.schedule_id <> current_setting('t.s_auto')::uuid or g.performed_by <> current_setting('t.tech_lbk')::uuid then
    raise exception 'FAIL 44: %', to_jsonb(g);
  end if;
  if g.on_time is distinct from true then raise exception 'FAIL 45: early job not on time'; end if;
  select * into s from public.mi_schedules where id = current_setting('t.s_auto')::uuid;
  if s.next_due_date <> (current_setting('t.today')::date + interval '3 months')::date then raise exception 'FAIL 46: next due %', s.next_due_date; end if;
end $$;

-- A schedule's open work order is closed by logging the job, once.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  r jsonb;
  r2 jsonb;
begin
  r := public.mi_schedule_work_order(current_setting('t.s_grease')::uuid);
  r2 := public.mi_schedule_work_order(current_setting('t.s_grease')::uuid);
  if (r ->> 'already_open')::boolean or not (r2 ->> 'already_open')::boolean or r ->> 'work_order_id' <> r2 ->> 'work_order_id' then raise exception 'FAIL 47: % %', r, r2; end if;
  perform set_config('t.grease_wo', r ->> 'work_order_id', true);
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  r jsonb;
begin
  r := public.mi_log_add(jsonb_build_object('schedule_id', current_setting('t.s_grease'),
    'parts', jsonb_build_array(jsonb_build_object('part_id', current_setting('t.grease'), 'location_id', current_setting('t.lbk'), 'qty', 1))), 'mobile', 'txn-ml-2');
  if r ->> 'work_order_id' is distinct from current_setting('t.grease_wo') then raise exception 'FAIL 48: didn''t take the open work order: %', r; end if;
  perform set_config('t.e2', r ->> 'id', true);
  if (public.mi_log_entry((r ->> 'id')::uuid) ->> 'parts_cost')::numeric <> 6 then raise exception 'FAIL 49: %', public.mi_log_entry((r ->> 'id')::uuid); end if;
end $$;
reset role;

do $$
declare
  n integer;
begin
  if (select status from public.work_orders where id = current_setting('t.grease_wo')::uuid) <> 'done' then raise exception 'FAIL 50: work order still open'; end if;
  select count(*) into n from public.mi_log_entries where work_order_id = current_setting('t.grease_wo')::uuid;
  if n <> 1 then raise exception 'FAIL 51: % entries for the work order', n; end if;
  if (select qty_issued from public.work_order_parts where work_order_id = current_setting('t.grease_wo')::uuid and catalog_part_id = current_setting('t.grease')::uuid) <> 1 then
    raise exception 'FAIL 52: parts not on the work order';
  end if;
end $$;

-- A failed repair: follow-up work order, asset down, labor and downtime.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  r jsonb;
begin
  r := public.mi_log_add(jsonb_build_object('site_id', current_setting('t.mw01'), 'asset_id', current_setting('t.conv01'), 'entry_type', 'repair',
    'title', 'TEST Chain jumped', 'result', 'failed', 'follow_up', true, 'asset_status', 'offline_unplanned', 'labor_minutes', 45, 'downtime_minutes', 30));
  if r -> 'follow_up' ->> 'number' is null then raise exception 'FAIL 53: no follow-up: %', r; end if;
  perform set_config('t.e_fail', r ->> 'id', true);
  perform set_config('t.fu_wo', r -> 'follow_up' ->> 'id', true);
  begin
    perform public.mi_log_add(jsonb_build_object('site_id', current_setting('t.mw01'), 'entry_type', 'cleaning', 'title', 'TEST bad photo', 'photos', jsonb_build_array('someone-else/x.jpg')));
    raise exception 'FAIL 54: took a photo path outside the account';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  r := public.mi_log_add(jsonb_build_object('site_id', current_setting('t.mw01'), 'entry_type', 'cleaning', 'title', 'TEST Cleaned pit',
    'photos', jsonb_build_array(current_setting('t.acct') || '/log/' || gen_random_uuid() || '-pit.jpg')));
  if (select file_name from public.mi_attachments where entity_type = 'log_entry' and entity_id = (r ->> 'id')::uuid) is distinct from 'pit.jpg' then
    raise exception 'FAIL 55: photo not attached';
  end if;
  perform public.mi_log_update(current_setting('t.e_fail')::uuid, jsonb_build_object('notes', 'Replaced two links', 'labor_minutes', 60));
  if (select labor_minutes from public.mi_log_entries where id = current_setting('t.e_fail')::uuid) <> 60 then raise exception 'FAIL 56: edit didn''t save'; end if;
end $$;
reset role;

do $$
begin
  if (select priority || '|' || title from public.work_orders where id = current_setting('t.fu_wo')::uuid) <> 'high|Follow up: TEST Chain jumped' then raise exception 'FAIL 57'; end if;
  if (select status from public.equipment where id = current_setting('t.conv01')::uuid) <> 'offline_unplanned' then raise exception 'FAIL 58: asset status not set'; end if;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_nm'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.mi_log_update(current_setting('t.e_fail')::uuid, jsonb_build_object('notes', 'x'));
    raise exception 'FAIL 59: a tech at another site edited the entry';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
reset role;

-- The follow-up closed as a plain work order shows as one; the one an entry closed doesn't.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_lbk'), 'role', 'authenticated')::text, true);
update public.work_orders set status = 'done' where id = current_setting('t.fu_wo')::uuid;
set local role authenticated;
do $$
declare
  feed jsonb := public.mi_log_feed(jsonb_build_object('site_id', current_setting('t.mw01'), 'limit', 1000));
begin
  if not exists (select 1 from jsonb_array_elements(feed -> 'rows') x where x ->> 'kind' = 'work_order' and x ->> 'id' = current_setting('t.fu_wo')) then
    raise exception 'FAIL 60: closed work order missing from the feed';
  end if;
  if exists (select 1 from jsonb_array_elements(feed -> 'rows') x where x ->> 'kind' = 'work_order' and x ->> 'id' = current_setting('t.grease_wo')) then
    raise exception 'FAIL 61: work order shows twice';
  end if;
  feed := public.mi_log_feed(jsonb_build_object('site_id', current_setting('t.mw01'), 'limit', 1));
  if jsonb_array_length(feed -> 'rows') <> 1 or not (feed ->> 'more')::boolean then raise exception 'FAIL 62: paging %', feed; end if;
  begin
    perform public.mi_log_report();
    raise exception 'FAIL 63: a tech ran the report';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.mi_archive_schedule(current_setting('t.s_grease')::uuid);
    raise exception 'FAIL 64: a tech removed a schedule';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
reset role;

-- Reports, forecast and counts for the manager.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  r jsonb;
  f jsonb;
  g jsonb;
  avail numeric;
begin
  r := public.mi_log_report(null, null, current_setting('t.mw01')::uuid);
  if (r ->> 'scheduled_done')::int < 3 then raise exception 'FAIL 65: % scheduled done', r ->> 'scheduled_done'; end if;
  -- The test's own three: late, on time, on time. Demo entries at MW01 count too.
  -- (Everything in one transaction shares one now(), so check each by id.)
  if (select on_time from public.mi_log_entries where id = current_setting('t.e1')::uuid) is distinct from false
     or (select on_time from public.mi_log_entries where id = current_setting('t.e2')::uuid) is distinct from true
     or (select on_time from public.mi_log_entries where work_order_id = current_setting('t.auto_wo')::uuid) is distinct from true then
    raise exception 'FAIL 66: on-time flags wrong';
  end if;
  if (r ->> 'on_time_pct')::numeric is distinct from (
      select round(100.0 * count(*) filter (where on_time) / nullif(count(*) filter (where on_time is not null), 0), 1) from public.mi_log_entries
      where site_id = current_setting('t.mw01')::uuid and voided_at is null and performed_at >= (current_setting('t.today')::date - 89)::timestamp at time zone 'America/Chicago') then
    raise exception 'FAIL 66b: on time %', r ->> 'on_time_pct';
  end if;
  if (r ->> 'labor_hours')::numeric < 1 or (r ->> 'downtime_hours')::numeric < 0.5 then raise exception 'FAIL 67: labor % downtime %', r ->> 'labor_hours', r ->> 'downtime_hours'; end if;
  if (r ->> 'repairs')::int < 1 or not exists (select 1 from jsonb_array_elements(r -> 'by_site') x where x ->> 'site_name' = 'MW01') then raise exception 'FAIL 68: %', r; end if;

  -- Grease every week, next due in 7 days: 4 jobs in 30 days, 2 tubes each.
  f := public.mi_parts_forecast(30, current_setting('t.mw01')::uuid);
  select x into g from jsonb_array_elements(f) x where x ->> 'part_id' = current_setting('t.grease');
  select sum(available) into avail from public.mi_stock_levels s join public.mi_stock_locations l on l.id = s.location_id
  where s.part_id = current_setting('t.grease')::uuid and l.site_id = current_setting('t.mw01')::uuid;
  if (g ->> 'need')::numeric <> 8 then raise exception 'FAIL 69: need %', g; end if;
  if (g ->> 'short')::numeric <> greatest(8 - avail, 0) or g ->> 'vendor_name' <> 'Grainger' then raise exception 'FAIL 70: % with % free', g, avail; end if;

  r := public.mi_log_counts();
  if not (r ? 'overdue' and r ? 'due' and r ? 'soon') or (r ->> 'due')::int < 1 then raise exception 'FAIL 71: %', r; end if;

  perform public.mi_archive_schedule(current_setting('t.s_insp01')::uuid);
  if exists (select 1 from jsonb_array_elements(public.mi_schedules_list()) x where x ->> 'id' = current_setting('t.s_insp01')) then raise exception 'FAIL 72: removed schedule still listed'; end if;
end $$;
reset role;

-- Someone with no role sees nothing.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.outsider'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.mi_log_feed('{}'::jsonb);
    raise exception 'FAIL 73: outsider read the log';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  if exists (select 1 from public.mi_log_entries) or exists (select 1 from public.mi_schedules) or exists (select 1 from public.mi_log_entry_parts) then
    raise exception 'FAIL 74: outsider reads log tables';
  end if;
end $$;
reset role;

-- Removing the demo takes demo schedules with their entries and work orders, and nothing else.
select set_config('request.jwt.claims', '{}', true);
do $$
declare
  a uuid := current_setting('t.acct')::uuid;
  x uuid;
  w public.work_orders;
begin
  insert into public.mi_schedules (account_id, site_id, title, every_n, every_unit, next_due_date, is_sample)
  values (a, current_setting('t.mw01')::uuid, 'TEST sample schedule', 1, 'weeks', current_setting('t.today')::date, true) returning id into x;
  perform set_config('t.s_sample', x::text, true);
  w := public.mi__schedule_work_order(x, null, 'test');
  perform set_config('t.sample_wo', w.id::text, true);
  insert into public.mi_log_entries (account_id, site_id, schedule_id, entry_type, title, is_sample)
  values (a, current_setting('t.mw01')::uuid, x, 'inspection', 'TEST sample entry', true);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.kevan'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  r jsonb := public.mi_remove_sample_data();
begin
  if (r ->> 'schedules')::int < 1 then raise exception 'FAIL 75: %', r; end if;
end $$;
reset role;

do $$
begin
  if exists (select 1 from public.mi_schedules where id = current_setting('t.s_sample')::uuid)
     or exists (select 1 from public.work_orders where id = current_setting('t.sample_wo')::uuid)
     or exists (select 1 from public.mi_log_entries where title = 'TEST sample entry') then
    raise exception 'FAIL 76: demo schedule, work order or entry left behind';
  end if;
  if not exists (select 1 from public.mi_schedules where id = current_setting('t.s_grease')::uuid)
     or not exists (select 1 from public.mi_log_entries where id = current_setting('t.e1')::uuid) then
    raise exception 'FAIL 77: real schedule or entry removed';
  end if;
end $$;

do $$ begin
  raise exception 'ALL PASS';
end $$;

rollback;
