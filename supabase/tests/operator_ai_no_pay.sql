-- Operator AI's SQL tool can't read pay, injury reports, counseling records or
-- performance reviews on a Corporate Display login, and is unchanged for everyone else.
-- Creates throwaway logins and rolls everything back: the final exception carries the
-- results, so no outcome of this test is ever committed.
do $$
declare
  acct uuid := '54f3e299-1f61-4ed2-9921-3d02160b72e6';
  all_sites uuid[];
  one_site uuid;
  disp uuid := gen_random_uuid();
  disp_one uuid := gen_random_uuid();
  mgr uuid := gen_random_uuid();
  fails text[] := '{}';
  passed int := 0;
  r jsonb;
  q text;
  n_all int;
  n_one int;
  n_mgr int;
begin
  select array_agg(id) into all_sites from public.locations where account_id = acct and not archived;
  select l into one_site from unnest(all_sites) l
    where (select count(*) from public.employees e where e.location_id = l) > 0 limit 1;

  insert into auth.users (id, email, instance_id, aud, role) values
    (disp, 'rollback-disp@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (disp_one, 'rollback-disp-one@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (mgr, 'rollback-mgr@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  insert into public.users (id, account_id, location_ids, role, role_category, name, email) values
    (disp, acct, all_sites, 'manager', 'corporate_display', 'Rollback Display', 'rollback-disp@example.invalid'),
    (disp_one, acct, array[one_site], 'manager', 'corporate_display', 'Rollback Display One', 'rollback-disp-one@example.invalid'),
    (mgr, acct, all_sites, 'manager', null, 'Rollback Manager', 'rollback-mgr@example.invalid');

  execute 'set local role authenticated';

  -- ---- Corporate Display: refused ----
  perform set_config('request.jwt.claims', json_build_object('sub', disp, 'role', 'authenticated')::text, true);
  foreach q in array array[
    'select hourly_rate from employees',
    'SELECT "HOURLY_RATE" from employees',
    'select first_name, hourly_rate * 40 as weekly from employees',
    'with x as (select hourly_rate from employees) select * from x',
    'select pin_hash from employees',
    'select hourly_rate from work_order_time_entries',
    'select * from tips',
    'select sum(amount_cents) as total from tips',
    'select * from gm_bonus_months',
    'select * from gm_bonus_base',
    'select * from event_pay_requests',
    'select * from per_diem_requests',
    'select * from mileage_requests',
    'select * from public.employees',
    'select * from "public"."employees"',
    'select * from public /* x */ . employees',
    'select * from pg_stats',
    'select * from pg_catalog.pg_class',
    'select * from information_schema.columns',
    $q$select query_to_xml('select 1', true, true, '')$q$,
    $q$select set_config('search_path', 'public', true)$q$,
    $q$select * from ts_stat('select to_tsvector(first_name) from employees')$q$,
    'select U&"hourly\005frate" from employees',
    'select * from injury_reports',
    'select severity, count(*) as n from injury_reports group by severity',
    'select * from counseling_records',
    'select * from reviews',
    'select rating from reviews',
    'select e.first_name from employees e, reviews r',
    'select e.first_name from employees e join injury_reports i on i.employee_id = e.id',
    'with c as (select * from counseling_records) select * from c',
    'select * from public.injury_reports',
    'select * from public.counseling_records',
    'select * from "public"."reviews"'
  ] loop
    begin
      r := public.operator_ask_sql(q);
      fails := fails || ('NOT REFUSED: ' || q);
    exception when others then
      passed := passed + 1;
    end;
  end loop;

  -- Refused because of the block itself, not because of some other error. These are
  -- tested by count: counseling and reviews can be empty, which must not read as a pass.
  foreach q in array array[
    'select count(*) as n from injury_reports',
    'select count(*) as n from counseling_records',
    'select count(*) as n from reviews'
  ] loop
    begin
      r := public.operator_ask_sql(q);
      fails := fails || ('NOT REFUSED: ' || q);
    exception when others then
      if sqlerrm ~ 'cannot read' then passed := passed + 1;
      else fails := fails || ('WRONG ERROR: ' || q || ' -> ' || sqlerrm); end if;
    end;
  end loop;

  -- ---- Corporate Display: answers, without pay anywhere in the result ----
  foreach q in array array[
    'select * from employees limit 25',
    'select e.* from employees e limit 25',
    'select to_jsonb(e) as row from employees e limit 25',
    'select row_to_json(e) as row from employees e limit 25',
    'select * from work_order_time_entries limit 25'
  ] loop
    begin
      r := public.operator_ask_sql(q);
      if r::text ~* 'hourly_rate|pin_hash' then fails := fails || ('PAY IN RESULT: ' || q);
      else passed := passed + 1; end if;
    exception when others then
      fails := fails || ('ERROR: ' || q || ' -> ' || sqlerrm);
    end;
  end loop;

  -- A whole row cast to text carries the view's columns only, never the rate.
  r := public.operator_ask_sql('select e::text as row from employees e limit 1');
  if r::text ~* '17\.|hourly' then fails := fails || 'row cast may hold pay'::text; else passed := passed + 1; end if;

  -- Ordinary questions still work on this login.
  foreach q in array array[
    $q$select e.first_name || ' ' || e.last_name as person, l.name as site from employees e join locations l on l.id = e.location_id limit 5$q$,
    'select count(*) as n from employees',
    'select count(*) as n from work_orders',
    'select count(*) as n from site_violations',
    'select site, sum(cars) as cars, sum(labor_cost) as labor from site_performance_days group by site limit 5',
    'select name from locations limit 5',
    'select tips_enabled from locations limit 1',
    'select count(*) as reviews from gatherup_reviews',
    'select l.name as site, count(*) as reviews from locations l group by l.name limit 1',
    'select name, google_rating, google_rating_count as reviews from locations limit 1'
  ] loop
    begin
      r := public.operator_ask_sql(q);
      if jsonb_array_length(r) = 0 then fails := fails || ('NO ROWS: ' || q); else passed := passed + 1; end if;
    exception when others then
      fails := fails || ('BROKE: ' || q || ' -> ' || sqlerrm);
    end;
  end loop;

  -- People insights are gone for this login; the operations ones remain.
  if (public.operator_ask_sql($q$select count(*) as n from ai_insights where category = 'people'$q$) -> 0 ->> 'n')::int <> 0
    then fails := fails || 'display saw people insights'::text; else passed := passed + 1; end if;
  if (public.operator_ask_sql($q$select count(*) as n from ai_insights$q$) -> 0 ->> 'n')::int = 0
    then fails := fails || 'display lost ops insights'::text; else passed := passed + 1; end if;
  if (public.operator_ask_sql($q$select jsonb_agg(i.insight_text) as insight_texts from ai_insights i$q$))::text ~* 'null hourly_rate'
    then fails := fails || 'display insight mentions pay'::text; else passed := passed + 1; end if;

  -- Row-level security still applies through the views.
  n_all := (public.operator_ask_sql('select count(*) as n from employees') -> 0 ->> 'n')::int;
  perform set_config('request.jwt.claims', json_build_object('sub', disp_one, 'role', 'authenticated')::text, true);
  n_one := (public.operator_ask_sql('select count(*) as n from employees') -> 0 ->> 'n')::int;
  if n_one < 1 or n_one >= n_all then fails := fails || format('site limit not applied: %s of %s', n_one, n_all);
  else passed := passed + 1; end if;

  -- ---- A plain manager is unchanged ----
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  n_mgr := (public.operator_ask_sql('select count(*) as n from employees') -> 0 ->> 'n')::int;
  if n_mgr <> n_all then fails := fails || format('manager saw %s, display saw %s', n_mgr, n_all); else passed := passed + 1; end if;
  foreach q in array array[
    'select hourly_rate from employees limit 1',
    'select * from public.employees limit 1',
    'select count(*) as n from tips',
    'select count(*) as n from gm_bonus_months',
    'select count(*) as n from injury_reports',
    'select count(*) as n from counseling_records',
    'select count(*) as n from reviews'
  ] loop
    begin
      r := public.operator_ask_sql(q);
      passed := passed + 1;
    exception when others then
      fails := fails || ('MANAGER BROKE: ' || q || ' -> ' || sqlerrm);
    end;
  end loop;
  r := public.operator_ask_sql('select * from employees limit 5');
  if r::text !~ 'hourly_rate' then fails := fails || 'manager lost hourly_rate'::text; else passed := passed + 1; end if;
  if (public.operator_ask_sql($q$select count(*) as n from ai_insights where category = 'people'$q$) -> 0 ->> 'n')::int = 0
    then fails := fails || 'manager lost people insights'::text; else passed := passed + 1; end if;

  execute 'reset role';
  raise exception 'RESULT passed=% employees_all=% employees_one_site=% FAILS=%', passed, n_all, n_one, fails;
end $$;
