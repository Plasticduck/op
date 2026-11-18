-- Checklists submit -> RM Audit -> Archive (migration 0249): what it takes to
-- submit, what locks once submitted, who can review, and the 8pm report.
--
-- Runs inside a transaction that is rolled back, so it leaves nothing behind.
-- Uses the demo account and its one site (b1): test templates are made inside
-- the transaction, and the manager is made the site's Regional Manager part way
-- through. Any failure raises "FAIL n: ..."; success ends with ALL PASS.
--   sql.sh supabase/tests/checklist_review.sql

begin;

select set_config('t.a', (select id::text from public.accounts where name = 'WashLyfe Demo'), true);
select set_config('t.b', (select id::text from public.accounts where name = 'Cruise Car Wash'), true);
select set_config('t.a_owner', (select id::text from public.users where account_id = current_setting('t.a')::uuid and role = 'owner' limit 1), true);
select set_config('t.a_mgr', (select id::text from public.users where account_id = current_setting('t.a')::uuid and role = 'manager' limit 1), true);
select set_config('t.a_emp', (select id::text from public.users where account_id = current_setting('t.a')::uuid and role = 'employee' limit 1), true);
select set_config('t.b_owner', (select id::text from public.users where account_id = current_setting('t.b')::uuid and role = 'owner' limit 1), true);
select set_config('t.loc', (select (location_ids)[1]::text from public.users where id = current_setting('t.a_emp')::uuid), true);

do $$ begin
  if coalesce(current_setting('t.a_emp', true), '') = '' or coalesce(current_setting('t.b_owner', true), '') = ''
     or coalesce(current_setting('t.loc', true), '') = '' or coalesce(current_setting('t.a_mgr', true), '') = '' then
    raise exception 'FAIL 0: fixtures missing';
  end if;
end $$;

-- No regions yet: the site has no Regional Manager.
update public.accounts set company_settings = coalesce(company_settings, '{}'::jsonb) - 'regions' - 'regionalManagers'
  where id = current_setting('t.a')::uuid;

create temp table t_ids (k text primary key, id uuid) on commit drop;
grant all on t_ids to authenticated;

-- Four templates at the site, due every day, open all day.
do $$
declare t uuid; n int := 0; nm text;
begin
  foreach nm in array array['T main', 'T clean', 'T flagged', 'T untouched'] loop
    n := n + 1;
    insert into public.checklists (account_id, name, frequency, days_of_week, opens_at_local, closes_at_local)
    values (current_setting('t.a')::uuid, nm, 'daily', '{0,1,2,3,4,5,6}', '00:00', null) returning id into t;
    insert into public.checklist_locations (checklist_id, location_id) values (t, current_setting('t.loc')::uuid);
    insert into t_ids values ('tpl' || n, t);
  end loop;
  insert into public.checklist_items (checklist_id, label, order_index, requires_photo)
    values ((select id from t_ids where k = 'tpl1'), 'A photo task', 0, true) returning id into t;
  insert into t_ids values ('A', t);
  insert into public.checklist_items (checklist_id, label, order_index) values ((select id from t_ids where k = 'tpl1'), 'B task', 1) returning id into t;
  insert into t_ids values ('B', t);
  insert into public.checklist_items (checklist_id, label, order_index) values ((select id from t_ids where k = 'tpl1'), 'C task', 2) returning id into t;
  insert into t_ids values ('C', t);
  insert into public.checklist_items (checklist_id, label, order_index) values ((select id from t_ids where k = 'tpl2'), 'D task', 0) returning id into t;
  insert into t_ids values ('D', t);
  insert into public.checklist_items (checklist_id, label, order_index) values ((select id from t_ids where k = 'tpl3'), 'E task', 0) returning id into t;
  insert into t_ids values ('E', t);
  insert into public.checklist_items (checklist_id, label, order_index) values ((select id from t_ids where k = 'tpl4'), 'F task', 0);
end $$;

-- ---- The employee fills out "T main" ----
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_emp'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare inst uuid; res jsonb; r record; acct text := current_setting('t.a');
begin
  perform public.ensure_today_instances(current_setting('t.loc')::uuid);
  select id into inst from public.checklist_instances
    where checklist_id = (select id from t_ids where k = 'tpl1') and location_id = current_setting('t.loc')::uuid;
  if inst is null then raise exception 'FAIL 1: no instance for today'; end if;
  insert into t_ids values ('inst', inst);

  insert into public.checklist_item_events (instance_id, item_id, action, actor_id, actor_name)
  values (inst, (select id from t_ids where k = 'A'), 'check', auth.uid(), 'Demo Employee'),
         (inst, (select id from t_ids where k = 'B'), 'check', auth.uid(), 'Demo Employee');

  -- A is checked with no photo, C is neither checked nor explained.
  res := public.checklist_submit(inst);
  if (res->>'ok')::boolean or jsonb_array_length(res->'missing') <> 2
     or not (res->'missing' @> jsonb_build_array(jsonb_build_object('item_id', (select id from t_ids where k = 'A'), 'reason', 'photo')))
     or not (res->'missing' @> jsonb_build_array(jsonb_build_object('item_id', (select id from t_ids where k = 'C'), 'reason', 'not_done'))) then
    raise exception 'FAIL 2: submit did not list what is missing: %', res;
  end if;
  if (select review_status from public.checklist_instances where id = inst) is not null then raise exception 'FAIL 3: a refused submit changed the checklist'; end if;

  -- A photo outside the checklist's folder is refused; one inside is stamped.
  begin
    insert into public.checklist_item_photos (instance_id, item_id, location_id, path)
    values (inst, (select id from t_ids where k = 'A'), current_setting('t.loc')::uuid, acct || '/elsewhere/x.jpg');
    raise exception 'FAIL 4: a photo outside the folder was accepted';
  exception when others then
    if sqlerrm not like '%bad_path%' then raise exception 'FAIL 4: %', sqlerrm; end if;
  end;
  insert into public.checklist_item_photos (instance_id, item_id, location_id, path, uploaded_by_name)
  values (inst, (select id from t_ids where k = 'A'), current_setting('t.loc')::uuid,
          acct || '/' || inst || '/' || (select id from t_ids where k = 'A') || '/p1.jpg', 'Forged')
  returning * into r;
  if r.uploaded_by is distinct from auth.uid() or r.uploaded_by_name <> 'Demo Employee' then raise exception 'FAIL 5: photo not stamped with the uploader'; end if;

  -- The storage path check: their own checklist's folder only.
  if not public.checklist_photo_path_ok(acct || '/' || inst || '/' || (select id from t_ids where k = 'A') || '/p1.jpg') then
    raise exception 'FAIL 6: the site could not use its own checklist folder';
  end if;
  if public.checklist_photo_path_ok(current_setting('t.b') || '/' || inst || '/x/p.jpg') then
    raise exception 'FAIL 7: another account folder passed the path check';
  end if;

  -- The site says why C wasn't done. Name and role come from the server.
  insert into public.checklist_item_comments (instance_id, item_id, location_id, body, author_name, author_role)
  values (inst, (select id from t_ids where k = 'C'), current_setting('t.loc')::uuid, '  Out of soap  ', 'Forged', 'admin')
  returning * into r;
  if r.author_name <> 'Demo Employee' or r.author_role <> 'site' or r.body <> 'Out of soap' then
    raise exception 'FAIL 8: comment not stamped: % % %', r.author_name, r.author_role, r.body;
  end if;
  insert into t_ids values ('c_before', r.id);

  begin
    insert into public.checklist_item_comments (instance_id, item_id, location_id, body)
    values (inst, (select id from t_ids where k = 'D'), current_setting('t.loc')::uuid, 'wrong list');
    raise exception 'FAIL 9: a comment on another checklist''s item was accepted';
  exception when others then
    if sqlerrm not like '%item_not_on_checklist%' then raise exception 'FAIL 9: %', sqlerrm; end if;
  end;

  -- Now it goes: one flagged item (C).
  res := public.checklist_submit(inst);
  if not (res->>'ok')::boolean or (res->>'flagged')::int <> 1 then raise exception 'FAIL 10: submit refused: %', res; end if;
  select * into r from public.checklist_instances where id = inst;
  if r.review_status <> 'rm_audit' or r.items_total <> 3 or r.items_done <> 2 or r.submitted_by <> auth.uid()
     or r.flagged_items <> array[(select id from t_ids where k = 'C')::text]
     or jsonb_array_length(r.snapshot->'items') <> 3 or r.snapshot->>'name' <> 'T main' then
    raise exception 'FAIL 11: submission not recorded: %', row_to_json(r);
  end if;

  -- Locked: no more checks or photos, no second submit.
  begin
    insert into public.checklist_item_events (instance_id, item_id, action, actor_id, actor_name)
    values (inst, (select id from t_ids where k = 'C'), 'check', auth.uid(), 'Demo Employee');
    raise exception 'FAIL 12: an item was checked after submit';
  exception when others then
    if sqlerrm not like '%row-level security%' then raise exception 'FAIL 12: %', sqlerrm; end if;
  end;
  begin
    insert into public.checklist_item_photos (instance_id, item_id, location_id, path)
    values (inst, (select id from t_ids where k = 'B'), current_setting('t.loc')::uuid, acct || '/' || inst || '/' || (select id from t_ids where k = 'B') || '/p2.jpg');
    raise exception 'FAIL 13: a photo was added after submit';
  exception when others then
    if sqlerrm not like '%checklist_submitted%' then raise exception 'FAIL 13: %', sqlerrm; end if;
  end;
  begin
    perform public.checklist_submit(inst);
    raise exception 'FAIL 14: submitted twice';
  exception when others then
    if sqlerrm not like '%already_submitted%' then raise exception 'FAIL 14: %', sqlerrm; end if;
  end;

  -- The comment that explained C is part of the record now.
  delete from public.checklist_item_comments where id = (select id from t_ids where k = 'c_before');
  if not exists (select 1 from public.checklist_item_comments where id = (select id from t_ids where k = 'c_before')) then
    raise exception 'FAIL 15: a submitted comment was deleted';
  end if;
  -- No writing the follow-up directly.
  update public.checklist_instances set review_status = 'archived' where id = inst;
  if (select review_status from public.checklist_instances where id = inst) <> 'rm_audit' then raise exception 'FAIL 16: the site archived it directly'; end if;
  begin
    perform public.checklist_review(inst, '{}', null, true);
    raise exception 'FAIL 17: the site reviewed its own checklist';
  exception when others then
    if sqlerrm not like '%not_allowed%' then raise exception 'FAIL 17: %', sqlerrm; end if;
  end;
end $$;

-- "T clean": everything done. "T flagged": done but with a comment.
do $$
declare inst uuid; res jsonb;
begin
  select id into inst from public.checklist_instances where checklist_id = (select id from t_ids where k = 'tpl2') and location_id = current_setting('t.loc')::uuid;
  insert into public.checklist_item_events (instance_id, item_id, action, actor_id, actor_name) values (inst, (select id from t_ids where k = 'D'), 'check', auth.uid(), 'Demo Employee');
  res := public.checklist_submit(inst);
  if not (res->>'ok')::boolean or (res->>'flagged')::int <> 0 then raise exception 'FAIL 18: clean submit: %', res; end if;
  insert into t_ids values ('inst_clean', inst);

  select id into inst from public.checklist_instances where checklist_id = (select id from t_ids where k = 'tpl3') and location_id = current_setting('t.loc')::uuid;
  insert into public.checklist_item_events (instance_id, item_id, action, actor_id, actor_name) values (inst, (select id from t_ids where k = 'E'), 'check', auth.uid(), 'Demo Employee');
  insert into public.checklist_item_comments (instance_id, item_id, location_id, body) values (inst, (select id from t_ids where k = 'E'), current_setting('t.loc')::uuid, 'Done, but the hose is cracking');
  res := public.checklist_submit(inst);
  if not (res->>'ok')::boolean or (res->>'flagged')::int <> 1 then raise exception 'FAIL 19: a commented item was not flagged: %', res; end if;
  insert into t_ids values ('inst_flag', inst);

  -- The employee can't bulk-complete either.
  if public.checklist_review_bulk(array[(select id from t_ids where k = 'inst_clean')]) <> 0 then raise exception 'FAIL 20: the site bulk-completed'; end if;
end $$;

-- ---- The manager, not yet the site's RM ----
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_mgr'), 'role', 'authenticated')::text, true);

do $$ begin
  begin
    perform public.checklist_review((select id from t_ids where k = 'inst'), '{}', null, false);
    raise exception 'FAIL 21: a manager who is not the RM reviewed';
  exception when others then
    if sqlerrm not like '%not_allowed%' then raise exception 'FAIL 21: %', sqlerrm; end if;
  end;
  if exists (select 1 from public.checklist_site_rms() where user_id is not null) then raise exception 'FAIL 22: an RM showed up with no regions set'; end if;
end $$;

-- Make them the RM of a region holding the site.
reset role;
update public.users set role_category = 'regional_manager' where id = current_setting('t.a_mgr')::uuid;
update public.accounts set company_settings = coalesce(company_settings, '{}'::jsonb)
  || jsonb_build_object(
       'regions', jsonb_build_array(jsonb_build_object('name', 'Test Region', 'siteIds', jsonb_build_array(current_setting('t.loc')))),
       'regionalManagers', jsonb_build_object('Test Region', jsonb_build_object('2020-01-01', (select name from public.users where id = current_setting('t.a_mgr')::uuid))))
  where id = current_setting('t.a')::uuid;
set local role authenticated;

do $$
declare inst uuid := (select id from t_ids where k = 'inst'); res jsonb; r record; c uuid := (select id from t_ids where k = 'C');
begin
  if not exists (select 1 from public.checklist_site_rms() where location_id = current_setting('t.loc')::uuid and user_id = auth.uid() and region = 'Test Region') then
    raise exception 'FAIL 23: checklist_site_rms did not name the RM';
  end if;

  -- The RM's comment says RM.
  insert into public.checklist_item_comments (instance_id, item_id, location_id, body) values (inst, c, current_setting('t.loc')::uuid, 'Order more soap today')
  returning * into r;
  if r.author_role <> 'rm' then raise exception 'FAIL 24: RM comment role %', r.author_role; end if;
  insert into t_ids values ('c_rm', r.id);

  begin
    perform public.checklist_review(inst, '{}', 'note', true);
    raise exception 'FAIL 25: completed with C unacknowledged';
  exception when others then
    if sqlerrm not like '%missing_acks%' then raise exception 'FAIL 25: %', sqlerrm; end if;
  end;

  -- Save as they go: an ack for an unflagged item is dropped.
  res := public.checklist_review(inst, jsonb_build_object(c::text, true, (select id from t_ids where k = 'A')::text, true), '  Talked to the GM  ', false);
  select * into r from public.checklist_instances where id = inst;
  if r.rm_acks <> jsonb_build_object(c::text, true) or r.rm_note <> 'Talked to the GM' or r.review_status <> 'rm_audit' or jsonb_array_length(res->'missing') <> 0 then
    raise exception 'FAIL 26: partial save wrong: % % %', r.rm_acks, r.rm_note, res;
  end if;

  -- Their own review comment can be taken back while it's in RM Audit.
  delete from public.checklist_item_comments where id = (select id from t_ids where k = 'c_rm');
  if exists (select 1 from public.checklist_item_comments where id = (select id from t_ids where k = 'c_rm')) then raise exception 'FAIL 27: RM could not take back a review comment'; end if;

  res := public.checklist_review(inst, r.rm_acks, r.rm_note, true);
  select * into r from public.checklist_instances where id = inst;
  if r.review_status <> 'archived' or r.completed_by <> auth.uid() or r.completed_role <> 'regional_manager' or r.completed_at is null or r.completed_by_name is null then
    raise exception 'FAIL 28: complete not recorded: %', row_to_json(r);
  end if;

  begin
    perform public.checklist_review(inst, '{}', null, true);
    raise exception 'FAIL 29: reviewed an archived checklist';
  exception when others then
    if sqlerrm not like '%not_open%' then raise exception 'FAIL 29: %', sqlerrm; end if;
  end;
  begin
    insert into public.checklist_item_comments (instance_id, item_id, location_id, body) values (inst, c, current_setting('t.loc')::uuid, 'late');
    raise exception 'FAIL 30: commented on an archived checklist';
  exception when others then
    if sqlerrm not like '%checklist_archived%' then raise exception 'FAIL 30: %', sqlerrm; end if;
  end;

  -- Bulk: only the one with nothing flagged moves.
  if public.checklist_review_bulk(array[(select id from t_ids where k = 'inst_clean'), (select id from t_ids where k = 'inst_flag')]) <> 1 then
    raise exception 'FAIL 31: bulk did not complete exactly the clean one';
  end if;
  if (select review_status from public.checklist_instances where id = (select id from t_ids where k = 'inst_clean')) <> 'archived'
     or (select review_status from public.checklist_instances where id = (select id from t_ids where k = 'inst_flag')) <> 'rm_audit' then
    raise exception 'FAIL 32: bulk moved the wrong checklist';
  end if;
end $$;

-- ---- Another account sees and changes nothing ----
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.b_owner'), 'role', 'authenticated')::text, true);

do $$ begin
  if exists (select 1 from public.checklist_instances where id = (select id from t_ids where k = 'inst_flag'))
     or exists (select 1 from public.checklist_item_comments where instance_id = (select id from t_ids where k = 'inst_flag'))
     or exists (select 1 from public.checklist_item_photos where instance_id = (select id from t_ids where k = 'inst')) then
    raise exception 'FAIL 33: another account can read the checklist';
  end if;
  begin
    perform public.checklist_review((select id from t_ids where k = 'inst_flag'), '{}', null, false);
    raise exception 'FAIL 34: another account reviewed';
  exception when others then
    if sqlerrm not like '%not_allowed%' then raise exception 'FAIL 34: %', sqlerrm; end if;
  end;
  if public.checklist_review_bulk(array[(select id from t_ids where k = 'inst_flag')]) <> 0 then raise exception 'FAIL 35: another account bulk-completed'; end if;
end $$;

-- ---- The Admin (owner, not the RM) closes the flagged one ----
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_owner'), 'role', 'authenticated')::text, true);

do $$
declare inst uuid := (select id from t_ids where k = 'inst_flag'); r record;
begin
  perform public.checklist_review(inst, jsonb_build_object((select id from t_ids where k = 'E')::text, true), null, true);
  select * into r from public.checklist_instances where id = inst;
  if r.review_status <> 'archived' or r.completed_role <> 'admin' then raise exception 'FAIL 36: Admin complete: %', r.completed_role; end if;
end $$;

-- ---- The 8pm report ----
reset role;

do $$
declare d date := (select instance_date from public.checklist_instances where id = (select id from t_ids where k = 'inst')); r record; n int;
begin
  select count(*) into n from public.checklist_day_report(current_setting('t.a')::uuid, d) where checklist_name like 'T %';
  if n <> 4 then raise exception 'FAIL 37: report has % test rows, expected 4', n; end if;
  select * into r from public.checklist_day_report(current_setting('t.a')::uuid, d) where checklist_name = 'T main';
  if r.instance_id <> (select id from t_ids where k = 'inst') or r.review_status <> 'archived' or r.items_done <> 2 or r.items_total <> 3
     or r.flagged_count <> 1 or r.photo_count <> 1 or r.comment_count <> 1 or r.region <> 'Test Region' or r.rm_name is null then
    raise exception 'FAIL 38: report row wrong: %', row_to_json(r);
  end if;
  if r.closes_at <> (d + 1)::timestamp at time zone coalesce((select timezone from public.locations where id = current_setting('t.loc')::uuid), 'America/Chicago') then
    raise exception 'FAIL 39: an all-day checklist should close at midnight';
  end if;
  -- Due but never opened: still on the report, with no checklist and no submission.
  select * into r from public.checklist_day_report(current_setting('t.a')::uuid, d) where checklist_name = 'T untouched';
  if r.submitted_at is not null or r.location_id is null then raise exception 'FAIL 40: unopened checklist row wrong'; end if;
  -- Not due on a day outside its days of week.
  update public.checklists set days_of_week = '{}' where id = (select id from t_ids where k = 'tpl4');
  if exists (select 1 from public.checklist_day_report(current_setting('t.a')::uuid, d) where checklist_name = 'T untouched') then
    raise exception 'FAIL 41: a checklist not due that day was reported';
  end if;
  -- Signed-in people can't call the report.
  if has_function_privilege('authenticated', 'public.checklist_day_report(uuid, date)', 'execute') then
    raise exception 'FAIL 42: the report is callable by signed-in people';
  end if;
end $$;

select 'ALL PASS' as result;
rollback;
