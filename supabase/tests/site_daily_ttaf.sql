-- TTAF year to date (migration 0243): read access and the year-to-date math.
--
-- Runs inside a transaction that is rolled back, so it leaves nothing behind.
-- Impersonates real users the way PostgREST does. Account A is the demo account
-- (a manager and an employee), account B is another customer. Any failure
-- raises "FAIL n: ..."; success ends with ALL PASS.
--   sql.sh supabase/tests/site_daily_ttaf.sql

begin;

select set_config('t.a', (select id::text from public.accounts where name = 'WashLyfe Demo'), true);
select set_config('t.b', (select id::text from public.accounts where name = 'Cruise Car Wash'), true);
select set_config('t.a_mgr', (select id::text from public.users where account_id = current_setting('t.a')::uuid and role = 'manager' limit 1), true);
select set_config('t.a_emp', (select id::text from public.users where account_id = current_setting('t.a')::uuid and role = 'employee' limit 1), true);
select set_config('t.b_owner', (select id::text from public.users where account_id = current_setting('t.b')::uuid and role = 'owner' limit 1), true);

do $$ begin
  if coalesce(current_setting('t.a_emp', true), '') = '' or coalesce(current_setting('t.b_owner', true), '') = '' then
    raise exception 'FAIL 0: fixtures missing';
  end if;
end $$;

-- Site 1: DRB all of last year's window, DRB + FlexWash this year.
-- Site 2: new this year (FlexWash only). Site 3: only last year.
-- Rows outside the two windows must not count (Nov 17 this year, Nov 17 and
-- Dec 31 last year, the year before).
insert into public.site_daily_ttaf (account_id, site_number, date, drb_ttaf, flex_ttaf) values
  (current_setting('t.a')::uuid, 1, '2026-01-01', 100, null),
  (current_setting('t.a')::uuid, 1, '2026-11-16', 50, 25),
  (current_setting('t.a')::uuid, 1, '2026-11-17', 999, 999),
  (current_setting('t.a')::uuid, 1, '2025-01-01', 80, null),
  (current_setting('t.a')::uuid, 1, '2025-11-16', 60, null),
  (current_setting('t.a')::uuid, 1, '2025-11-17', 999, null),
  (current_setting('t.a')::uuid, 1, '2025-12-31', 999, null),
  (current_setting('t.a')::uuid, 1, '2024-12-31', 999, null),
  (current_setting('t.a')::uuid, 2, '2026-06-01', null, 40),
  (current_setting('t.a')::uuid, 3, '2025-03-01', 70, null),
  (current_setting('t.b')::uuid, 1, '2026-02-01', 12345, null);

-- ---- Manager in account A ----
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_mgr'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare r record; n int;
begin
  select count(*) into n from public.site_ttaf_ytd('2026-11-16');
  if n <> 3 then raise exception 'FAIL 1: expected 3 sites, got %', n; end if;

  select * into r from public.site_ttaf_ytd('2026-11-16') where site_number = 1;
  if r.drb <> 150 or r.flex <> 25 then raise exception 'FAIL 2: site 1 this year % / %', r.drb, r.flex; end if;
  if r.drb_ly <> 140 or r.flex_ly <> 0 then raise exception 'FAIL 3: site 1 last year % / %', r.drb_ly, r.flex_ly; end if;
  if r.through <> '2026-11-16' then raise exception 'FAIL 4: through %', r.through; end if;

  select * into r from public.site_ttaf_ytd('2026-11-16') where site_number = 2;
  if r.flex <> 40 or r.drb_ly <> 0 or r.flex_ly <> 0 then raise exception 'FAIL 5: new site %', row_to_json(r); end if;

  select * into r from public.site_ttaf_ytd('2026-11-16') where site_number = 3;
  if r.drb <> 0 or r.drb_ly <> 70 then raise exception 'FAIL 6: last-year-only site %', row_to_json(r); end if;

  -- Account B's row is invisible.
  if exists (select 1 from public.site_daily_ttaf where account_id = current_setting('t.b')::uuid) then
    raise exception 'FAIL 7: manager sees another account';
  end if;

  -- Asking past the last stored day (Nov 17) clamps to it: Nov 17 counts this
  -- year and Nov 17 last year counts too.
  select * into r from public.site_ttaf_ytd('2026-12-01') where site_number = 1;
  if r.through <> '2026-11-17' or r.drb <> 1149 or r.drb_ly <> 1139 then raise exception 'FAIL 8: clamp %', row_to_json(r); end if;

  -- Writes are service-role only.
  begin
    insert into public.site_daily_ttaf (account_id, site_number, date, drb_ttaf) values (current_setting('t.a')::uuid, 9, '2026-05-05', 1);
    raise exception 'FAIL 9: manager could write';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---- Employee in account A: nothing ----
reset role;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_emp'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.site_ttaf_ytd('2026-11-16')) then raise exception 'FAIL 10: employee sees TTAF'; end if;
end $$;

-- ---- Owner in account B sees only their own row ----
reset role;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.b_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.site_ttaf_ytd('2026-11-16');
  if n <> 1 then raise exception 'FAIL 11: account B sees % sites', n; end if;
end $$;

do $x$ begin raise exception 'ALL PASS'; end $x$;
