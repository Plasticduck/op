-- A site's other addresses (migration 0258): seen by whoever can see the site,
-- changed only by Admins on their own account's sites. Throwaway logins; the final
-- exception carries the results, so nothing here is ever committed.
do $$
declare
  acct uuid := '54f3e299-1f61-4ed2-9921-3d02160b72e6';
  other_acct uuid;
  mw34 uuid;
  mw33 uuid;
  other_site uuid;
  foreign_site uuid;
  owner_id uuid := gen_random_uuid();
  mgr34 uuid := gen_random_uuid();
  mgr_else uuid := gen_random_uuid();
  emp34 uuid := gen_random_uuid();
  fails text[] := '{}';
  passed int := 0;
  n int;
  new_id uuid;
begin
  select id into mw34 from public.locations where account_id = acct and name = 'MW34';
  select id into mw33 from public.locations where account_id = acct and name = 'MW33';
  select id into other_site from public.locations where account_id = acct and not archived and name not in ('MW33', 'MW34') and it_scope is null limit 1;
  select l.account_id, l.id into other_acct, foreign_site from public.locations l where l.account_id <> acct limit 1;

  insert into auth.users (id, email, instance_id, aud, role) values
    (owner_id, 'rollback-la-owner@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (mgr34, 'rollback-la-mgr34@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (mgr_else, 'rollback-la-mgrelse@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (emp34, 'rollback-la-emp34@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  insert into public.users (id, account_id, location_ids, role, name, email) values
    (owner_id, acct, '{}', 'owner', 'Rollback Owner', 'rollback-la-owner@example.invalid'),
    (mgr34, acct, array[mw34], 'manager', 'Rollback Mgr 34', 'rollback-la-mgr34@example.invalid'),
    (mgr_else, acct, array[other_site], 'manager', 'Rollback Mgr Else', 'rollback-la-mgrelse@example.invalid'),
    (emp34, acct, array[mw34], 'employee', 'Rollback Emp 34', 'rollback-la-emp34@example.invalid');

  execute 'set local role authenticated';

  -- Seen by whoever can see the site.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  select count(*) into n from public.location_addresses;
  if n = 3 then passed := passed + 1; else fails := fails || format('owner sees %s, want 3', n); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', mgr34, 'role', 'authenticated')::text, true);
  select count(*) into n from public.location_addresses;
  if n = 2 then passed := passed + 1; else fails := fails || format('MW34 manager sees %s, want 2', n); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', emp34, 'role', 'authenticated')::text, true);
  select count(*) into n from public.location_addresses;
  if n = 2 then passed := passed + 1; else fails := fails || format('MW34 employee sees %s, want 2', n); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', mgr_else, 'role', 'authenticated')::text, true);
  select count(*) into n from public.location_addresses;
  if n = 0 then passed := passed + 1; else fails := fails || format('other-site manager sees %s, want 0', n); end if;

  -- A manager can't add, change or remove one.
  perform set_config('request.jwt.claims', json_build_object('sub', mgr34, 'role', 'authenticated')::text, true);
  begin
    insert into public.location_addresses (account_id, location_id, address) values (acct, mw34, 'TEST manager add');
    fails := fails || 'manager could add'::text;
  exception when others then passed := passed + 1;
  end;
  update public.location_addresses set address = 'TEST changed' where location_id = mw34;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else fails := fails || 'manager could change'::text; end if;
  delete from public.location_addresses where location_id = mw34;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else fails := fails || 'manager could remove'::text; end if;

  -- An Admin can, on their own account's sites only.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  insert into public.location_addresses (account_id, location_id, address, latitude, longitude)
    values (acct, mw33, 'TEST owner add', 36.0, -102.5) returning id into new_id;
  if new_id is not null then passed := passed + 1; else fails := fails || 'owner could not add'::text; end if;
  delete from public.location_addresses where id = new_id;
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; else fails := fails || 'owner could not remove'::text; end if;
  begin
    insert into public.location_addresses (account_id, location_id, address) values (other_acct, mw34, 'TEST other account');
    fails := fails || 'owner wrote another account'::text;
  exception when others then passed := passed + 1;
  end;
  if foreign_site is not null then
    begin
      -- Own account id, but a site of another account.
      insert into public.location_addresses (account_id, location_id, address) values (acct, foreign_site, 'TEST foreign site');
      fails := fails || 'owner attached to a foreign site'::text;
    exception when others then passed := passed + 1;
    end;
  else
    fails := fails || 'no foreign site to test with'::text;
  end if;
  begin
    insert into public.location_addresses (account_id, location_id, address) values (acct, mw34, '   ');
    fails := fails || 'blank address accepted'::text;
  exception when others then passed := passed + 1;
  end;

  execute 'reset role';
  raise exception 'RESULT passed=% of 12 FAILS=%', passed, fails;
end $$;
