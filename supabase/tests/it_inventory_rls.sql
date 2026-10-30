-- IT Inventory: RLS isolation and integrity tests.
--
-- Runs entirely inside a transaction that is rolled back, so it leaves nothing
-- behind. It impersonates real users the way PostgREST does (JWT claims + the
-- authenticated role): account A is the demo account (an owner with two sites,
-- a manager and an employee limited to one), account B is another customer.
-- Any failure raises "FAIL n: ..." and aborts; success ends with ALL PASS.
--
-- Run against the linked project with the Management API (see PLAN.md), e.g.
--   sql.sh supabase/tests/it_inventory_rls.sql

begin;

-- ---- Fixtures (as postgres) -------------------------------------------------
select set_config('t.a', (select id::text from public.accounts where name = 'WashLyfe Demo'), true);
select set_config('t.b', (select id::text from public.accounts where name = 'Cruise Car Wash'), true);
select set_config('t.a_owner', (select id::text from public.users where account_id = current_setting('t.a')::uuid and role = 'owner' limit 1), true);
select set_config('t.a_mgr', (select id::text from public.users where account_id = current_setting('t.a')::uuid and role = 'manager' limit 1), true);
select set_config('t.a_emp', (select id::text from public.users where account_id = current_setting('t.a')::uuid and role = 'employee' limit 1), true);
select set_config('t.b_owner', (select id::text from public.users where account_id = current_setting('t.b')::uuid and role = 'owner' limit 1), true);
select set_config('t.site_in', (select location_ids[1]::text from public.users where id = current_setting('t.a_mgr')::uuid), true);
select set_config('t.site_out', (select id::text from public.locations
  where account_id = current_setting('t.a')::uuid and id <> current_setting('t.site_in')::uuid and not coalesce(archived, false) limit 1), true);
select set_config('t.b_site', (select id::text from public.locations where account_id = current_setting('t.b')::uuid limit 1), true);
select set_config('t.emp_locs', (select array_to_string(location_ids, ',') from public.users where id = current_setting('t.a_emp')::uuid), true);

do $$ begin
  if coalesce(current_setting('t.site_out', true), '') = '' or coalesce(current_setting('t.b_owner', true), '') = '' then
    raise exception 'FAIL 0: fixtures missing (need a two-site account A with a one-site manager, and an account B)';
  end if;
end $$;

-- ---- Set up both accounts and some assets -------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.it_bootstrap();
with x as (
  insert into public.it_assets (account_id, location_id, name, category_id, serial, mac_address)
  select current_setting('t.a')::uuid, current_setting('t.site_in')::uuid, 'Test POS in', id, 'TEST-SERIAL-1', '02:00:00:00:00:01'
    from public.it_categories where account_id = current_setting('t.a')::uuid and name = 'POS Terminal'
  returning id, asset_tag
) select set_config('t.asset_in', id::text, true), set_config('t.tag_in', asset_tag, true) from x;
with x as (
  insert into public.it_assets (account_id, location_id, name, category_id)
  select current_setting('t.a')::uuid, current_setting('t.site_out')::uuid, 'Test Router out', id
    from public.it_categories where account_id = current_setting('t.a')::uuid and name = 'Router/Firewall'
  returning id
) select set_config('t.asset_out', id::text, true) from x;
select set_config('t.a_short', (select short_code from public.it_settings where account_id = current_setting('t.a')::uuid), true);
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.b_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.it_bootstrap();
with x as (
  insert into public.it_assets (account_id, location_id, name, category_id)
  select current_setting('t.b')::uuid, current_setting('t.b_site')::uuid, 'Test B camera', id
    from public.it_categories where account_id = current_setting('t.b')::uuid and name = 'Security Camera'
  returning id
) select set_config('t.asset_b', id::text, true) from x;
reset role;

-- ---- Account A owner ---------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.it_assets where name like 'Test %') <> 2 then
    raise exception 'FAIL 1: A owner should see exactly the two A test assets';
  end if;
  if (select asset_tag from public.it_assets where id = current_setting('t.asset_in')::uuid) !~ '^[A-Z0-9]+-[0-9]{3,}$' then
    raise exception 'FAIL 2: generated tag has the wrong format';
  end if;
  if (select count(*) from public.it_activity_log where asset_id = current_setting('t.asset_in')::uuid and action = 'created') <> 1 then
    raise exception 'FAIL 3: creating an asset should log exactly one created row';
  end if;
end $$;

-- The log can't be changed by app roles.
do $$ begin
  update public.it_activity_log set action = 'updated' where asset_id = current_setting('t.asset_in')::uuid;
  raise exception 'FAIL 4: authenticated updated the activity log';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlstate <> '42501' then raise exception 'FAIL 4: expected permission denied, got %', sqlerrm; end if;
end $$;
do $$ begin
  delete from public.it_activity_log where asset_id = current_setting('t.asset_in')::uuid;
  raise exception 'FAIL 5: authenticated deleted from the activity log';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlstate <> '42501' then raise exception 'FAIL 5: expected permission denied, got %', sqlerrm; end if;
end $$;

-- A used tag can't go on a second asset; serial and MAC can't repeat.
do $$ begin
  insert into public.it_assets (account_id, location_id, name, category_id, asset_tag)
  select current_setting('t.a')::uuid, current_setting('t.site_in')::uuid, 'Dup tag', id, current_setting('t.tag_in')
    from public.it_categories where account_id = current_setting('t.a')::uuid and name = 'Other';
  raise exception 'FAIL 6: a used tag was applied to a second asset';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlstate <> '23505' then raise exception 'FAIL 6: expected unique violation, got %', sqlerrm; end if;
end $$;
do $$ begin
  insert into public.it_assets (account_id, location_id, name, category_id, serial)
  select current_setting('t.a')::uuid, current_setting('t.site_out')::uuid, 'Dup serial', id, 'test-serial-1'
    from public.it_categories where account_id = current_setting('t.a')::uuid and name = 'Other';
  raise exception 'FAIL 7: a duplicate serial (different case, other site) was accepted';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlstate <> '23505' then raise exception 'FAIL 7: expected unique violation, got %', sqlerrm; end if;
end $$;
do $$ begin
  if (select count(*) from public.it_find_duplicates(null, '02:00:00:00:00:01', null)) <> 1 then
    raise exception 'FAIL 8: duplicate check should find the MAC';
  end if;
end $$;

-- Only deployable gear can be checked out, and only once at a time.
update public.it_assets set status_label_id = (select id from public.it_status_labels
  where account_id = current_setting('t.a')::uuid and name = 'Broken') where id = current_setting('t.asset_in')::uuid;
do $$ begin
  insert into public.it_assignments (account_id, location_id, asset_id, assigned_type, assigned_id)
  values (current_setting('t.a')::uuid, current_setting('t.site_in')::uuid, current_setting('t.asset_in')::uuid,
          'site', current_setting('t.site_in')::uuid);
  raise exception 'FAIL 9: a Broken asset was checked out';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlerrm not like '%can''t be checked out%' then raise exception 'FAIL 9: wrong error: %', sqlerrm; end if;
end $$;
update public.it_assets set status_label_id = (select id from public.it_status_labels
  where account_id = current_setting('t.a')::uuid and name = 'In Service') where id = current_setting('t.asset_in')::uuid;
insert into public.it_assignments (account_id, location_id, asset_id, assigned_type, assigned_id)
values (current_setting('t.a')::uuid, current_setting('t.site_in')::uuid, current_setting('t.asset_in')::uuid,
        'site', current_setting('t.site_in')::uuid);
do $$ begin
  if (select assigned_label from public.it_assets where id = current_setting('t.asset_in')::uuid) is null then
    raise exception 'FAIL 10: check-out did not mark the asset';
  end if;
  if not exists (select 1 from public.it_activity_log where asset_id = current_setting('t.asset_in')::uuid and action = 'checked_out') then
    raise exception 'FAIL 11: check-out was not logged';
  end if;
  if not exists (select 1 from public.it_activity_log where asset_id = current_setting('t.asset_in')::uuid and action = 'status_changed'
                 and before ? 'status_label_id') then
    raise exception 'FAIL 12: status change was not logged with before/after';
  end if;
end $$;
do $$ begin
  insert into public.it_assignments (account_id, location_id, asset_id, assigned_type, assigned_id)
  values (current_setting('t.a')::uuid, current_setting('t.site_in')::uuid, current_setting('t.asset_in')::uuid,
          'site', current_setting('t.site_in')::uuid);
  raise exception 'FAIL 13: asset checked out twice';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlstate <> '23505' then raise exception 'FAIL 13: expected unique violation, got %', sqlerrm; end if;
end $$;
update public.it_assignments set checked_in_at = now() where asset_id = current_setting('t.asset_in')::uuid and checked_in_at is null;
do $$ begin
  if (select assigned_label from public.it_assets where id = current_setting('t.asset_in')::uuid) is not null then
    raise exception 'FAIL 14: check-in did not clear the asset';
  end if;
end $$;

-- Retiring an asset retires its tag for good.
update public.it_assets set status_label_id = (select id from public.it_status_labels
  where account_id = current_setting('t.a')::uuid and name = 'Retired') where id = current_setting('t.asset_out')::uuid;
do $$ begin
  if (select t.status from public.it_asset_tags t join public.it_assets a on a.asset_tag = t.tag and a.account_id = t.account_id
      where a.id = current_setting('t.asset_out')::uuid) <> 'retired' then
    raise exception 'FAIL 15: retired asset kept an active tag';
  end if;
end $$;
do $$ begin
  update public.it_asset_tags set status = 'unused'
   where account_id = current_setting('t.a')::uuid and asset_id = current_setting('t.asset_out')::uuid;
  raise exception 'FAIL 16: a retired tag went back to the unused pool';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;
reset role;

-- ---- Account A manager (one site) ---------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_mgr'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.it_assets where id = current_setting('t.asset_out')::uuid) then
    raise exception 'FAIL 17: manager can read an asset at a site they don''t manage';
  end if;
  if not exists (select 1 from public.it_assets where id = current_setting('t.asset_in')::uuid) then
    raise exception 'FAIL 18: manager can''t read an asset at their own site';
  end if;
  if exists (select 1 from public.it_activity_log where asset_id = current_setting('t.asset_out')::uuid) then
    raise exception 'FAIL 19: manager can read history for another site';
  end if;
end $$;
do $$
declare n integer;
begin
  update public.it_assets set notes = 'hacked' where id = current_setting('t.asset_out')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 20: manager updated an asset at another site'; end if;
end $$;
do $$ begin
  insert into public.it_assets (account_id, location_id, name, category_id)
  select current_setting('t.a')::uuid, current_setting('t.site_out')::uuid, 'Sneaky', id
    from public.it_categories where account_id = current_setting('t.a')::uuid and name = 'Other';
  raise exception 'FAIL 21: manager added an asset at another site';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlstate <> '42501' then raise exception 'FAIL 21: expected RLS violation, got %', sqlerrm; end if;
end $$;
insert into public.it_assets (account_id, location_id, name, category_id)
select current_setting('t.a')::uuid, current_setting('t.site_in')::uuid, 'Test manager add', id
  from public.it_categories where account_id = current_setting('t.a')::uuid and name = 'Tablet';
do $$
declare n integer;
begin
  update public.it_settings set tag_prefix = 'HACK' where account_id = current_setting('t.a')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 22: manager changed account settings'; end if;
end $$;
reset role;

-- ---- Account A employee (crew: read only) ----------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_emp'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.it_assets
             where not (location_id::text = any (string_to_array(current_setting('t.emp_locs'), ',')))) then
    raise exception 'FAIL 23: employee can read assets outside their sites';
  end if;
end $$;
do $$ begin
  insert into public.it_assets (account_id, location_id, name, category_id)
  select current_setting('t.a')::uuid, split_part(current_setting('t.emp_locs'), ',', 1)::uuid, 'Crew add', id
    from public.it_categories where account_id = current_setting('t.a')::uuid and name = 'Other';
  raise exception 'FAIL 24: employee added an asset';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlstate <> '42501' then raise exception 'FAIL 24: expected RLS violation, got %', sqlerrm; end if;
end $$;
reset role;

-- ---- Account B owner: nothing of A's is visible or writable ------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.b_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare n integer;
begin
  if exists (select 1 from public.it_assets where account_id = current_setting('t.a')::uuid)
     or exists (select 1 from public.it_activity_log where account_id = current_setting('t.a')::uuid)
     or exists (select 1 from public.it_categories where account_id = current_setting('t.a')::uuid)
     or exists (select 1 from public.it_asset_tags where account_id = current_setting('t.a')::uuid)
     or exists (select 1 from public.it_settings where account_id = current_setting('t.a')::uuid) then
    raise exception 'FAIL 25: account B can read account A inventory rows';
  end if;
  update public.it_assets set notes = 'cross-account' where id = current_setting('t.asset_in')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 26: account B updated an account A asset'; end if;
  if (public.it_resolve_tag(current_setting('t.a_short'), current_setting('t.tag_in')) ->> 'result') <> 'other_account' then
    raise exception 'FAIL 27: scanning another account''s sticker was not rejected';
  end if;
end $$;
do $$ begin
  insert into public.it_assets (account_id, location_id, name, category_id)
  select current_setting('t.a')::uuid, current_setting('t.site_in')::uuid, 'Cross', id
    from public.it_categories where account_id = current_setting('t.b')::uuid and name = 'Other';
  raise exception 'FAIL 28: account B inserted into account A';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlstate <> '42501' then raise exception 'FAIL 28: expected RLS violation, got %', sqlerrm; end if;
end $$;
reset role;

-- ---- Account A owner: add-N, scan resolution, pre-printed tags, printing ---------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  tags text[];
  pool text;
  aid uuid;
  res jsonb;
begin
  -- Add 3 identical in one insert: three different, sequential tags.
  with x as (
    insert into public.it_assets (account_id, location_id, name, category_id, asset_tag)
    select current_setting('t.a')::uuid, current_setting('t.site_in')::uuid, 'Test identical', c.id, ''
      from public.it_categories c, generate_series(1, 3)
     where c.account_id = current_setting('t.a')::uuid and c.name = 'Tablet'
    returning asset_tag
  ) select array_agg(asset_tag order by asset_tag) into tags from x;
  if array_length(tags, 1) <> 3 or (select count(distinct t) from unnest(tags) t) <> 3 then
    raise exception 'FAIL 31: add-3 did not get three distinct tags: %', tags;
  end if;

  -- A scanned tag resolves to its asset, typed lowercase or not.
  res := public.it_resolve_tag(current_setting('t.a_short'), lower(current_setting('t.tag_in')));
  if res ->> 'result' <> 'asset' or (res ->> 'asset_id')::uuid <> current_setting('t.asset_in')::uuid then
    raise exception 'FAIL 32: scanning a tag did not open its asset: %', res;
  end if;

  -- A blank pre-printed sticker resolves as unused, then applies on add.
  select tag into pool from public.it_generate_tags(2) order by tag limit 1;
  if public.it_resolve_tag(null, pool) ->> 'result' <> 'unused' then
    raise exception 'FAIL 33: a blank pool tag did not resolve as unused';
  end if;
  insert into public.it_assets (account_id, location_id, name, category_id, asset_tag)
  select current_setting('t.a')::uuid, current_setting('t.site_in')::uuid, 'Test pre-printed', id, lower(pool)
    from public.it_categories where account_id = current_setting('t.a')::uuid and name = 'Other'
  returning id into aid;
  if (select status from public.it_asset_tags where account_id = current_setting('t.a')::uuid and tag = pool) <> 'applied'
     or (select asset_tag from public.it_assets where id = aid) <> pool then
    raise exception 'FAIL 34: applying a pre-printed tag did not link it';
  end if;
  if not exists (select 1 from public.it_activity_log where asset_id = aid and action = 'tag_applied') then
    raise exception 'FAIL 35: applying a pre-printed tag was not logged';
  end if;

  -- Printing counts the sticker and logs label_printed on the asset.
  insert into public.it_label_print_jobs (account_id, template_id, asset_ids, quantity, printed_by)
  values (current_setting('t.a')::uuid,
          (select id from public.it_label_templates where account_id = current_setting('t.a')::uuid and is_default),
          array[aid], 1, auth.uid());
  if (select printed_count from public.it_asset_tags where account_id = current_setting('t.a')::uuid and tag = pool) <> 1 then
    raise exception 'FAIL 36: printing did not count the sticker';
  end if;
  if not exists (select 1 from public.it_activity_log where asset_id = aid and action = 'label_printed') then
    raise exception 'FAIL 37: printing was not logged on the asset';
  end if;
  -- ...and uses up one sticker from that site's Sticker Stock (seeded at 0).
  if (select qty_on_hand from public.it_consumables
       where location_id = current_setting('t.site_in')::uuid and is_sticker_stock and deleted_at is null) <> -1 then
    raise exception 'FAIL 38: printing did not count down the site''s sticker stock';
  end if;
end $$;
reset role;

-- ---- Account A owner: bulk check-out / check-in, status notes, retire, move --------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  ok_id   uuid;
  bad_id  uuid;
  far_area uuid;
  near_area uuid;
  res     jsonb;
  spare   uuid := (select id from public.it_status_labels where account_id = current_setting('t.a')::uuid and name = 'Spare / In Stock');
  broken  uuid := (select id from public.it_status_labels where account_id = current_setting('t.a')::uuid and name = 'Broken');
  retired uuid := (select id from public.it_status_labels where account_id = current_setting('t.a')::uuid and name = 'Retired');
begin
  insert into public.it_assets (account_id, location_id, name, category_id, asset_tag)
  select current_setting('t.a')::uuid, current_setting('t.site_in')::uuid, 'Test bulk ok', id, ''
    from public.it_categories where account_id = current_setting('t.a')::uuid and name = 'Tablet'
  returning id into ok_id;
  insert into public.it_assets (account_id, location_id, name, category_id, asset_tag, status_label_id)
  select current_setting('t.a')::uuid, current_setting('t.site_in')::uuid, 'Test bulk broken', id, '', broken
    from public.it_categories where account_id = current_setting('t.a')::uuid and name = 'Tablet'
  returning id into bad_id;
  select id into near_area from public.it_site_areas where location_id = current_setting('t.site_in')::uuid limit 1;
  select id into far_area from public.it_site_areas where location_id = current_setting('t.site_out')::uuid limit 1;

  -- One broken item doesn't stop the batch; it fails with the reason.
  res := public.it_check_out(array[ok_id, bad_id], 'area', near_area, null, 'Morning crew');
  if (res -> 0 ->> 'ok')::boolean is not true or (res -> 1 ->> 'ok')::boolean is not false
     or (res -> 1 ->> 'error') not like '%can''t be checked out%' then
    raise exception 'FAIL 39: bulk check-out should pass the tablet and refuse the broken one: %', res;
  end if;
  if (public.it_check_out(array[ok_id], 'area', near_area) -> 0 ->> 'error') not like 'Already checked out%' then
    raise exception 'FAIL 40: a second check-out was not refused';
  end if;

  -- An area must be at the item's own site.
  update public.it_assets set status_label_id = spare where id = bad_id;
  if (public.it_check_out(array[bad_id], 'area', far_area) -> 0 ->> 'error') not like '%isn''t at this item''s site%' then
    raise exception 'FAIL 41: checked out to an area at another site';
  end if;

  -- A checked-out item doesn't move.
  if (public.it_move(array[ok_id], current_setting('t.site_out')::uuid) -> 0 ->> 'error') not like 'Checked out to%' then
    raise exception 'FAIL 42: moved an item that is checked out';
  end if;

  -- Check-in with a new status keeps the note on the status change.
  res := public.it_check_in(array[ok_id], broken, 'Cracked screen');
  if (res -> 0 ->> 'ok')::boolean is not true
     or (select status_label_id from public.it_assets where id = ok_id) <> broken
     or (select assigned_type from public.it_assets where id = ok_id) is not null then
    raise exception 'FAIL 43: check-in did not return the item with its new status: %', res;
  end if;
  if not exists (select 1 from public.it_activity_log where asset_id = ok_id and action = 'status_changed'
                 and after ->> 'note' = 'Cracked screen') then
    raise exception 'FAIL 44: the check-in note was not kept on the status change';
  end if;

  -- Retiring checks the item in first and retires its tag.
  perform public.it_check_out(array[bad_id], 'area', near_area);
  res := public.it_set_status(array[bad_id], retired, 'End of life');
  if (res -> 0 ->> 'ok')::boolean is not true
     or exists (select 1 from public.it_assignments where asset_id = bad_id and checked_in_at is null)
     or (select t.status from public.it_asset_tags t join public.it_assets a on a.asset_tag = t.tag and a.account_id = t.account_id
          where a.id = bad_id) <> 'retired' then
    raise exception 'FAIL 45: retiring did not check the item in and retire its tag: %', res;
  end if;
  perform set_config('t.bulk_ok', ok_id::text, true);
end $$;
reset role;

-- CSV import and search.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  site_name text := (select name from public.locations where id = current_setting('t.site_in')::uuid);
  rows      jsonb;
  res       jsonb;
  before_n  integer := (select count(*) from public.it_assets);
  counter_before bigint := (select coalesce(sum(last_value), 0) from public.it_tag_counters);
begin
  rows := jsonb_build_array(
    jsonb_build_object('row', 2, 'name', 'Imported router', 'site', site_name, 'category', 'Router/Firewall',
                       'manufacturer', 'Ubiquiti', 'model', 'UDM Pro Test', 'serial', 'IMP-1', 'ip', '10.0.0.1'),
    jsonb_build_object('row', 3, 'name', 'Bad mac', 'site', site_name, 'category', 'Switch', 'mac', 'not-a-mac'),
    jsonb_build_object('row', 4, 'tag', current_setting('t.tag_in'), 'site', site_name, 'notes', 'Updated by import'),
    jsonb_build_object('row', 5, 'name', 'No tag no serial', 'site', site_name, 'category', 'Display'),
    jsonb_build_object('row', 6, 'name', 'Mystery', 'site', 'Nowhere At All', 'category', 'Display'));

  -- Dry run: per-row results, nothing saved, no tag numbers used.
  res := public.it_import_assets(rows, false, '{"models": true}');
  if (res -> 0 ->> 'action') <> 'create' or (res -> 1 ->> 'action') <> 'error' or (res -> 2 ->> 'action') <> 'update'
     or (res -> 3 ->> 'action') <> 'create' or (res -> 4 ->> 'error') not like 'Site%not found' then
    raise exception 'FAIL 47: dry run gave the wrong per-row results: %', res;
  end if;
  if (select count(*) from public.it_assets) <> before_n
     or exists (select 1 from public.it_asset_models where name = 'UDM Pro Test')
     or (select coalesce(sum(last_value), 0) from public.it_tag_counters) <> counter_before then
    raise exception 'FAIL 48: a dry run saved something';
  end if;
  if (public.it_import_assets(rows, false, '{}') -> 0 ->> 'error') not like 'Model "UDM Pro Test" is new%' then
    raise exception 'FAIL 49: a new model was accepted without permission to create models';
  end if;

  -- Commit, then the same file again: no duplicates.
  perform public.it_import_assets(rows, true, '{"models": true}');
  if (select count(*) from public.it_assets) <> before_n + 2 then
    raise exception 'FAIL 50: commit should add exactly the two new items';
  end if;
  if (select notes from public.it_assets where asset_tag = current_setting('t.tag_in') and account_id = current_setting('t.a')::uuid) <> 'Updated by import' then
    raise exception 'FAIL 51: a row with an existing tag did not update it';
  end if;
  res := public.it_import_assets(rows, true, '{"models": true}');
  if (select count(*) from public.it_assets) <> before_n + 2
     or (res -> 0 ->> 'action') <> 'update' or (res -> 3 ->> 'action') <> 'update' then
    raise exception 'FAIL 52: importing the same file twice made duplicates: %', res;
  end if;
  if not exists (select 1 from public.it_activity_log where action = 'imported' and entity_type = 'asset'
                 and after ->> 'name' = 'Imported router') then
    raise exception 'FAIL 53: imported rows were not logged as imported';
  end if;

  -- Search: exact tag first, and by model name.
  if not coalesce((select exact from public.it_search(lower(current_setting('t.tag_in'))) limit 1), false) then
    raise exception 'FAIL 54: an exact tag search was not flagged exact';
  end if;
  if not exists (select 1 from public.it_search('UDM Pro') where name = 'Imported router') then
    raise exception 'FAIL 55: search did not find an item by its model';
  end if;
  if public.it_log_import('{"entity": "assets", "file": "test.csv"}') is null then
    raise exception 'FAIL 56: the import summary was not logged';
  end if;
end $$;
reset role;

-- Imports check site access themselves (they run with owner rights for speed).
-- Names the manager can't look up are read here first, as the owner of the db.
select set_config('t.site_out_name', (select name from public.locations where id = current_setting('t.site_out')::uuid), true);
select set_config('t.site_in_name', (select name from public.locations where id = current_setting('t.site_in')::uuid), true);
select set_config('t.tag_out', (select asset_tag from public.it_assets where id = current_setting('t.asset_out')::uuid), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_mgr'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  res jsonb;
begin
  res := public.it_import_assets(jsonb_build_array(
    jsonb_build_object('row', 2, 'name', 'Sneaky import', 'site', current_setting('t.site_out_name'), 'category', 'Display'),
    jsonb_build_object('row', 3, 'tag', current_setting('t.tag_out'), 'site', current_setting('t.site_in_name'), 'notes', 'pulled over')
  ), true, '{}');
  if (res -> 0 ->> 'error') not like 'You don''t manage%' then
    raise exception 'FAIL 57: a manager imported into a site they don''t manage: %', res;
  end if;
  if (res -> 1 ->> 'error') not like '%site you don''t manage%' then
    raise exception 'FAIL 58: a manager pulled another site''s item in through an import: %', res;
  end if;
  if (public.it_import_subscriptions(jsonb_build_array(jsonb_build_object('row', 2, 'name', 'Company-wide thing')), true, '{}') -> 0 ->> 'error')
     not like 'Only an admin%' then
    raise exception 'FAIL 59: a manager added an every-site subscription';
  end if;
end $$;
reset role;

-- Secret custom fields: Vault-backed, owner-only, every reveal logged.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  fid uuid;
begin
  insert into public.it_custom_fields (account_id, name, key, field_type)
  values (current_setting('t.a')::uuid, 'Admin password', 'admin_password_test', 'secret') returning id into fid;
  perform set_config('t.secret_field', fid::text, true);
  perform public.it_set_secret(current_setting('t.asset_in')::uuid, fid, 'hunter2-test');
  if public.it_reveal_secret(current_setting('t.asset_in')::uuid, fid) <> 'hunter2-test' then
    raise exception 'FAIL 60: the owner could not read back a secret';
  end if;
  if not exists (select 1 from public.it_activity_log where asset_id = current_setting('t.asset_in')::uuid and action = 'secret_revealed') then
    raise exception 'FAIL 61: revealing a secret was not logged';
  end if;
  if exists (select 1 from public.it_activity_log where after::text like '%hunter2-test%' or before::text like '%hunter2-test%') then
    raise exception 'FAIL 62: a secret value leaked into the activity log';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_mgr'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.it_reveal_secret(current_setting('t.asset_in')::uuid, current_setting('t.secret_field')::uuid);
  raise exception 'FAIL 63: a manager revealed a secret';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;
do $$ begin
  if exists (select 1 from public.it_asset_secrets) then
    raise exception 'FAIL 64: a manager can read the secrets table';
  end if;
end $$;
reset role;

-- Crew can't check things out.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_emp'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if coalesce((public.it_check_out(array[current_setting('t.asset_in')::uuid], 'site', current_setting('t.site_in')::uuid) -> 0 ->> 'ok')::boolean, false) then
    raise exception 'FAIL 46: an employee checked something out';
  end if;
end $$;
reset role;

-- ---- Overview numbers, supplies, device health, reminders (slice F) ----------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
with x as (
  insert into public.it_assets (account_id, location_id, name, category_id)
  select current_setting('t.a')::uuid, current_setting('t.site_in')::uuid, 'Test tablet F', id
    from public.it_categories where account_id = current_setting('t.a')::uuid and name = 'Tablet'
  returning id
) select set_config('t.tablet', id::text, true) from x;
do $$
declare
  o jsonb := public.it_overview();
begin
  if (o ->> 'total')::int <> (select count(*) from public.it_assets a
                                left join public.it_status_labels s on s.id = a.status_label_id
                               where a.deleted_at is null and coalesce(s.type, '') <> 'archived') then
    raise exception 'FAIL 65: the overview total doesn''t match the owner''s active equipment';
  end if;
  if (select sum((e ->> 'total')::int) from jsonb_array_elements(o -> 'by_site') e) <> (o ->> 'total')::int then
    raise exception 'FAIL 66: the owner''s site rows don''t add up to the total';
  end if;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_mgr'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  o jsonb := public.it_overview();
begin
  if exists (select 1 from jsonb_array_elements(o -> 'by_site') e where e ->> 'id' <> current_setting('t.site_in')) then
    raise exception 'FAIL 69: a manager''s overview counts another site';
  end if;
  begin
    perform * from public.it_reminder_candidates(current_setting('t.a')::uuid, current_date, 60);
    raise exception 'FAIL 72: a manager read reminder candidates';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
-- Supplies: an uncounted supply is never low; counting, using and restocking
-- move it in and out of low, and none of that reads as an edit.
do $$
declare
  cid uuid;
  c   public.it_consumables%rowtype;
begin
  select id into cid from public.it_consumables
   where location_id = current_setting('t.site_in')::uuid and is_sticker_stock and deleted_at is null;
  select * into c from public.it_consumables where id = cid;
  if c.low_since is not null or c.counted_at is not null then
    raise exception 'FAIL 73: an uncounted supply shows as low';
  end if;
  if c.qty_on_hand <> 10 then
    insert into public.it_consumable_events (account_id, consumable_id, delta, reason, note)
    values (current_setting('t.a')::uuid, cid, 10 - c.qty_on_hand, 'adjustment', 'Counted');
  end if;
  select * into c from public.it_consumables where id = cid;
  if c.qty_on_hand <> 10 or c.counted_at is null or c.low_since is distinct from current_date then
    raise exception 'FAIL 74: counting 10 against a minimum of 25 should mark it low today (qty %, low %)', c.qty_on_hand, c.low_since;
  end if;
  insert into public.it_consumable_events (account_id, consumable_id, delta, reason)
  values (current_setting('t.a')::uuid, cid, 50, 'restock');
  if (select low_since from public.it_consumables where id = cid) is not null then
    raise exception 'FAIL 75: restocking above the minimum did not clear low';
  end if;
  insert into public.it_consumable_events (account_id, consumable_id, delta, reason)
  values (current_setting('t.a')::uuid, cid, -40, 'used');
  if (select low_since from public.it_consumables where id = cid) is distinct from current_date then
    raise exception 'FAIL 76: using stock down to the minimum did not mark it low';
  end if;
  if exists (select 1 from public.it_activity_log where entity_type = 'consumable' and entity_id = cid and action = 'updated') then
    raise exception 'FAIL 77: stock moves were logged as edits';
  end if;
  if ((public.it_overview(current_setting('t.site_in')::uuid) -> 'attention' ->> 'low_stock')::int) < 1 then
    raise exception 'FAIL 78: the overview does not count the low supply';
  end if;
  perform set_config('t.stock', cid::text, true);
end $$;
reset role;

-- Not working: crew report it, it shows on the Timeline with their note, and
-- marking it working clears it. People can't record anything but manual reports.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_emp'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if current_setting('t.site_in') = any (string_to_array(current_setting('t.emp_locs'), ',')) then
    insert into public.it_health_events (account_id, asset_id, state, source, note)
    values (current_setting('t.a')::uuid, current_setting('t.tablet')::uuid, 'offline', 'manual', 'Screen is cracked');
    begin
      insert into public.it_health_events (account_id, asset_id, state, source)
      values (current_setting('t.a')::uuid, current_setting('t.tablet')::uuid, 'online', 'heartbeat');
      raise exception 'FAIL 86: a person recorded a heartbeat';
    exception when others then
      if sqlerrm like 'FAIL%' then raise; end if;
    end;
  else
    -- The demo employee works elsewhere; record the report as the manager instead.
    perform set_config('t.emp_not_here', '1', true);
  end if;
end $$;
reset role;
do $$ begin
  if current_setting('t.emp_not_here', true) = '1' then
    insert into public.it_health_events (account_id, asset_id, state, source, note, created_by)
    values (current_setting('t.a')::uuid, current_setting('t.tablet')::uuid, 'offline', 'manual', 'Screen is cracked',
            current_setting('t.a_mgr')::uuid);
  end if;
  if (select health_state from public.it_assets where id = current_setting('t.tablet')::uuid) <> 'offline' then
    raise exception 'FAIL 87: reporting it not working did not mark it';
  end if;
  if not exists (select 1 from public.it_activity_log where asset_id = current_setting('t.tablet')::uuid
                  and action = 'health_changed' and after ->> 'note' = 'Screen is cracked') then
    raise exception 'FAIL 88: the report''s note is not on the Timeline';
  end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_mgr'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if ((public.it_overview(current_setting('t.site_in')::uuid) -> 'attention' ->> 'not_working')::int) < 1 then
    raise exception 'FAIL 89: the overview does not count the item reported not working';
  end if;
end $$;
insert into public.it_health_events (account_id, asset_id, state, source, note)
values (current_setting('t.a')::uuid, current_setting('t.tablet')::uuid, 'online', 'manual', 'Replaced the screen');
do $$ begin
  if (select health_state from public.it_assets where id = current_setting('t.tablet')::uuid) <> 'unknown' then
    raise exception 'FAIL 90: marking it working did not clear the report';
  end if;
end $$;
reset role;

-- Reminder candidates: warranty, renewal (on the cancel-by date) and low stock.
do $$
declare
  sid uuid;
begin
  update public.it_assets set warranty_end_date = current_date + 30 where id = current_setting('t.tablet')::uuid;
  insert into public.it_subscriptions (account_id, location_id, name, cost, billing_cycle, renewal_date, auto_renew, cancel_notice_days)
  values (current_setting('t.a')::uuid, current_setting('t.site_in')::uuid, 'Test ISP', 120, 'monthly', current_date + 40, true, 30)
  returning id into sid;
  if not exists (select 1 from public.it_reminder_candidates(current_setting('t.a')::uuid, current_date, 60)
                  where kind = 'warranty' and entity_id = current_setting('t.tablet')::uuid and due_date = current_date + 30) then
    raise exception 'FAIL 93: a warranty ending in 30 days is not a reminder candidate';
  end if;
  if not exists (select 1 from public.it_reminder_candidates(current_setting('t.a')::uuid, current_date, 60)
                  where kind = 'subscription_renewal' and entity_id = sid and due_date = current_date + 10) then
    raise exception 'FAIL 94: an auto-renewing subscription is not due on its cancel-by date';
  end if;
  if not exists (select 1 from public.it_reminder_candidates(current_setting('t.a')::uuid, current_date, 60)
                  where kind = 'low_stock' and entity_id = current_setting('t.stock')::uuid) then
    raise exception 'FAIL 95: a low supply is not a reminder candidate';
  end if;
  if exists (select 1 from public.it_reminder_candidates(current_setting('t.a')::uuid, current_date, 60) c
              join public.it_assets a on a.id = c.entity_id where a.account_id <> current_setting('t.a')::uuid) then
    raise exception 'FAIL 96: reminder candidates include another account''s equipment';
  end if;
end $$;

-- ---- Signed out -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
set local role anon;
do $$ begin
  perform public.it_bootstrap();
  raise exception 'FAIL 29: anon ran it_bootstrap';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;
do $$ begin
  if exists (select 1 from public.it_assets) then
    raise exception 'FAIL 30: anon can read assets';
  end if;
exception when insufficient_privilege then null;
end $$;
do $$ begin
  if coalesce((public.it_overview() ->> 'total')::int, 0) > 0 then
    raise exception 'FAIL 97: anon can count equipment';
  end if;
exception when insufficient_privilege then null;
end $$;
reset role;

select 'ALL PASS' as result;
rollback;
