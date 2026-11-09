-- Academy tracks, prerequisites and practical skills: General Manager needs T1
-- Maintenance, tiers need the tier below, and only a leader checks off skills.
--
-- One transaction that always rolls back. A failure raises "FAIL n: ...", a clean run
-- ends by raising "ALL PASS". Needs both Mighty Wash seeds loaded
-- (academy_mighty_wash.sql, academy_maintenance.sql).
--
--   sql.sh supabase/tests/academy_maintenance.sql

begin;

select set_config('t.acct', '54f3e299-1f61-4ed2-9921-3d02160b72e6', true);
select set_config('t.mw01', (select id::text from public.locations where account_id = current_setting('t.acct')::uuid and name = 'MW01'), true);
select set_config('t.mw19', (select id::text from public.locations where account_id = current_setting('t.acct')::uuid and name = 'MW19'), true);
select set_config('t.kevan', (select id::text from public.users where lower(email) = 'kevan@washlyfe.com'), true);
select set_config('t.ea', (select id::text from public.employees where location_id = current_setting('t.mw01')::uuid and status = 'active' order by id limit 1), true);

do $$
declare
  a uuid := current_setting('t.acct')::uuid;
  t1 uuid; t2 uuid; l6 uuid;
begin
  select id into t1 from public.academy_levels where account_id = a and key = 't1';
  select id into t2 from public.academy_levels where account_id = a and key = 't2';
  select id into l6 from public.academy_levels where account_id = a and key = 'l6';
  if t1 is null or l6 is null then raise exception 'FAIL 0: load both Academy seeds first'; end if;
  perform set_config('t.t1', t1::text, true);
  perform set_config('t.t2', t2::text, true);
  perform set_config('t.l6', l6::text, true);
  if not exists (select 1 from public.academy_prereqs where level_id = l6 and requires_id = t1) then raise exception 'FAIL 1: GM does not require T1'; end if;
  if (select t.key from public.academy_levels l join public.academy_tracks t on t.id = l.track_id where l.id = l6) <> 'site-support' then
    raise exception 'FAIL 2: GM is not in Site Support';
  end if;
  if (select t.key from public.academy_levels l join public.academy_tracks t on t.id = l.track_id where l.id = t1) <> 'maintenance' then
    raise exception 'FAIL 3: T1 is not in Maintenance';
  end if;
  -- Right answers for every T1 lesson, and T1's scenarios and assessment.
  perform set_config('t.t1_lessons', (
    select jsonb_object_agg(s.id, (select jsonb_object_agg(q.id, q.answer) from public.academy_questions q where q.lesson_id = s.id))::text
      from public.academy_lessons s where s.level_id = t1 and s.active), true);
  perform set_config('t.t1_scen', (select jsonb_object_agg(id, answer)::text from public.academy_questions where level_id = t1 and kind = 'scenario'), true);
  perform set_config('t.t1_assess', (select jsonb_object_agg(id, answer)::text from public.academy_questions where level_id = t1 and kind = 'assessment'), true);
  perform set_config('t.t2_skill', (select skills[1] from public.academy_levels where id = t2), true);
end $$;

do $$
declare
  a uuid := current_setting('t.acct')::uuid;
  u record;
begin
  for u in select * from (values ('ldr_a', current_setting('t.mw01')::uuid), ('ldr_b', current_setting('t.mw19')::uuid)) v(k, site) loop
    perform set_config('t.' || u.k, gen_random_uuid()::text, true);
    insert into auth.users (id, email, instance_id, aud, role)
    values (current_setting('t.' || u.k)::uuid, u.k || '@academy-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.users (id, account_id, location_ids, role, name, email)
    values (current_setting('t.' || u.k)::uuid, a, array[u.site], 'manager', 'Test ' || u.k, u.k || '@academy-test.invalid');
  end loop;
end $$;

-- ---- Leader A: GM can't be signed without T1; with T1 complete it can --------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ldr_a'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  la uuid; r jsonb; k text; v jsonb; n integer;
begin
  la := (public.academy_me() -> 'learner' ->> 'id')::uuid;
  perform set_config('t.la', la::text, true);

  select count(*) into n from public.academy_tracks;
  if n < 2 then raise exception 'FAIL 4: a manager sees % tracks', n; end if;

  begin
    perform public.academy_sign(la, current_setting('t.l6')::uuid, 'Leader A', current_setting('t.mw01')::uuid, current_date, 'RM');
    raise exception 'FAIL 5: GM signed without T1';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like '%T1 Maintenance%' then raise exception 'FAIL 6: wrong message: %', sqlerrm; end if;
  end;

  -- T1 signed but its lessons not done: still not complete, so GM is still blocked.
  perform public.academy_sign(la, current_setting('t.t1')::uuid, 'Leader A', current_setting('t.mw01')::uuid, current_date, 'RM');
  begin
    perform public.academy_sign(la, current_setting('t.l6')::uuid, 'Leader A', current_setting('t.mw01')::uuid, current_date, 'RM');
    raise exception 'FAIL 7: GM signed with T1 only signed, not complete';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- Finish T1: every lesson, scenarios, assessment.
  for k, v in select * from jsonb_each(current_setting('t.t1_lessons')::jsonb) loop
    r := public.academy_check_quiz(k::uuid, coalesce(v, '{}'::jsonb), la);
    if not (r ->> 'done')::boolean then raise exception 'FAIL 8: T1 lesson % not done: %', k, r; end if;
  end loop;
  perform public.academy_submit(current_setting('t.t1')::uuid, 'scenarios', current_setting('t.t1_scen')::jsonb, la);
  r := public.academy_submit(current_setting('t.t1')::uuid, 'assessment', current_setting('t.t1_assess')::jsonb, la);
  if not (r ->> 'passed')::boolean then raise exception 'FAIL 9: T1 assessment not passed'; end if;

  perform public.academy_sign(la, current_setting('t.l6')::uuid, 'Leader A', current_setting('t.mw01')::uuid, current_date, 'RM');

  -- T2 needs T1 (done) but T3 needs T2 (not done).
  begin
    perform public.academy_sign(la, (select id from public.academy_levels where key = 't3' and account_id = current_setting('t.acct')::uuid),
                                'Leader A', current_setting('t.mw01')::uuid, current_date, 'RM');
    raise exception 'FAIL 10: T3 signed without T2';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- Practical skills: never your own.
  begin
    perform public.academy_check_skill(la, current_setting('t.t2')::uuid, current_setting('t.t2_skill'), true);
    raise exception 'FAIL 11: checked off their own skill';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- A team member trained on this device: the leader checks their skill.
  perform set_config('t.tl', (public.academy_trainee(current_setting('t.ea')::uuid) ->> 'id'), true);
  perform public.academy_check_skill(current_setting('t.tl')::uuid, current_setting('t.t2')::uuid, current_setting('t.t2_skill'), true);
  if (select checked_by::text from public.academy_skill_checks where learner_id = current_setting('t.tl')::uuid) <> current_setting('t.ldr_a') then
    raise exception 'FAIL 12: skill check not recorded to the leader';
  end if;
  begin
    perform public.academy_check_skill(current_setting('t.tl')::uuid, current_setting('t.t2')::uuid, 'Juggle chainsaws', true);
    raise exception 'FAIL 13: checked off a skill that is not on the level';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.academy_sign(current_setting('t.tl')::uuid, current_setting('t.t2')::uuid, 'Team Member', current_setting('t.mw01')::uuid, current_date, 'Leader A', true);
    raise exception 'FAIL 14: trainee signed T2 without T1';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  -- Un-check it.
  perform public.academy_check_skill(current_setting('t.tl')::uuid, current_setting('t.t2')::uuid, current_setting('t.t2_skill'), false);
  if exists (select 1 from public.academy_skill_checks where learner_id = current_setting('t.tl')::uuid) then raise exception 'FAIL 15: un-check failed'; end if;
  perform public.academy_check_skill(current_setting('t.tl')::uuid, current_setting('t.t2')::uuid, current_setting('t.t2_skill'), true);
end $$;
reset role;

-- ---- Leader B (MW19) can't check off an MW01 person's skills -------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ldr_b'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare n integer;
begin
  begin
    perform public.academy_check_skill(current_setting('t.tl')::uuid, current_setting('t.t2')::uuid, current_setting('t.t2_skill'), false);
    raise exception 'FAIL 16: leader B changed an MW01 skill';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  select count(*) into n from public.academy_skill_checks where learner_id = current_setting('t.tl')::uuid;
  if n <> 0 then raise exception 'FAIL 17: leader B sees MW01 skill checks'; end if;
end $$;
reset role;

-- ---- An Admin's team view shows "complete" and skill counts -------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.kevan'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare row record;
begin
  select * into row from public.academy_team() where learner_id = current_setting('t.la')::uuid;
  if not (row.levels -> 't1' ->> 'complete')::boolean then raise exception 'FAIL 18: T1 should be complete %', row.levels -> 't1'; end if;
  if (row.levels -> 'l6' ->> 'signoff_id') is null then raise exception 'FAIL 19: GM sign-off missing'; end if;
  select * into row from public.academy_team() where learner_id = current_setting('t.tl')::uuid;
  if (row.levels -> 't2' ->> 'skills_done')::integer <> 1 or (row.levels -> 't2' ->> 'skills_total')::integer < 2 then
    raise exception 'FAIL 20: skill counts wrong %', row.levels -> 't2';
  end if;
  if (row.levels -> 't2' ->> 'complete')::boolean then raise exception 'FAIL 21: T2 complete with one skill'; end if;
end $$;
reset role;

do $$ begin raise exception 'ALL PASS'; end $$;
