-- Site Audit NEW follow-up (migration 0248): which tab a submitted audit lands
-- in, and who can answer its red items and mark it complete.
--
-- Runs inside a transaction that is rolled back, so it leaves nothing behind.
-- Uses the demo account: its manager is made the Regional Manager of a test
-- region holding their own site (settings and role changed only inside the
-- transaction). Any failure raises "FAIL n: ..."; success ends with ALL PASS.
--   sql.sh supabase/tests/site_audits_v2_review.sql

begin;

select set_config('t.a', (select id::text from public.accounts where name = 'WashLyfe Demo'), true);
select set_config('t.b', (select id::text from public.accounts where name = 'Cruise Car Wash'), true);
select set_config('t.a_owner', (select id::text from public.users where account_id = current_setting('t.a')::uuid and role = 'owner' limit 1), true);
select set_config('t.a_mgr', (select id::text from public.users where account_id = current_setting('t.a')::uuid and role = 'manager' limit 1), true);
select set_config('t.a_emp', (select id::text from public.users where account_id = current_setting('t.a')::uuid and role = 'employee' limit 1), true);
select set_config('t.b_owner', (select id::text from public.users where account_id = current_setting('t.b')::uuid and role = 'owner' limit 1), true);
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

-- The manager is the RM of "Test Region" (their own site) from a past quarter on.
update public.users set role_category = 'regional_manager', name = 'Test  R. Manager' where id = current_setting('t.a_mgr')::uuid;
update public.accounts set company_settings = coalesce(company_settings, '{}'::jsonb)
  || jsonb_build_object(
       'regions', jsonb_build_array(jsonb_build_object('name', 'Test Region', 'siteIds', jsonb_build_array(current_setting('t.mgr_loc')))),
       'regionalManagers', jsonb_build_object('Test Region', jsonb_build_object('2020-01-01', 'test r manager')))
  where id = current_setting('t.a')::uuid;

create temp table t_ids (k text primary key, id uuid) on commit drop;
grant all on t_ids to authenticated;

-- RM map: the manager's site has them as RM (names matched loosely); other sites have none.
do $$
declare r record;
begin
  select * into r from public.site_audit_v2_rm_map(current_setting('t.a')::uuid) where location_id = current_setting('t.mgr_loc')::uuid;
  if r.user_id is distinct from current_setting('t.a_mgr')::uuid or r.region <> 'Test Region' then raise exception 'FAIL 1: rm map did not find the RM'; end if;
  if exists (select 1 from public.site_audit_v2_rm_map(current_setting('t.a')::uuid) where location_id = current_setting('t.other_loc')::uuid and user_id is not null) then
    raise exception 'FAIL 2: a site outside the region has an RM';
  end if;
end $$;

-- ---- Owner A submits three audits ----
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare r record; reds jsonb;
begin
  reds := '{"site.lot_trash":{"value":"fail","comments":"trash","photos":[]},"safety.first_aid_kits":{"value":"fail","comments":"empty","photos":[]},"vacs.hoses":{"value":"warn","comments":"","photos":[]},"qc.positioning":{"value":"pass","comments":"","photos":[]}}';

  -- Red items, though the app claims nothing failed: the answers decide.
  insert into public.site_audits_v2 (account_id, location_id, auditor_name, answers, review_status)
  values (current_setting('t.a')::uuid, current_setting('t.mgr_loc')::uuid, 'Owner', reds, 'complete') returning * into r;
  if r.review_status is not null then raise exception 'FAIL 3: a draft carried a review status'; end if;
  update public.site_audits_v2 set status = 'submitted', score = 75, grade = 'F', safety_failed = true, failed_sections = '{}' where id = r.id
    returning * into r;
  if r.review_status <> 'needs_attention' or r.completed_at is not null then raise exception 'FAIL 4: red items did not go to Needs Attention'; end if;
  insert into t_ids values ('red', r.id);

  -- Nothing red (yellow only): still waits for the RM to acknowledge it (0256).
  insert into public.site_audits_v2 (account_id, location_id, auditor_name, answers)
  values (current_setting('t.a')::uuid, current_setting('t.mgr_loc')::uuid, 'Owner', '{"vacs.hoses":{"value":"warn","comments":"","photos":[]}}') returning * into r;
  update public.site_audits_v2 set status = 'submitted', score = 100, grade = 'A', safety_failed = false where id = r.id returning * into r;
  if r.review_status <> 'needs_attention' or r.completed_at is not null then raise exception 'FAIL 5: a clean audit skipped Needs Attention'; end if;
  insert into t_ids values ('clean', r.id);

  -- A red item at a site with no RM (vacant region): an Admin closes it.
  insert into public.site_audits_v2 (account_id, location_id, auditor_name, answers)
  values (current_setting('t.a')::uuid, current_setting('t.other_loc')::uuid, 'Owner', '{"site.landscaping":{"value":"fail","comments":"","photos":[]}}') returning * into r;
  update public.site_audits_v2 set status = 'submitted', score = 87.5, grade = 'B', safety_failed = false, failed_sections = '{SITE}' where id = r.id;
  insert into t_ids values ('vacant', r.id);
end $$;

reset role;

-- ---- The RM (a manager: no grant needed since 0256) ----
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_mgr'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$ begin
  begin
    perform * from public.site_audit_v2_rm_map(current_setting('t.a')::uuid);
    raise exception 'FAIL 8: the internal rm map is callable from the app';
  exception when insufficient_privilege then null; end;
end $$;

do $$
declare r record; res jsonb; n int; red uuid := (select id from t_ids where k = 'red'); clean uuid := (select id from t_ids where k = 'clean');
begin
  -- Nothing red: marking it complete is the acknowledgement, with no answers.
  res := public.site_audit_v2_respond(clean, '{}'::jsonb, 'Looks good.', true);
  select * into r from public.site_audits_v2 where id = clean;
  if r.review_status <> 'complete' or r.completed_role <> 'regional_manager' or r.rm_note <> 'Looks good.' or (res->>'missing')::int <> 0 then
    raise exception 'FAIL 6: RM could not acknowledge a clean audit';
  end if;

  if not exists (select 1 from public.site_audit_v2_rms() where location_id = current_setting('t.mgr_loc')::uuid and user_id = current_setting('t.a_mgr')::uuid) then
    raise exception 'FAIL 9: rm list missing their own site';
  end if;

  -- Can't change the follow-up straight on the table.
  update public.site_audits_v2 set review_status = 'complete' where id = red;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 10: changed the review status directly'; end if;

  -- Save one answer as they go; an answer to a non-red item is dropped.
  res := public.site_audit_v2_respond(red, '{"site.lot_trash":"  Picked up and added a trash run at close.  ","vacs.hoses":"not red","qc.positioning":"x"}', ' note ', false);
  select * into r from public.site_audits_v2 where id = red;
  if (res->>'missing')::int <> 1 or r.review_status <> 'needs_attention' then raise exception 'FAIL 11: partial save'; end if;
  if r.rm_responses <> '{"site.lot_trash":"Picked up and added a trash run at close."}'::jsonb or r.rm_note <> 'note' then
    raise exception 'FAIL 12: saved answers not cleaned: %', r.rm_responses;
  end if;

  begin
    perform public.site_audit_v2_respond(red, '{"site.lot_trash":"done"}', null, true);
    raise exception 'FAIL 13: completed with a red item unanswered';
  exception when raise_exception then
    if sqlerrm <> 'missing_responses' then raise; end if;
  end;

  res := public.site_audit_v2_respond(red, '{"site.lot_trash":"done","safety.first_aid_kits":"Restocked both kits."}', null, true);
  select * into r from public.site_audits_v2 where id = red;
  if r.review_status <> 'complete' or r.completed_by <> current_setting('t.a_mgr')::uuid or r.completed_role <> 'regional_manager'
     or r.completed_by_name <> 'Test  R. Manager' or r.completed_at is null then
    raise exception 'FAIL 14: RM could not complete';
  end if;

  begin
    perform public.site_audit_v2_respond(red, '{"site.lot_trash":"again","safety.first_aid_kits":"again"}', null, true);
    raise exception 'FAIL 15: answered a completed audit';
  exception when raise_exception then
    if sqlerrm <> 'not_open' then raise; end if;
  end;

  -- The vacant-region audit isn't theirs (and isn't at their site).
  begin
    perform public.site_audit_v2_respond((select id from t_ids where k = 'vacant'), '{"site.landscaping":"x"}', null, true);
    raise exception 'FAIL 16: RM answered another site''s audit';
  exception when no_data_found or insufficient_privilege then null; end;
end $$;

reset role;

-- A manager who has the page and the site but isn't its RM.
update public.accounts set company_settings = jsonb_set(company_settings, '{regionalManagers,Test Region}', '{"2020-01-01":"Someone Else"}')
  where id = current_setting('t.a')::uuid;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r record;
begin
  insert into public.site_audits_v2 (account_id, location_id, auditor_name, answers)
  values (current_setting('t.a')::uuid, current_setting('t.mgr_loc')::uuid, 'Owner', '{"tunnel.cleanliness":{"value":"fail","comments":"","photos":[]}}') returning * into r;
  update public.site_audits_v2 set status = 'submitted', score = 87.5, grade = 'B', safety_failed = false where id = r.id;
  insert into t_ids values ('not_rm', r.id);
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_mgr'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.site_audit_v2_respond((select id from t_ids where k = 'not_rm'), '{"tunnel.cleanliness":"x"}', null, true);
    raise exception 'FAIL 17: a manager who is not the RM completed it';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ---- Owner B (another company): can't see or answer A's audits ----
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.b_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.site_audit_v2_respond((select id from t_ids where k = 'vacant'), '{"site.landscaping":"x"}', null, true);
    raise exception 'FAIL 18: another account answered';
  exception when no_data_found then null; end;
end $$;
reset role;

-- ---- Owner A (Admin): closes the vacant-region one ----
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r record;
begin
  perform public.site_audit_v2_respond((select id from t_ids where k = 'vacant'), '{"site.landscaping":"Mowed and edged."}', null, true);
  select * into r from public.site_audits_v2 where id = (select id from t_ids where k = 'vacant');
  if r.review_status <> 'complete' or r.completed_role <> 'admin' then raise exception 'FAIL 19: Admin could not complete'; end if;
  if (select count(*) from public.site_audit_v2_rms()) = 0 then raise exception 'FAIL 20: Admin got no rm list'; end if;
end $$;
reset role;

-- ---- The employee: no page, nothing ----
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_emp'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.site_audit_v2_respond((select id from t_ids where k = 'not_rm'), '{"tunnel.cleanliness":"x"}', null, true);
    raise exception 'FAIL 21: employee answered';
  exception when no_data_found then null; end;
end $$;
reset role;

select 'ALL PASS' as result;
rollback;
