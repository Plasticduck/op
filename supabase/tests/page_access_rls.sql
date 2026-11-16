-- Page access (migration 0241): only the super admin writes, people read what
-- applies to them, and the grant helpers resolve person-then-role.
--
-- Runs inside a transaction that is rolled back, so it leaves nothing behind.
-- Uses Mighty Wash (the super admin's account): the super admin, another Admin,
-- a manager and a regional manager. Any failure raises "FAIL n"; success ends ALL PASS.
--
--   sql.sh supabase/tests/page_access_rls.sql

begin;

select set_config('t.acct', '54f3e299-1f61-4ed2-9921-3d02160b72e6', true);
select set_config('t.super', (select id::text from public.users where lower(email) = 'kevan@washlyfe.com'), true);
select set_config('t.owner', (select id::text from public.users where account_id = current_setting('t.acct')::uuid and role = 'owner' and lower(email) <> 'kevan@washlyfe.com' limit 1), true);
select set_config('t.mgr', (select id::text from public.users where account_id = current_setting('t.acct')::uuid and role = 'manager' and role_category is null limit 1), true);
select set_config('t.emp', (select id::text from public.users where account_id = current_setting('t.acct')::uuid and role_category = 'regional_manager' limit 1), true);

do $$
declare
  sup uuid := current_setting('t.super')::uuid;
  own uuid := current_setting('t.owner')::uuid;
  mgr uuid := current_setting('t.mgr')::uuid;
  emp uuid := current_setting('t.emp')::uuid;
  n int;
begin
  if sup is null or own is null or mgr is null or emp is null then raise exception 'FAIL 0: test users missing'; end if;

  -- Another Admin can't write.
  perform set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.page_access_save(jsonb_build_array(jsonb_build_object('user_id', mgr, 'page', '/app/bonuses', 'allowed', true)));
    raise exception 'FAIL 1: a non-super Admin saved page access';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  execute 'reset role';

  -- The super admin grants the manager two pages, blocks one for every regional manager,
  -- and can't touch their own access or write the table directly.
  perform set_config('request.jwt.claims', json_build_object('sub', sup, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  n := public.page_access_save(jsonb_build_array(
    jsonb_build_object('user_id', mgr, 'page', '/app/bonuses', 'allowed', true),
    jsonb_build_object('user_id', mgr, 'page', '/app/hr/salaried-labor', 'allowed', true),
    jsonb_build_object('perm_role', 'regional_manager', 'page', '/app/checklists', 'allowed', false),
    jsonb_build_object('perm_role', 'manager', 'page', '/app/households', 'allowed', true)));
  if n <> 4 then raise exception 'FAIL 2: saved % changes', n; end if;
  -- Saving again updates in place (no duplicates), and null removes.
  perform public.page_access_save(jsonb_build_array(
    jsonb_build_object('user_id', mgr, 'page', '/app/bonuses', 'allowed', true),
    jsonb_build_object('user_id', mgr, 'page', '/app/hr/salaried-labor', 'allowed', null)));
  if (select count(*) from public.page_access where user_id = mgr) <> 1 then raise exception 'FAIL 3: upsert or remove'; end if;
  begin
    perform public.page_access_save(jsonb_build_array(jsonb_build_object('user_id', sup, 'page', '/app/bonuses', 'allowed', false)));
    raise exception 'FAIL 4: the super admin changed their own access';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    insert into public.page_access (account_id, user_id, page, allowed) values (current_setting('t.acct')::uuid, emp, '/app/bonuses', true);
    raise exception 'FAIL 5: wrote the table directly';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  if (select count(*) from public.page_access) <> 3 then raise exception 'FAIL 6: super admin should read every row'; end if;
  execute 'reset role';

  -- The manager reads their own row and their role's row, and the helper resolves.
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if (select count(*) from public.page_access) <> 2 then raise exception 'FAIL 7: manager reads % rows', (select count(*) from public.page_access); end if;
  if not public.auth_page_granted('/app/bonuses') then raise exception 'FAIL 8: own grant'; end if;
  if not public.auth_page_granted('/app/households') then raise exception 'FAIL 9: role grant'; end if;
  if public.auth_page_granted('/app/commissions') then raise exception 'FAIL 10: ungranted page'; end if;
  execute 'reset role';

  -- The regional manager sees only their role's row.
  perform set_config('request.jwt.claims', json_build_object('sub', emp, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if (select count(*) from public.page_access) <> 1 then raise exception 'FAIL 11: regional manager reads % rows', (select count(*) from public.page_access); end if;
  if public.auth_page_granted('/app/checklists') then raise exception 'FAIL 12: a block read as a grant'; end if;
  begin
    perform public.page_granted_for(mgr, '/app/bonuses');
    raise exception 'FAIL 13: a user called the service-role helper';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  execute 'reset role';

  -- The service-role helper (edge functions).
  execute 'set local role service_role';
  if not public.page_granted_for(mgr, '/app/bonuses') or public.page_granted_for(emp, '/app/bonuses') then
    raise exception 'FAIL 14: page_granted_for';
  end if;
  execute 'reset role';

  -- Migration 0242: a Goal Tracker grant opens its data to a manager; the
  -- Dashboard can't be stored.
  insert into public.exec_goals (account_id, quarter, owner_name, title, start_date, due_date)
  values (current_setting('t.acct')::uuid, '2099-Q1', 'Test', 'RLS test goal', '2099-01-01', '2099-03-31');
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if (select count(*) from public.exec_goals where quarter = '2099-Q1') <> 0 then raise exception 'FAIL 15: ungranted manager read goals'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', sup, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.page_access_save(jsonb_build_array(jsonb_build_object('user_id', mgr, 'page', '/app/goal-tracker', 'allowed', true)));
  begin
    perform public.page_access_save(jsonb_build_array(jsonb_build_object('user_id', mgr, 'page', '/app/dashboard', 'allowed', false)));
    raise exception 'FAIL 16: blocked the Dashboard';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if (select count(*) from public.exec_goals where quarter = '2099-Q1') <> 1 then raise exception 'FAIL 17: granted manager cannot read goals'; end if;
  execute 'reset role';
end $$;

select 'ALL PASS' as result;
rollback;
