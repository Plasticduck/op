-- Truck photos (migrations 0263-0264): the super admin, anyone granted the Fleet
-- Map, and every Admin (Fleet Management) can add and see them; any other login
-- can't. Uses throwaway logins; the final exception carries the results, so
-- nothing is kept.
do $$
declare
  acct uuid := '54f3e299-1f61-4ed2-9921-3d02160b72e6';
  kevan uuid;
  granted uuid := gen_random_uuid();
  admin_no uuid := gen_random_uuid();
  mgr_no uuid := gen_random_uuid();
  fails text[] := '{}';
  passed int := 0;
  n int;
begin
  select id into kevan from public.users where lower(email) = 'kevan@washlyfe.com';
  insert into auth.users (id, email, instance_id, aud, role) values
    (granted, 'rollback-fleet-granted@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (admin_no, 'rollback-fleet-admin@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (mgr_no, 'rollback-fleet-mgr@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  insert into public.users (id, account_id, location_ids, role, name, email) values
    (granted, acct, '{}', 'manager', 'Rollback Granted', 'rollback-fleet-granted@example.invalid'),
    (admin_no, acct, '{}', 'owner', 'Rollback Admin', 'rollback-fleet-admin@example.invalid'),
    (mgr_no, acct, '{}', 'manager', 'Rollback Manager', 'rollback-fleet-mgr@example.invalid');
  insert into public.page_access (account_id, user_id, page, allowed) values (acct, granted, '/app/fleet-map', true);

  execute 'set local role authenticated';

  -- Kevan adds one and sees it.
  perform set_config('request.jwt.claims', json_build_object('sub', kevan, 'role', 'authenticated', 'email', 'kevan@washlyfe.com')::text, true);
  insert into public.fleet_vehicle_photos (account_id, vehicle_number, path) values (acct, 'TEST1', acct::text || '/TEST1-1.jpg');
  select count(*) into n from public.fleet_vehicle_photos where vehicle_number = 'TEST1';
  if n = 1 then passed := passed + 1; else fails := fails || 'kevan cannot see his photo'::text; end if;
  begin
    insert into public.fleet_vehicle_photos (account_id, vehicle_number, path) values (acct, 'TEST2', 'elsewhere/TEST2.jpg');
    fails := fails || 'path outside the account folder accepted'::text;
  exception when others then passed := passed + 1;
  end;

  -- A manager granted the Fleet Map sees it and can replace it.
  perform set_config('request.jwt.claims', json_build_object('sub', granted, 'role', 'authenticated', 'email', 'rollback-fleet-granted@example.invalid')::text, true);
  select count(*) into n from public.fleet_vehicle_photos where vehicle_number = 'TEST1';
  if n = 1 then passed := passed + 1; else fails := fails || 'granted person cannot see'::text; end if;
  update public.fleet_vehicle_photos set path = acct::text || '/TEST1-2.jpg' where vehicle_number = 'TEST1';
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; else fails := fails || 'granted person cannot replace'::text; end if;

  -- An Admin with no grant (Fleet Management) sees it and can add one.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_no, 'role', 'authenticated', 'email', 'rollback-fleet-admin@example.invalid')::text, true);
  select count(*) into n from public.fleet_vehicle_photos where vehicle_number = 'TEST1';
  if n = 1 then passed := passed + 1; else fails := fails || 'admin cannot see'::text; end if;
  begin
    insert into public.fleet_vehicle_photos (account_id, vehicle_number, path) values (acct, 'TEST3', acct::text || '/TEST3.jpg');
    passed := passed + 1;
  exception when others then fails := fails || ('admin could not add: ' || sqlerrm);
  end;

  -- A manager with no grant sees nothing and can't add, change or remove.
  perform set_config('request.jwt.claims', json_build_object('sub', mgr_no, 'role', 'authenticated', 'email', 'rollback-fleet-mgr@example.invalid')::text, true);
  select count(*) into n from public.fleet_vehicle_photos;
  if n = 0 then passed := passed + 1; else fails := fails || format('ungranted manager sees %s', n); end if;
  begin
    insert into public.fleet_vehicle_photos (account_id, vehicle_number, path) values (acct, 'TEST4', acct::text || '/TEST4.jpg');
    fails := fails || 'ungranted manager could add'::text;
  exception when others then passed := passed + 1;
  end;
  delete from public.fleet_vehicle_photos where vehicle_number = 'TEST1';
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else fails := fails || 'ungranted manager could remove'::text; end if;

  -- Storage follows the same rule.
  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('fleet-photos', acct::text || '/TEST5.jpg', mgr_no::text);
    fails := fails || 'ungranted manager could upload a file'::text;
  exception when others then passed := passed + 1;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_no, 'role', 'authenticated', 'email', 'rollback-fleet-admin@example.invalid')::text, true);
  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('fleet-photos', acct::text || '/TEST6.jpg', admin_no::text);
    passed := passed + 1;
  exception when others then fails := fails || ('admin could not upload: ' || sqlerrm);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', kevan, 'role', 'authenticated', 'email', 'kevan@washlyfe.com')::text, true);
  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('fleet-photos', gen_random_uuid()::text || '/TEST7.jpg', kevan::text);
    fails := fails || 'upload outside the account folder accepted'::text;
  exception when others then passed := passed + 1;
  end;

  execute 'reset role';
  raise exception 'RESULT passed=% of 12 FAILS=%', passed, fails;
end $$;
