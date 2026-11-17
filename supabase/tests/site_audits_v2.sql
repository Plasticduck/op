-- Site Audit NEW (migration 0244): who can start, change, see and delete audits.
--
-- Runs inside a transaction that is rolled back, so it leaves nothing behind.
-- Impersonates real users the way PostgREST does. Account A is the demo account
-- (owner, manager, employee), account B is another customer. Any failure raises
-- "FAIL n: ..."; success ends with ALL PASS.
--   sql.sh supabase/tests/site_audits_v2.sql

begin;

select set_config('t.a', (select id::text from public.accounts where name = 'WashLyfe Demo'), true);
select set_config('t.b', (select id::text from public.accounts where name = 'Cruise Car Wash'), true);
select set_config('t.a_owner', (select id::text from public.users where account_id = current_setting('t.a')::uuid and role = 'owner' limit 1), true);
select set_config('t.a_mgr', (select id::text from public.users where account_id = current_setting('t.a')::uuid and role = 'manager' limit 1), true);
select set_config('t.a_emp', (select id::text from public.users where account_id = current_setting('t.a')::uuid and role = 'employee' limit 1), true);
select set_config('t.b_owner', (select id::text from public.users where account_id = current_setting('t.b')::uuid and role = 'owner' limit 1), true);
-- The manager's own site, and a site of the account that isn't theirs.
select set_config('t.mgr_loc', (select (location_ids)[1]::text from public.users where id = current_setting('t.a_mgr')::uuid), true);
select set_config('t.other_loc', (
  select l.id::text from public.locations l, public.users u
  where u.id = current_setting('t.a_mgr')::uuid and l.account_id = u.account_id and not (l.id = any(u.location_ids))
  limit 1), true);

do $$ begin
  if coalesce(current_setting('t.a_emp', true), '') = '' or coalesce(current_setting('t.b_owner', true), '') = ''
     or coalesce(current_setting('t.mgr_loc', true), '') = '' or coalesce(current_setting('t.other_loc', true), '') = '' then
    raise exception 'FAIL 0: fixtures missing';
  end if;
end $$;

create temp table t_ids (k text primary key, id uuid) on commit drop;
grant all on t_ids to authenticated;

-- ---- Owner A: starts an audit, saves it, submits it ----
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare r record; n int;
begin
  insert into public.site_audits_v2 (account_id, location_id, auditor_name, answers)
  values (current_setting('t.a')::uuid, current_setting('t.mgr_loc')::uuid, 'Owner', '{"site.lot_trash":{"value":"pass","comments":"","photos":[]}}')
  returning * into r;
  if r.auditor_id <> current_setting('t.a_owner')::uuid or r.status <> 'draft' then raise exception 'FAIL 1: draft defaults'; end if;
  insert into t_ids values ('owner_draft', r.id);

  begin
    insert into public.site_audits_v2 (account_id, location_id, auditor_id)
    values (current_setting('t.a')::uuid, current_setting('t.mgr_loc')::uuid, current_setting('t.a_mgr')::uuid);
    raise exception 'FAIL 2: started an audit in someone else''s name';
  exception when insufficient_privilege then null; end;

  update public.site_audits_v2 set answers = '{"x":1}' where id = r.id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 3: owner could not save own draft'; end if;

  begin
    update public.site_audits_v2 set status = 'submitted' where id = r.id;
    raise exception 'FAIL 4: submitted without a grade';
  exception when check_violation then null; end;

  update public.site_audits_v2
  set status = 'submitted', score = 87.5, grade = 'B', safety_failed = false, failed_sections = '{VACS}'
  where id = r.id;
  select * into r from public.site_audits_v2 where id = r.id;
  if r.submitted_at is null or r.status <> 'submitted' then raise exception 'FAIL 5: submit did not stamp submitted_at'; end if;

  update public.site_audits_v2 set grade = 'A' where id = r.id;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 6: a submitted audit changed'; end if;

  -- A second draft the owner keeps to themselves.
  insert into public.site_audits_v2 (account_id, location_id) values (current_setting('t.a')::uuid, current_setting('t.mgr_loc')::uuid)
  returning id into r;
  insert into t_ids values ('owner_draft2', r.id);
end $$;

reset role;

-- ---- Manager A without the page: nothing ----
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_mgr'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare n int;
begin
  select count(*) into n from public.site_audits_v2;
  if n <> 0 then raise exception 'FAIL 7: manager without the page sees % audits', n; end if;
  begin
    insert into public.site_audits_v2 (account_id, location_id) values (current_setting('t.a')::uuid, current_setting('t.mgr_loc')::uuid);
    raise exception 'FAIL 8: manager without the page started an audit';
  exception when insufficient_privilege then null; end;
end $$;

reset role;

-- ---- Manager A granted the page: submitted audits at their sites, own drafts ----
insert into public.page_access (account_id, user_id, page, allowed)
values (current_setting('t.a')::uuid, current_setting('t.a_mgr')::uuid, '/app/site-audits-new', true);

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_mgr'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare n int; my uuid;
begin
  select count(*) into n from public.site_audits_v2;
  if n <> 1 then raise exception 'FAIL 9: granted manager sees % audits, wanted the 1 submitted', n; end if;

  insert into public.site_audits_v2 (account_id, location_id) values (current_setting('t.a')::uuid, current_setting('t.mgr_loc')::uuid)
  returning id into my;
  insert into t_ids values ('mgr_draft', my);

  begin
    insert into public.site_audits_v2 (account_id, location_id) values (current_setting('t.a')::uuid, current_setting('t.other_loc')::uuid);
    raise exception 'FAIL 10: granted manager audited a site that isn''t theirs';
  exception when insufficient_privilege then null; end;

  begin
    update public.site_audits_v2 set location_id = current_setting('t.other_loc')::uuid where id = my;
    raise exception 'FAIL 11: granted manager moved a draft to a site that isn''t theirs';
  exception when insufficient_privilege then null; end;
end $$;

do $$
declare n int;
begin
  update public.site_audits_v2 set answers = '{}' where id = (select id from t_ids where k = 'owner_draft2');
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 12: manager changed the owner''s draft'; end if;

  delete from public.site_audits_v2 where id = (select id from t_ids where k = 'owner_draft');
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 13: manager deleted a submitted audit'; end if;

  delete from public.site_audits_v2 where id = (select id from t_ids where k = 'mgr_draft');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 14: manager could not discard own draft'; end if;
end $$;

reset role;

-- ---- Employee A and Owner B: nothing ----
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_emp'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.site_audits_v2;
  if n <> 0 then raise exception 'FAIL 15: employee sees % audits', n; end if;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.b_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.site_audits_v2 where account_id = current_setting('t.a')::uuid;
  if n <> 0 then raise exception 'FAIL 16: another account sees % audits', n; end if;
  delete from public.site_audits_v2 where account_id = current_setting('t.a')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 17: another account deleted audits'; end if;
  begin
    insert into public.site_audits_v2 (account_id, location_id) values (current_setting('t.a')::uuid, current_setting('t.mgr_loc')::uuid);
    raise exception 'FAIL 18: another account started an audit';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ---- Owner A: deletes the submitted audit ----
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare n int;
begin
  delete from public.site_audits_v2 where id = (select id from t_ids where k = 'owner_draft');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 19: owner could not delete a submitted audit'; end if;
end $$;
reset role;

do $$ begin raise exception 'ALL PASS'; end $$;
rollback;
