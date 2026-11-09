-- Academy: answer keys stay hidden, grading, sign-offs, trainees, and who sees whom.
--
-- One transaction that always rolls back. A failure raises "FAIL n: ...", a clean run
-- ends by raising "ALL PASS". Needs the Mighty Wash program loaded
-- (supabase/seed/academy_mighty_wash.sql). Impersonates users the way PostgREST does.
--
--   sql.sh supabase/tests/academy.sql

begin;

select set_config('t.acct', '54f3e299-1f61-4ed2-9921-3d02160b72e6', true);
select set_config('t.mw01', (select id::text from public.locations where account_id = current_setting('t.acct')::uuid and name = 'MW01'), true);
select set_config('t.mw19', (select id::text from public.locations where account_id = current_setting('t.acct')::uuid and name = 'MW19'), true);
select set_config('t.kevan', (select id::text from public.users where lower(email) = 'kevan@washlyfe.com'), true);
select set_config('t.ea', (select id::text from public.employees where location_id = current_setting('t.mw01')::uuid and status = 'active' order by id limit 1), true);
select set_config('t.eb', (select id::text from public.employees where location_id = current_setting('t.mw19')::uuid and status = 'active' order by id limit 1), true);

-- Content and the answers the test needs (read as the table owner).
do $$
declare
  a uuid := current_setting('t.acct')::uuid;
  l1 uuid; p1 uuid;
begin
  select id into l1 from public.academy_levels where account_id = a and key = 'l1';
  select id into p1 from public.academy_lessons where account_id = a and key = 'p1';
  if l1 is null or p1 is null then raise exception 'FAIL 0: load supabase/seed/academy_mighty_wash.sql first'; end if;
  perform set_config('t.l1', l1::text, true);
  perform set_config('t.l2', (select id::text from public.academy_levels where account_id = a and key = 'l2'), true);
  perform set_config('t.p1', p1::text, true);
  perform set_config('t.p1_right', (select jsonb_object_agg(id, answer)::text from public.academy_questions where lesson_id = p1), true);
  perform set_config('t.p1_wrong', (select jsonb_object_agg(id, (answer + 1) % cardinality(options))::text from public.academy_questions where lesson_id = p1), true);
  perform set_config('t.as_right', (select jsonb_object_agg(id, answer)::text from public.academy_questions where level_id = l1 and kind = 'assessment'), true);
  -- Three wrong out of ten is 70%, under the 80% pass mark.
  perform set_config('t.as_70', (select jsonb_object_agg(id, case when sort <= 3 then (answer + 1) % cardinality(options) else answer end)::text
                                   from public.academy_questions where level_id = l1 and kind = 'assessment'), true);
  perform set_config('t.as_wrong_id', (select id::text from public.academy_questions where level_id = l1 and kind = 'assessment' and sort = 1), true);
  perform set_config('t.sc_right', (select jsonb_object_agg(id, answer)::text from public.academy_questions where level_id = l1 and kind = 'scenario'), true);
  if (select count(*) from public.academy_questions where level_id = l1 and kind = 'assessment') <> 10 then
    raise exception 'FAIL 0: expected 10 Level 1 assessment questions';
  end if;
end $$;

-- Throwaway people: a leader at MW01, a leader at MW19, and the office screen.
do $$
declare
  a uuid := current_setting('t.acct')::uuid;
  u record;
begin
  for u in select * from (values
    ('ldr_a', array[current_setting('t.mw01')::uuid], null::text),
    ('ldr_b', array[current_setting('t.mw19')::uuid], null::text),
    ('screen', array[current_setting('t.mw01')::uuid], 'corporate_display')) v(k, sites, cat)
  loop
    perform set_config('t.' || u.k, gen_random_uuid()::text, true);
    insert into auth.users (id, email, instance_id, aud, role)
    values (current_setting('t.' || u.k)::uuid, u.k || '@academy-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.users (id, account_id, location_ids, role, role_category, name, email)
    values (current_setting('t.' || u.k)::uuid, a, u.sites, 'manager', u.cat, 'Test ' || u.k, u.k || '@academy-test.invalid');
  end loop;
end $$;

-- ---- Leader A learns ----------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ldr_a'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  me jsonb; r jsonb; la uuid; n integer; x uuid;
begin
  me := public.academy_me();
  if me -> 'learner' is null or jsonb_typeof(me -> 'learner') <> 'object' then raise exception 'FAIL 1: no learner record made'; end if;
  if (me ->> 'leader')::boolean is not true or (me ->> 'editor')::boolean is not false then raise exception 'FAIL 2: wrong flags %', me; end if;
  la := (me -> 'learner' ->> 'id')::uuid;
  perform set_config('t.la', la::text, true);
  if (me -> 'learner' ->> 'location_id') is distinct from current_setting('t.mw01') then raise exception 'FAIL 3: one-site leader should default to that site'; end if;
  if (public.academy_me() -> 'learner' ->> 'id')::uuid <> la then raise exception 'FAIL 4: a second learner record was made'; end if;

  -- Answer keys are out of reach.
  select count(*) into n from public.academy_questions;
  if n <> 0 then raise exception 'FAIL 5: a learner can read % answer keys', n; end if;
  select count(*) into n from public.academy_level_questions(current_setting('t.l1')::uuid);
  if n < 20 then raise exception 'FAIL 6: questions without answers missing (%)', n; end if;

  -- Knowledge check: wrong answers don't complete it; all right does.
  r := public.academy_check_quiz(current_setting('t.p1')::uuid, current_setting('t.p1_wrong')::jsonb, la);
  if (r ->> 'done')::boolean or (r ->> 'correct')::integer <> 0 then raise exception 'FAIL 7: wrong answers graded %', r; end if;
  if (select count(*) from jsonb_each(r -> 'results') e where e.value -> 'answer' = 'null'::jsonb) > 0 then
    raise exception 'FAIL 8: a knowledge check should show the right answers';
  end if;
  if exists (select 1 from public.academy_lesson_progress where learner_id = la) then raise exception 'FAIL 9: a failed check completed the lesson'; end if;
  r := public.academy_check_quiz(current_setting('t.p1')::uuid, current_setting('t.p1_right')::jsonb, la);
  if not (r ->> 'done')::boolean then raise exception 'FAIL 10: all right did not complete %', r; end if;
  if not exists (select 1 from public.academy_lesson_progress where learner_id = la and lesson_id = current_setting('t.p1')::uuid and done_at is not null) then
    raise exception 'FAIL 11: lesson not marked done';
  end if;

  -- A missing answer is refused.
  begin
    perform public.academy_check_quiz(current_setting('t.p1')::uuid, '{}'::jsonb, la);
    raise exception 'FAIL 12: an unanswered check was graded';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- Assessment: 70% fails and hides the right answers to the misses; 100% passes.
  r := public.academy_submit(current_setting('t.l1')::uuid, 'assessment', current_setting('t.as_70')::jsonb, la);
  if (r ->> 'passed')::boolean or (r ->> 'score')::integer <> 70 or (r ->> 'revealed')::boolean then raise exception 'FAIL 13: 70%% graded %', r; end if;
  if (r -> 'results' -> current_setting('t.as_wrong_id') ->> 'answer') is not null then raise exception 'FAIL 14: a failed assessment revealed an answer'; end if;
  r := public.academy_submit(current_setting('t.l1')::uuid, 'assessment', current_setting('t.as_right')::jsonb, la);
  if not (r ->> 'passed')::boolean or (r ->> 'score')::integer <> 100 then raise exception 'FAIL 15: 100%% graded %', r; end if;
  r := public.academy_submit(current_setting('t.l1')::uuid, 'scenarios', current_setting('t.sc_right')::jsonb, la);
  if not (r ->> 'revealed')::boolean then raise exception 'FAIL 16: scenarios should show the standard'; end if;
  select count(*) into n from public.academy_attempts where learner_id = la;
  if n <> 3 then raise exception 'FAIL 17: expected 3 attempts, got %', n; end if;

  -- Sign, can't verify yourself, take it back, sign again.
  x := public.academy_sign(la, current_setting('t.l1')::uuid, 'Test Leader A', current_setting('t.mw01')::uuid, current_date, 'Their RM');
  perform set_config('t.sa', x::text, true);
  begin
    perform public.academy_verify(x, true);
    raise exception 'FAIL 18: verified their own sign-off';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.academy_sign(la, current_setting('t.l1')::uuid, 'Again', current_setting('t.mw01')::uuid, current_date, null);
    raise exception 'FAIL 19: signed twice';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform public.academy_unsign(x);
  x := public.academy_sign(la, current_setting('t.l1')::uuid, 'Test Leader A', current_setting('t.mw01')::uuid, current_date, 'Their RM');
  perform set_config('t.sa', x::text, true);
  if (select statement from public.academy_signoffs where id = x) = '' then raise exception 'FAIL 20: statement not kept'; end if;

  -- Site and role: only their own sites.
  begin
    perform public.academy_update_learner(la, 'l3', current_setting('t.mw19')::uuid);
    raise exception 'FAIL 21: set a site they do not lead';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform public.academy_update_learner(la, 'l3', current_setting('t.mw01')::uuid);

  -- Not an editor.
  begin
    insert into public.academy_levels (account_id, key, title, short_title) values (current_setting('t.acct')::uuid, 'zz', 'x', 'x');
    raise exception 'FAIL 22: a manager added a level';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.academy_save_questions(current_setting('t.l1')::uuid, null, 'assessment', '[]'::jsonb);
    raise exception 'FAIL 23: a manager edited questions';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- Progress from the old page comes over once and only fills gaps.
  r := public.academy_import_local(jsonb_build_object(
    'role', 'l2',
    'lessons', jsonb_build_object('p1', jsonb_build_object('done', true, 'at', 1760000000000), 'p2', jsonb_build_object('done', true, 'score', 100, 'at', 1760000000000), 'nope', jsonb_build_object('done', true)),
    'assess', jsonb_build_object('l2', jsonb_build_object('score', 90, 'passed', true, 'at', 1760000000000)),
    'scenarios', jsonb_build_object('l2', jsonb_build_object('done', true, 'right', 4, 'at', 1760000000000)),
    'ack', jsonb_build_object('l2', jsonb_build_object('name', 'Leader A', 'site', 'MW01', 'date', '2026-10-20', 'rm', 'An RM', 'at', 1760000000000))));
  if (r ->> 'imported')::integer <> 4 then raise exception 'FAIL 24: expected 4 brought over, got %', r; end if;
  if (select location_id::text from public.academy_signoffs where learner_id = la and level_id = current_setting('t.l2')::uuid) is distinct from current_setting('t.mw01') then
    raise exception 'FAIL 25: typed site not matched to MW01';
  end if;
  if (select level_key from public.academy_learners where id = la) <> 'l3' then raise exception 'FAIL 26: import overwrote the chosen role'; end if;
  r := public.academy_import_local(jsonb_build_object('lessons', jsonb_build_object('p2', jsonb_build_object('done', true)),
    'assess', jsonb_build_object('l2', jsonb_build_object('score', 10))));
  if (r ->> 'imported')::integer <> 0 then raise exception 'FAIL 27: a second import added %', r; end if;
end $$;

-- ---- Leader A trains a team member on their device -----------------------------------------
do $$
declare
  t jsonb; tl uuid; r jsonb; x uuid;
begin
  t := public.academy_trainee(current_setting('t.ea')::uuid);
  tl := (t ->> 'id')::uuid;
  perform set_config('t.tl', tl::text, true);
  if (t ->> 'employee_id') <> current_setting('t.ea') then raise exception 'FAIL 28: trainee record wrong %', t; end if;
  if (public.academy_trainee(current_setting('t.ea')::uuid) ->> 'id')::uuid <> tl then raise exception 'FAIL 29: second trainee record made'; end if;
  r := public.academy_check_quiz(current_setting('t.p1')::uuid, current_setting('t.p1_right')::jsonb, tl);
  if not (r ->> 'done')::boolean then raise exception 'FAIL 30: trainee check not recorded'; end if;
  if (select by_user::text from public.academy_lesson_progress where learner_id = tl) <> current_setting('t.ldr_a') then
    raise exception 'FAIL 31: trainee progress should record the leader''s login';
  end if;
  x := public.academy_sign(tl, current_setting('t.l1')::uuid, 'Team Member', current_setting('t.mw01')::uuid, current_date, 'Test Leader A', true);
  if (select verified_by::text from public.academy_signoffs where id = x) <> current_setting('t.ldr_a') then
    raise exception 'FAIL 32: leader could not verify a trainee at signing';
  end if;
  begin
    perform public.academy_trainee(current_setting('t.eb')::uuid);
    raise exception 'FAIL 33: trained someone at a site they do not lead';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
reset role;

-- ---- Leader B (MW19) can't see Leader A's people --------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ldr_b'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare n integer;
begin
  perform public.academy_me();
  select count(*) into n from public.academy_learners where id in (current_setting('t.la')::uuid, current_setting('t.tl')::uuid);
  if n <> 0 then raise exception 'FAIL 34: leader B sees MW01 learners'; end if;
  select count(*) into n from public.academy_attempts where learner_id = current_setting('t.la')::uuid;
  if n <> 0 then raise exception 'FAIL 35: leader B sees MW01 attempts'; end if;
  select count(*) into n from public.academy_team() where learner_id in (current_setting('t.la')::uuid, current_setting('t.tl')::uuid);
  if n <> 0 then raise exception 'FAIL 36: team view leaks MW01'; end if;
  begin
    perform public.academy_check_quiz(current_setting('t.p1')::uuid, current_setting('t.p1_right')::jsonb, current_setting('t.tl')::uuid);
    raise exception 'FAIL 37: leader B recorded for an MW01 trainee';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.academy_verify(current_setting('t.sa')::uuid, true);
    raise exception 'FAIL 38: leader B verified an MW01 sign-off';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
reset role;

-- ---- The office screen browses without a record --------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.screen'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare me jsonb; n integer; r jsonb;
begin
  me := public.academy_me();
  if jsonb_typeof(me -> 'learner') <> 'null' or (me ->> 'leader')::boolean then raise exception 'FAIL 39: office screen got %', me; end if;
  select count(*) into n from public.academy_team();
  if n <> 0 then raise exception 'FAIL 40: office screen sees team progress'; end if;
  select count(*) into n from public.academy_learners;
  if n <> 0 then raise exception 'FAIL 41: office screen sees learners'; end if;
  r := public.academy_check_quiz(current_setting('t.p1')::uuid, current_setting('t.p1_right')::jsonb);
  if not (r ->> 'done')::boolean then raise exception 'FAIL 42: grading without a record failed'; end if;
  begin
    perform public.academy_trainee(current_setting('t.ea')::uuid);
    raise exception 'FAIL 43: office screen started a trainee';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
reset role;

-- ---- An Admin sees everyone, verifies, and edits ---------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.kevan'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare row record; n integer; p1 uuid := current_setting('t.p1')::uuid;
begin
  select * into row from public.academy_team() where learner_id = current_setting('t.la')::uuid;
  if row.learner_id is null then raise exception 'FAIL 44: Admin cannot see leader A'; end if;
  if not (row.levels -> 'l1' ->> 'passed')::boolean or (row.levels -> 'l1' ->> 'best')::integer <> 100
     -- p1 from the check, p2 brought over from the old page
     or (row.levels -> 'l1' ->> 'lessons_done')::integer <> 2 or (row.levels -> 'l1' ->> 'signoff_id') is null
     or (row.levels -> 'l1' ->> 'verified')::boolean then
    raise exception 'FAIL 45: team summary wrong %', row.levels -> 'l1';
  end if;
  perform public.academy_verify(current_setting('t.sa')::uuid, true);

  select count(*) into n from public.academy_questions where lesson_id = p1;
  if n = 0 then raise exception 'FAIL 46: an Admin cannot read the answer keys'; end if;
  begin
    perform public.academy_save_questions(current_setting('t.l1')::uuid, p1, 'quiz',
      '[{"prompt":"Q","options":["a","b"],"answer":5}]'::jsonb);
    raise exception 'FAIL 47: saved a question with no valid answer';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  n := public.academy_save_questions(current_setting('t.l1')::uuid, p1, 'quiz',
    jsonb_build_array(
      (select jsonb_build_object('id', id, 'prompt', prompt || ' (edited)', 'options', to_jsonb(options), 'answer', answer, 'why', why)
         from public.academy_questions where lesson_id = p1 order by sort limit 1),
      '{"prompt":"New one","options":["yes","no"],"answer":0}'::jsonb));
  if n <> 2 or (select count(*) from public.academy_questions where lesson_id = p1) <> 2 then raise exception 'FAIL 48: question set not replaced'; end if;
  if not exists (select 1 from public.academy_questions where lesson_id = p1 and prompt like '%(edited)') then raise exception 'FAIL 49: edit lost'; end if;

  update public.academy_lessons set title = title || ' (edited)' where id = p1;
  if not found then raise exception 'FAIL 50: Admin cannot edit a lesson'; end if;
end $$;
reset role;

-- ---- Once verified, the learner can't take it back ----------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ldr_a'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.academy_unsign(current_setting('t.sa')::uuid);
    raise exception 'FAIL 51: unsigned a verified sign-off';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
reset role;

do $$ begin raise exception 'ALL PASS'; end $$;
