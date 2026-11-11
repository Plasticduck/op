-- Equipment import (0231): who can, preview vs commit, matching, parents in the same file,
-- stickers, and running the same file twice.
--
-- One transaction that always rolls back. "FAIL n: ..." on failure, "ALL PASS" at the end.
--
--   npx supabase db query --remote -f supabase/tests/mi_import.sql

begin;

select set_config('t.acct', '54f3e299-1f61-4ed2-9921-3d02160b72e6', true);
select set_config('t.mw02', (select id::text from public.locations where account_id = current_setting('t.acct')::uuid and name = 'MW02'), true);
select set_config('t.tb1', (select id::text from public.equipment where location_id = current_setting('t.mw02')::uuid and type = 'Top Brush 1' and parent_asset_id is null), true);
select set_config('t.tb1_name', (select name from public.equipment where id = current_setting('t.tb1')::uuid), true);

do $$
declare
  a uuid := current_setting('t.acct')::uuid;
  u record;
begin
  for u in select * from (values
    ('mgr', 'site_manager', array[current_setting('t.mw02')::uuid]),
    ('director', 'corporate_maintenance_director', '{}'::uuid[])) v(k, r, sites)
  loop
    perform set_config('t.' || u.k, gen_random_uuid()::text, true);
    insert into auth.users (id, email, instance_id, aud, role)
    values (current_setting('t.' || u.k)::uuid, u.k || '@mi-import-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.users (id, account_id, location_ids, role, name, email)
    values (current_setting('t.' || u.k)::uuid, a, u.sites, 'manager', 'Test ' || u.k, u.k || '@mi-import-test.invalid');
    insert into public.mi_members (user_id, account_id, role, site_ids) values (current_setting('t.' || u.k)::uuid, a, u.r, u.sites);
  end loop;
end $$;

select set_config('t.rows', jsonb_build_array(
  jsonb_build_object('site', 'MW02', 'name', 'TEST Import Machine', 'type', 'TEST Import Type', 'zone', 'TEST Import Zone', 'status', 'running', 'criticality', 'a', 'tag', 'TEST-IMP-1', 'installed', '2026-01-15'),
  jsonb_build_object('site', 'MW02', 'name', 'TEST Import Motor', 'parent', 'TEST Import Machine', 'status', 'broken down'),
  jsonb_build_object('site', 'mw02', 'name', current_setting('t.tb1_name'), 'model', 'TEST-IMPORTED-MODEL')
)::text, true);

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mi_import_equipment(current_setting('t.rows')::jsonb, false);
  raise exception 'FAIL 1: a site manager imported equipment';
exception when insufficient_privilege then null; end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.director'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  bad jsonb := current_setting('t.rows')::jsonb || jsonb_build_array(jsonb_build_object('site', 'Nowhere', 'name', 'TEST bad'));
  r jsonb;
begin
  r := public.mi_import_equipment(bad, false);
  if (r ->> 'committed')::boolean or (r ->> 'created')::int <> 2 or (r ->> 'updated')::int <> 1 or (r ->> 'errors')::int <> 1 then raise exception 'FAIL 2: preview %', r; end if;
  if r -> 'rows' -> 3 ->> 'status' <> 'error' or r -> 'rows' -> 3 ->> 'message' not like 'Site "Nowhere"%' then raise exception 'FAIL 3: %', r -> 'rows' -> 3; end if;
  if exists (select 1 from public.equipment where name = 'TEST Import Machine') then raise exception 'FAIL 4: preview saved a machine'; end if;
  r := public.mi_import_equipment(bad, true);
  if (r ->> 'committed')::boolean or exists (select 1 from public.equipment where name = 'TEST Import Machine') then raise exception 'FAIL 5: imported with a bad row'; end if;

  r := public.mi_import_equipment(current_setting('t.rows')::jsonb, true);
  if not (r ->> 'committed')::boolean or (r ->> 'created')::int <> 2 or (r ->> 'updated')::int <> 1 then raise exception 'FAIL 6: commit %', r; end if;
  -- Same file again changes nothing new.
  r := public.mi_import_equipment(current_setting('t.rows')::jsonb, true);
  if (r ->> 'created')::int <> 0 or (r ->> 'updated')::int <> 3 then raise exception 'FAIL 7: rerun %', r; end if;
end $$;
reset role;

do $$
declare
  m public.equipment;
  c public.equipment;
begin
  select * into m from public.equipment where name = 'TEST Import Machine';
  select * into c from public.equipment where name = 'TEST Import Motor';
  if m.crit_class <> 'A' or m.install_date <> '2026-01-15' or (select name from public.mi_areas where id = m.area_id) <> 'TEST Import Zone' then raise exception 'FAIL 8: machine fields'; end if;
  if c.parent_asset_id <> m.id or c.status <> 'offline_unplanned' then raise exception 'FAIL 9: component'; end if;
  if (select entity_id from public.mi_tags where code = 'TEST-IMP-1' and status = 'applied') <> m.id then raise exception 'FAIL 10: sticker'; end if;
  if (select model from public.equipment where id = current_setting('t.tb1')::uuid) <> 'TEST-IMPORTED-MODEL' then raise exception 'FAIL 11: update by site and name'; end if;
  if not exists (select 1 from public.mi_equipment_events where equipment_id = m.id and action = 'imported') then raise exception 'FAIL 12: no imported event'; end if;
end $$;

do $$ begin
  raise exception 'ALL PASS';
end $$;

rollback;
