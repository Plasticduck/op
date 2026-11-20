-- Operator AI's SQL tool takes queries wrapped in line breaks, tabs and spaces
-- (migration 0257), and still refuses everything it refused before. Creates throwaway
-- logins and rolls everything back: the final exception carries the results.
do $$
declare
  acct uuid := '54f3e299-1f61-4ed2-9921-3d02160b72e6';
  all_sites uuid[];
  mgr uuid := gen_random_uuid();
  disp uuid := gen_random_uuid();
  fails text[] := '{}';
  passed int := 0;
  r jsonb;
  q text;
begin
  select array_agg(id) into all_sites from public.locations where account_id = acct and not archived;
  insert into auth.users (id, email, instance_id, aud, role) values
    (mgr, 'rollback-trim-mgr@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (disp, 'rollback-trim-disp@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  insert into public.users (id, account_id, location_ids, role, role_category, name, email) values
    (mgr, acct, all_sites, 'manager', null, 'Rollback Manager', 'rollback-trim-mgr@example.invalid'),
    (disp, acct, all_sites, 'manager', 'corporate_display', 'Rollback Display', 'rollback-trim-disp@example.invalid');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);

  -- Answers, however the query is wrapped.
  foreach q in array array[
    'select name from locations limit 1',
    E'\nSELECT name FROM locations LIMIT 1',
    E'\n\t  select name from locations limit 1\n',
    E'\r\nWITH a AS (select name from locations limit 1) select * from a',
    E'\nselect\n  name\nfrom locations\nlimit 1\n',
    E'select name from locations limit 1;\n',
    E'\nselect name from locations limit 1\n;\n\n'
  ] loop
    begin
      r := public.operator_ask_sql(q);
      if jsonb_array_length(r) = 1 then passed := passed + 1;
      else fails := fails || ('WRONG ROWS: ' || replace(q, E'\n', '\n')); end if;
    exception when others then
      fails := fails || ('REFUSED: ' || replace(q, E'\n', '\n') || ' -> ' || sqlerrm);
    end;
  end loop;

  -- Still refused, line breaks or not.
  foreach q in array array[
    '',
    E'\n\n',
    E'\nupdate locations set name = name',
    E'\n\ndelete from locations',
    E'\nselect 1 as x; select 2 as y',
    E'\nselect 1 as x;\n;',
    E'\nwith x as (delete from locations returning *) select * from x',
    E'\nselect 1 as x\n; drop table locations'
  ] loop
    begin
      r := public.operator_ask_sql(q);
      fails := fails || ('NOT REFUSED: ' || replace(q, E'\n', '\n'));
    exception when others then
      passed := passed + 1;
    end;
  end loop;

  -- The shared office login still can't read pay, with or without a line break first.
  perform set_config('request.jwt.claims', json_build_object('sub', disp, 'role', 'authenticated')::text, true);
  foreach q in array array[
    E'\nselect hourly_rate from employees',
    E'\n\tselect * from public.employees',
    E'\nselect * from tips'
  ] loop
    begin
      r := public.operator_ask_sql(q);
      fails := fails || ('DISPLAY NOT REFUSED: ' || replace(q, E'\n', '\n'));
    exception when others then
      if sqlerrm ~ 'cannot read' then passed := passed + 1;
      else fails := fails || ('DISPLAY WRONG ERROR: ' || replace(q, E'\n', '\n') || ' -> ' || sqlerrm); end if;
    end;
  end loop;
  r := public.operator_ask_sql(E'\nselect * from employees limit 5\n');
  if r::text ~* 'hourly_rate' then fails := fails || 'display saw pay'::text; else passed := passed + 1; end if;

  execute 'reset role';
  raise exception 'RESULT passed=% of 19 FAILS=%', passed, fails;
end $$;
