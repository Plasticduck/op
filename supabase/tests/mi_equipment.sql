-- Maintenance Inventory equipment (0227): who can see and change machines, the history
-- trigger, retire-not-delete, clone, bulk changes, saved views and the use counter.
--
-- Same harness as maintenance_inventory.sql: one transaction that always rolls back.
-- Any failure raises "FAIL n: ...", a clean run ends by raising "ALL PASS". Uses the real
-- Mighty Wash sites: MW01 has daily car counts, MW19 has none.
--
--   npx supabase db query --remote -f supabase/tests/mi_equipment.sql

begin;

select set_config('t.acct', '54f3e299-1f61-4ed2-9921-3d02160b72e6', true);
select set_config('t.mw01', (select id::text from public.locations where account_id = current_setting('t.acct')::uuid and name = 'MW01'), true);
select set_config('t.mw19', (select id::text from public.locations where account_id = current_setting('t.acct')::uuid and name = 'MW19'), true);
select set_config('t.eq19', (select e.id::text from public.equipment e where e.location_id = current_setting('t.mw19')::uuid limit 1), true);
select set_config('t.today', ((now() at time zone 'America/Chicago')::date)::text, true);

do $$
declare
  a uuid := current_setting('t.acct')::uuid;
  u record;
begin
  if current_setting('t.mw01', true) is null or current_setting('t.mw19', true) is null then raise exception 'FAIL 0: MW01 or MW19 missing'; end if;
  for u in select * from (values
    ('tech_lbk', 'site_tech', array[current_setting('t.mw01')::uuid]),
    ('mgr_lbk', 'site_manager', array[current_setting('t.mw01')::uuid]),
    ('mgr_nm', 'site_manager', array[current_setting('t.mw19')::uuid]),
    ('director', 'corporate_maintenance_director', '{}'::uuid[])) v(k, r, sites)
  loop
    perform set_config('t.' || u.k, gen_random_uuid()::text, true);
    insert into auth.users (id, email, instance_id, aud, role)
    values (current_setting('t.' || u.k)::uuid, u.k || '@mi-eq-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.users (id, account_id, location_ids, role, name, email)
    values (current_setting('t.' || u.k)::uuid, a, u.sites, 'manager', 'Test ' || u.k, u.k || '@mi-eq-test.invalid');
    insert into public.mi_members (user_id, account_id, role, site_ids) values (current_setting('t.' || u.k)::uuid, a, u.r, u.sites);
  end loop;
  perform set_config('t.outsider', gen_random_uuid()::text, true);
  insert into auth.users (id, email, instance_id, aud, role)
  values (current_setting('t.outsider')::uuid, 'outsider@mi-eq-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  insert into public.users (id, account_id, location_ids, role, name, email)
  values (current_setting('t.outsider')::uuid, a, '{}', 'owner', 'Test outsider', 'outsider@mi-eq-test.invalid');
end $$;

-- ===== Who sees what =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  r jsonb := public.mi_equipment_list();
begin
  if jsonb_array_length(r -> 'rows') = 0 then raise exception 'FAIL 1: MW01 manager sees no equipment'; end if;
  if exists (select 1 from jsonb_array_elements(r -> 'rows') x where (x ->> 'location_id')::uuid <> current_setting('t.mw01')::uuid) then
    raise exception 'FAIL 2: MW01 manager sees another site''s equipment';
  end if;
  if exists (select 1 from jsonb_array_elements(r -> 'rows') x where x ->> 'status' = 'retired') then raise exception 'FAIL 3: retired rows in the default list'; end if;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.outsider'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mi_equipment_list();
  raise exception 'FAIL 4: a non-member listed equipment';
exception when insufficient_privilege then null; end $$;
reset role;

-- ===== Add and edit =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mi_equipment_save(jsonb_build_object('location_id', current_setting('t.mw01'), 'name', 'TEST tech machine'));
  raise exception 'FAIL 5: a site tech added equipment';
exception when insufficient_privilege then null; end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  m jsonb;
  c jsonb;
begin
  m := public.mi_equipment_save(jsonb_build_object('location_id', current_setting('t.mw01'), 'name', 'TEST Blower', 'type', 'TEST Blower Type',
    'area_name', 'TEST Zone', 'crit_class', 'A'));
  perform set_config('t.m', m ->> 'id', true);
  c := public.mi_equipment_save(jsonb_build_object('location_id', current_setting('t.mw01'), 'name', 'TEST Blower Motor', 'parent_asset_id', m ->> 'id'));
  perform set_config('t.c', c ->> 'id', true);
end $$;
reset role;
do $$ begin
  if (select a.name from public.equipment e join public.mi_areas a on a.id = e.area_id where e.id = current_setting('t.m')::uuid) <> 'TEST Zone' then
    raise exception 'FAIL 6: zone by name wasn''t made';
  end if;
  if (select criticality from public.equipment where id = current_setting('t.m')::uuid) <> 'high' then raise exception 'FAIL 7: legacy criticality not kept in step'; end if;
  if not exists (select 1 from public.mi_equipment_events where equipment_id = current_setting('t.m')::uuid and action = 'created' and actor_name = 'Test mgr_lbk') then
    raise exception 'FAIL 8: no created event with the actor';
  end if;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mi_equipment_save(jsonb_build_object('id', current_setting('t.m'), 'parent_asset_id', current_setting('t.c')));
  raise exception 'FAIL 9: a machine was put under its own component';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;
do $$ begin
  perform public.mi_equipment_save(jsonb_build_object('location_id', current_setting('t.mw19'), 'name', 'TEST elsewhere'));
  raise exception 'FAIL 10: added equipment at a site that isn''t theirs';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.mi_equipment_save(jsonb_build_object('id', current_setting('t.c'), 'parent_asset_id', current_setting('t.eq19')));
  raise exception 'FAIL 11: parent at another site accepted';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;
do $$ begin
  perform public.mi_equipment_save(jsonb_build_object('id', current_setting('t.m'), 'location_id', current_setting('t.mw19')));
  raise exception 'FAIL 12: save moved a machine to another site';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;

-- ===== Clone, bulk changes =====
do $$
declare
  r jsonb := public.mi_equipment_clone(current_setting('t.m')::uuid, 2, true);
begin
  if jsonb_array_length(r) <> 2 then raise exception 'FAIL 13: %', r; end if;
  if (select count(*) from public.equipment where parent_asset_id = any (array[(r -> 0 ->> 'id')::uuid, (r -> 1 ->> 'id')::uuid])) <> 2 then
    raise exception 'FAIL 14: components weren''t copied';
  end if;
  perform public.mi_equipment_bulk(array[current_setting('t.m')::uuid], 'status', 'offline_unplanned');
  perform public.mi_equipment_bulk(array[current_setting('t.m')::uuid], 'zone', 'TEST Zone 2');
end $$;
do $$ begin
  perform public.mi_equipment_bulk(array[current_setting('t.m')::uuid], 'site', current_setting('t.mw19'));
  raise exception 'FAIL 15: a site manager moved equipment between sites';
exception when insufficient_privilege then null; end $$;
reset role;
do $$ begin
  if (select count(*) from public.mi_equipment_events e join public.equipment q on q.id = e.equipment_id
      where e.action = 'cloned' and q.name like 'TEST Blower%') <> 4 then raise exception 'FAIL 16: clone events'; end if;
  if not exists (select 1 from public.mi_equipment_events where equipment_id = current_setting('t.m')::uuid and action = 'status_changed'
                 and after ->> 'status' = 'offline_unplanned' and before ->> 'status' = 'online') then raise exception 'FAIL 17: status event'; end if;
  if not exists (select 1 from public.mi_equipment_events where equipment_id = current_setting('t.m')::uuid and action = 'moved_zone') then raise exception 'FAIL 18: zone event'; end if;
  -- An edit made straight on the table (the older Assets page) is in the history too.
  update public.equipment set model = 'TEST-MODEL' where id = current_setting('t.m')::uuid;
  if not exists (select 1 from public.mi_equipment_events where equipment_id = current_setting('t.m')::uuid and action = 'updated' and after ->> 'model' = 'TEST-MODEL') then
    raise exception 'FAIL 19: direct edit not in the history';
  end if;
end $$;

-- ===== Retire, restore, and no deletes =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  r jsonb := public.mi_equipment_retire(array[current_setting('t.m')::uuid], 'TEST reason');
begin
  if (r ->> 'retired')::int <> 2 then raise exception 'FAIL 20: retire took % rows', r; end if;
  if exists (select 1 from jsonb_array_elements(public.mi_equipment_list() -> 'rows') x where x ->> 'id' = current_setting('t.m')) then raise exception 'FAIL 21: retired machine listed'; end if;
  if not exists (select 1 from jsonb_array_elements(public.mi_equipment_list(true) -> 'rows') x where x ->> 'id' = current_setting('t.c')) then raise exception 'FAIL 22: retired component missing with retired on'; end if;
  r := public.mi_equipment_restore(array[current_setting('t.m')::uuid]);
  if (r ->> 'restored')::int <> 2 then raise exception 'FAIL 23: restore took % rows', r; end if;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.mi_equipment_events where equipment_id = current_setting('t.m')::uuid and action = 'retired' and note = 'TEST reason') then raise exception 'FAIL 24: retired event'; end if;
  insert into public.work_orders (account_id, location_id, title, status, equipment_id)
  values (current_setting('t.acct')::uuid, current_setting('t.mw01')::uuid, 'TEST blower WO', 'open', current_setting('t.m')::uuid);
  delete from public.equipment where id = current_setting('t.m')::uuid;
  raise exception 'FAIL 25: a machine with a work order was deleted';
exception when foreign_key_violation then null; end $$;
do $$ begin
  perform set_config('mi.allow_delete', 'on', true);
  delete from public.equipment where id = current_setting('t.c')::uuid;
  perform set_config('mi.allow_delete', '', true);
  if exists (select 1 from public.equipment where id = current_setting('t.c')::uuid) then raise exception 'FAIL 26: allowed delete didn''t happen'; end if;
  if not exists (select 1 from public.mi_equipment_events where equipment_id = current_setting('t.c')::uuid and action = 'deleted') then raise exception 'FAIL 27: delete not in history'; end if;
end $$;

-- ===== Use counter =====
do $$ begin
  update public.equipment set install_date = current_setting('t.today')::date - 10 where id = current_setting('t.m')::uuid;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  u jsonb := public.mi_equipment_detail(current_setting('t.m')::uuid) -> 'usage';
  want numeric;
  g jsonb;
begin
  select coalesce(sum(coalesce(drb_cars, 0) - coalesce(drb_test_cars, 0) + coalesce(flex_cars, 0)), 0) into want
  from public.site_daily_metrics where account_id = current_setting('t.acct')::uuid and site_number = 1 and date >= current_setting('t.today')::date - 10;
  if u ->> 'state' <> 'ok' or u ->> 'since_source' <> 'install' or (u ->> 'cars_since')::numeric <> want then raise exception 'FAIL 28: % (wanted %)', u, want; end if;
  if (u ->> 'cars_30d') is null then raise exception 'FAIL 29: no 30-day count at MW01'; end if;

  g := public.mi_reset_usage(current_setting('t.m')::uuid, current_setting('t.today')::date - 3, 'TEST new bundle');
  perform set_config('t.reset', g ->> 'id', true);
  u := public.mi_equipment_detail(current_setting('t.m')::uuid) -> 'usage';
  if u ->> 'since_source' <> 'reset' or (u ->> 'since')::date <> current_setting('t.today')::date - 3 then raise exception 'FAIL 30: %', u; end if;
  if not exists (select 1 from jsonb_array_elements(public.mi_equipment_list() -> 'rows') x
                 where x ->> 'id' = current_setting('t.m') and (x ->> 'usage_since')::date = current_setting('t.today')::date - 3) then
    raise exception 'FAIL 31: list doesn''t show the restarted count';
  end if;

  perform public.mi_log_void(current_setting('t.reset')::uuid, 'TEST mistake');
  u := public.mi_equipment_detail(current_setting('t.m')::uuid) -> 'usage';
  if u ->> 'since_source' <> 'install' then raise exception 'FAIL 32: voiding didn''t put the count back: %', u; end if;

  if not exists (select 1 from jsonb_array_elements(public.mi_equipment_timeline(current_setting('t.m')::uuid)) x where x ->> 'kind' = 'log' and (x ->> 'resets_usage')::boolean) then
    raise exception 'FAIL 33: timeline is missing the replacement';
  end if;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_nm'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  u jsonb := public.mi_equipment_detail(current_setting('t.eq19')::uuid) -> 'usage';
begin
  if u ->> 'state' <> 'no_data' then raise exception 'FAIL 34: MW19 has no car counts but says %', u; end if;
  if public.mi_equipment_detail(current_setting('t.m')::uuid) ->> 'hidden' is null then raise exception 'FAIL 35: MW19 manager opened an MW01 machine'; end if;
end $$;
reset role;

-- ===== Saved views =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.mi_saved_views (account_id, name, params) values (current_setting('t.acct')::uuid, 'TEST mine', '{"status":"down"}');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech_lbk'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.mi_saved_views where name = 'TEST mine') then raise exception 'FAIL 36: someone else''s private view is visible'; end if;
end $$;
do $$ begin
  insert into public.mi_saved_views (account_id, name, params, is_shared) values (current_setting('t.acct')::uuid, 'TEST shared', '{}', true);
  raise exception 'FAIL 37: a site tech shared a view';
exception when insufficient_privilege then null; end $$;
reset role;

do $$ begin
  raise exception 'ALL PASS';
end $$;

rollback;
