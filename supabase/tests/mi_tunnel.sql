-- Tunnel diagrams (0228): templates, copying to sites with links by type, the
-- version guard, links, and who can do what.
--
-- One transaction that always rolls back. "FAIL n: ..." on failure, "ALL PASS" at the
-- end. Uses MW02, which has the full MaintainX machine set, and MW19.
--
--   npx supabase db query --remote -f supabase/tests/mi_tunnel.sql

begin;

select set_config('t.acct', '54f3e299-1f61-4ed2-9921-3d02160b72e6', true);
select set_config('t.mw02', (select id::text from public.locations where account_id = current_setting('t.acct')::uuid and name = 'MW02'), true);
select set_config('t.mw19', (select id::text from public.locations where account_id = current_setting('t.acct')::uuid and name = 'MW19'), true);
select set_config('t.tb1', (select id::text from public.equipment where location_id = current_setting('t.mw02')::uuid and type = 'Top Brush 1' and parent_asset_id is null), true);
select set_config('t.tb1_motor', (select id::text from public.equipment where location_id = current_setting('t.mw02')::uuid and type = 'Top Brush 1 - Motor'), true);
select set_config('t.wrap_ds1', (select id::text from public.equipment where location_id = current_setting('t.mw02')::uuid and type = 'Wrap Driver Side 1'), true);
select set_config('t.hydra', (select id::text from public.equipment where location_id = current_setting('t.mw02')::uuid and type = 'Hydra Flex'), true);
select set_config('t.eq19', (select id::text from public.equipment where location_id = current_setting('t.mw19')::uuid limit 1), true);

do $$
declare
  a uuid := current_setting('t.acct')::uuid;
  u record;
begin
  if current_setting('t.tb1', true) is null or current_setting('t.wrap_ds1', true) is null or current_setting('t.hydra', true) is null then
    raise exception 'FAIL 0: MW02 is missing Top Brush 1, Wrap Driver Side 1 or Hydra Flex';
  end if;
  update public.equipment set area_id = null where id = current_setting('t.hydra')::uuid;
  for u in select * from (values
    ('tech', 'site_tech', array[current_setting('t.mw02')::uuid]),
    ('mgr', 'site_manager', array[current_setting('t.mw02')::uuid]),
    ('mgr_nm', 'site_manager', array[current_setting('t.mw19')::uuid]),
    ('director', 'corporate_maintenance_director', '{}'::uuid[])) v(k, r, sites)
  loop
    perform set_config('t.' || u.k, gen_random_uuid()::text, true);
    insert into auth.users (id, email, instance_id, aud, role)
    values (current_setting('t.' || u.k)::uuid, u.k || '@mi-tunnel-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.users (id, account_id, location_ids, role, name, email)
    values (current_setting('t.' || u.k)::uuid, a, u.sites, 'manager', 'Test ' || u.k, u.k || '@mi-tunnel-test.invalid');
    insert into public.mi_members (user_id, account_id, role, site_ids) values (current_setting('t.' || u.k)::uuid, a, u.r, u.sites);
  end loop;
end $$;

select set_config('t.tpl_json', jsonb_build_object(
  'is_template', true, 'name', 'TEST express', 'length_ft', 120, 'width_ft', 16,
  'zones', jsonb_build_array(jsonb_build_object('name', 'TEST Wash', 'x_from', 0, 'x_to', 100)),
  'items', jsonb_build_array(
    jsonb_build_object('kind', 'top_brush', 'label', 'Top Brush 1', 'x_ft', 35, 'y_ft', 0, 'w_ft', 3.5, 'h_ft', 13, 'side', 'center', 'zone', 'TEST Wash', 'match_type', 'Top Brush 1'),
    jsonb_build_object('kind', 'wrap', 'label', 'Wrap DS1', 'x_ft', 26, 'y_ft', -4.6, 'w_ft', 5, 'h_ft', 5, 'side', 'ds', 'zone', 'TEST Wash', 'match_type', 'Wrap Driver Side 1'),
    jsonb_build_object('kind', 'arch', 'label', 'Presoak', 'x_ft', 9, 'y_ft', 0, 'w_ft', 1.5, 'h_ft', 16, 'side', 'both', 'zone', 'TEST Wash'),
    jsonb_build_object('kind', 'equipment', 'label', 'Hydra Flex', 'x_ft', 44, 'y_ft', 27, 'w_ft', 8, 'h_ft', 6, 'side', 'outside', 'zone', 'TEST Equipment room', 'match_type', 'Hydra Flex'))
)::text, true);

-- ===== Templates: directors only =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mi_tunnel_save(current_setting('t.tpl_json')::jsonb);
  raise exception 'FAIL 1: a site manager made a template';
exception when insufficient_privilege then null; end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.director'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  r jsonb := public.mi_tunnel_save(current_setting('t.tpl_json')::jsonb);
begin
  perform set_config('t.tpl', r ->> 'id', true);
  if (r ->> 'version')::int <> 1 then raise exception 'FAIL 2: %', r; end if;
end $$;
do $$ begin
  perform public.mi_tunnel_save(jsonb_build_object('id', current_setting('t.tpl'), 'items', jsonb_build_array(
    jsonb_build_object('kind', 'equipment', 'asset_id', current_setting('t.tb1')))));
  raise exception 'FAIL 3: a template was linked to a real machine';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if not exists (select 1 from jsonb_array_elements(public.mi_tunnel_templates() -> 'templates') x where x ->> 'id' = current_setting('t.tpl')) then
    raise exception 'FAIL 4: a site tech can''t see the template';
  end if;
end $$;
reset role;

-- ===== Copying to a site =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  r jsonb := public.mi_tunnel_apply(current_setting('t.tpl')::uuid, array[current_setting('t.mw02')::uuid], '{}'::jsonb, false);
  s jsonb := r -> 'sites' -> 0;
begin
  -- Presoak has no type: it's a placeholder, not a failed match.
  if (r ->> 'committed')::boolean or s ->> 'result' <> 'created' or (s ->> 'linked')::int <> 3 or (s ->> 'items')::int <> 4 or s -> 'unmatched' <> '[]'::jsonb then
    raise exception 'FAIL 5: dry run said %', r;
  end if;
  if exists (select 1 from public.mi_tunnel_layouts where location_id = current_setting('t.mw02')::uuid) then raise exception 'FAIL 6: a check saved a diagram'; end if;
  if exists (select 1 from public.mi_areas where site_id = current_setting('t.mw02')::uuid and name = 'TEST Wash') then raise exception 'FAIL 7: a check made a zone'; end if;
end $$;
do $$ begin
  perform public.mi_tunnel_apply(current_setting('t.tpl')::uuid, array[current_setting('t.mw02')::uuid, current_setting('t.mw19')::uuid], '{}'::jsonb, true);
  raise exception 'FAIL 8: a site manager set up several sites at once';
exception when insufficient_privilege then null; end $$;
do $$
declare
  r jsonb := public.mi_tunnel_apply(current_setting('t.tpl')::uuid, array[current_setting('t.mw02')::uuid], '{}'::jsonb, true);
  g jsonb;
begin
  if not (r ->> 'committed')::boolean or r -> 'sites' -> 0 ->> 'result' <> 'created' then raise exception 'FAIL 9: %', r; end if;
  g := public.mi_tunnel_get(current_setting('t.mw02')::uuid);
  perform set_config('t.layout', g -> 'layout' ->> 'id', true);
  perform set_config('t.version', g -> 'layout' ->> 'version', true);
  perform set_config('t.presoak', (select x ->> 'id' from jsonb_array_elements(g -> 'items') x where x ->> 'label' = 'Presoak'), true);
  if (select x ->> 'asset_id' from jsonb_array_elements(g -> 'items') x where x ->> 'label' = 'Wrap DS1') <> current_setting('t.wrap_ds1') then
    raise exception 'FAIL 10: the wrap didn''t link to its component';
  end if;
  if (select x ->> 'asset_id' from jsonb_array_elements(g -> 'items') x where x ->> 'label' = 'Top Brush 1') <> current_setting('t.tb1') then
    raise exception 'FAIL 11: Top Brush 1 didn''t link to the machine';
  end if;
  if not (g -> 'assets') ? current_setting('t.tb1') then raise exception 'FAIL 12: linked machine missing from assets'; end if;
  if exists (select 1 from jsonb_array_elements(g -> 'unplaced') x where x ->> 'id' = current_setting('t.tb1')) then raise exception 'FAIL 13: a linked machine is listed as not placed'; end if;
  if not (g ->> 'can_edit')::boolean or (g ->> 'can_edit_templates')::boolean then raise exception 'FAIL 14: wrong permissions %', g; end if;
end $$;
reset role;
do $$ begin
  if (select a.name from public.equipment e join public.mi_areas a on a.id = e.area_id where e.id = current_setting('t.hydra')::uuid) <> 'TEST Equipment room' then
    raise exception 'FAIL 15: Hydra Flex didn''t get its zone';
  end if;
  if not exists (select 1 from public.mi_areas where site_id = current_setting('t.mw02')::uuid and name = 'TEST Wash') then raise exception 'FAIL 16: band zone not made'; end if;
  if not exists (select 1 from public.mi_equipment_events where equipment_id = current_setting('t.tb1')::uuid and action = 'diagram_linked') then raise exception 'FAIL 17: no linked event'; end if;
end $$;

-- ===== Seeing and saving =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_nm'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mi_tunnel_get(current_setting('t.mw02')::uuid);
  raise exception 'FAIL 18: the MW19 manager opened MW02''s diagram';
exception when insufficient_privilege then null; end $$;
do $$ begin
  if exists (select 1 from public.mi_tunnel_layouts where location_id = current_setting('t.mw02')::uuid) then raise exception 'FAIL 19: RLS shows MW02''s layout to MW19'; end if;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  items jsonb := public.mi_tunnel_get(current_setting('t.mw02')::uuid) -> 'items';
  r jsonb;
begin
  -- Move a shape and save: version goes up.
  items := (select jsonb_agg(case when x ->> 'label' = 'Top Brush 1' then jsonb_set(x, '{x_ft}', '40') else x end) from jsonb_array_elements(items) x);
  r := public.mi_tunnel_save(jsonb_build_object('id', current_setting('t.layout'), 'version', current_setting('t.version')::int, 'items', items));
  if (r ->> 'version')::int <> current_setting('t.version')::int + 1 then raise exception 'FAIL 20: %', r; end if;
  if (select x_ft from public.mi_tunnel_items where layout_id = current_setting('t.layout')::uuid and label = 'Top Brush 1') <> 40 then raise exception 'FAIL 21: move not saved'; end if;
  perform set_config('t.items', items::text, true);
end $$;
do $$ begin
  perform public.mi_tunnel_save(jsonb_build_object('id', current_setting('t.layout'), 'version', current_setting('t.version')::int, 'items', current_setting('t.items')::jsonb));
  raise exception 'FAIL 22: a stale save went through';
exception when serialization_failure then null; end $$;
do $$ begin
  perform public.mi_tunnel_save(jsonb_build_object('id', current_setting('t.layout'), 'items', jsonb_build_array(
    jsonb_build_object('kind', 'equipment', 'asset_id', current_setting('t.eq19')))));
  raise exception 'FAIL 23: linked a machine from another site';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;
do $$
declare
  d jsonb;
begin
  perform public.mi_tunnel_link_item(current_setting('t.presoak')::uuid, current_setting('t.hydra')::uuid);
  if (select asset_id from public.mi_tunnel_items where id = current_setting('t.presoak')::uuid) <> current_setting('t.hydra')::uuid then raise exception 'FAIL 24: link'; end if;
  perform public.mi_tunnel_link_item(current_setting('t.presoak')::uuid, null);
  d := public.mi_equipment_detail(current_setting('t.tb1_motor')::uuid);
  if not coalesce((d -> 'diagram' -> 0 ->> 'via_parent')::boolean, false) then raise exception 'FAIL 25: a component doesn''t find its machine on the drawing: %', d -> 'diagram'; end if;
end $$;
do $$
declare
  r jsonb;
begin
  r := public.mi_tunnel_apply(current_setting('t.tpl')::uuid, array[current_setting('t.mw02')::uuid], '{}'::jsonb, true);
  if r -> 'sites' -> 0 ->> 'result' <> 'skipped' then raise exception 'FAIL 26: %', r; end if;
  r := public.mi_tunnel_apply(current_setting('t.tpl')::uuid, array[current_setting('t.mw02')::uuid], '{"mode":"replace"}'::jsonb, true);
  if r -> 'sites' -> 0 ->> 'result' <> 'replaced' then raise exception 'FAIL 27: %', r; end if;
  if (select count(*) from public.mi_tunnel_layouts where location_id = current_setting('t.mw02')::uuid) <> 1 then raise exception 'FAIL 28: two diagrams for one tunnel'; end if;
end $$;
reset role;

-- A machine moved to another site comes off this one's drawing.
do $$ begin
  update public.equipment set location_id = current_setting('t.mw19')::uuid, parent_asset_id = null where id = current_setting('t.hydra')::uuid;
  if exists (select 1 from public.mi_tunnel_items where asset_id = current_setting('t.hydra')::uuid) then raise exception 'FAIL 29: moved machine still on the old drawing'; end if;
end $$;

do $$ begin
  raise exception 'ALL PASS';
end $$;

rollback;
