-- Academy tracks, prerequisites and practical skills (docs/academy/README.md).
--
-- Tracks: the Academy's levels now sit in tracks. Every existing level moves into a
-- "Site Support" track (the Road Map to Success). Mighty Wash adds a Maintenance track
-- with tiers T1 to T3 (supabase/seed/academy_maintenance.sql).
-- Prerequisites: a level can require other levels, from any track, to be complete
-- before it can be signed off. Mighty Wash: General Manager needs T1 Maintenance.
-- Practical skills: a level can list hands-on skills that a leader checks off after
-- watching the person do each one. They count toward finishing the level.

-- ---- Tracks -------------------------------------------------------------------------
create table public.academy_tracks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9-]{1,40}$'),            -- the Training tab's ?tab=
  title text not null,
  unit_label text not null default 'Level',                        -- "Level 3", "Tier 1"
  code_prefix text not null default 'L' check (code_prefix ~ '^[A-Z]{1,3}$'),  -- "L3", "T1"
  eyebrow text,
  headline text,
  intro text,
  why text,
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  unique (account_id, key)
);

alter table public.academy_levels add column track_id uuid references public.academy_tracks(id) on delete restrict;
alter table public.academy_levels add column skills text[] not null default '{}';

-- Every account with levels gets a Site Support track holding them, with the
-- program's home-page wording (which belongs to that ladder).
insert into public.academy_tracks (account_id, key, title, unit_label, code_prefix, eyebrow, headline, intro, why, sort)
select a.account_id, 'site-support', 'Site Support', 'Level', 'L', p.eyebrow, p.headline, p.intro, p.why_program, 1
  from (select distinct account_id from public.academy_levels) a
  left join public.academy_programs p on p.account_id = a.account_id;
update public.academy_levels l set track_id = t.id
  from public.academy_tracks t
 where t.account_id = l.account_id and t.key = 'site-support' and l.track_id is null;
alter table public.academy_levels alter column track_id set not null;
create index academy_levels_track_idx on public.academy_levels (track_id, num);

-- ---- Prerequisites --------------------------------------------------------------------
create table public.academy_prereqs (
  account_id uuid not null references public.accounts(id) on delete cascade,
  level_id uuid not null references public.academy_levels(id) on delete cascade,
  requires_id uuid not null references public.academy_levels(id) on delete cascade,
  primary key (level_id, requires_id),
  constraint academy_prereqs_not_self check (level_id <> requires_id)
);

-- ---- Practical skills checked off by a leader -----------------------------------------
create table public.academy_skill_checks (
  learner_id uuid not null references public.academy_learners(id) on delete cascade,
  level_id uuid not null references public.academy_levels(id) on delete cascade,
  skill text not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  checked_by uuid references public.users(id) on delete set null,
  checked_name text,
  checked_at timestamptz not null default now(),
  primary key (learner_id, level_id, skill)
);

alter table public.academy_tracks enable row level security;
alter table public.academy_prereqs enable row level security;
alter table public.academy_skill_checks enable row level security;

create policy academy_tracks_select on public.academy_tracks for select
  using (account_id = public.auth_account_id());
create policy academy_tracks_edit on public.academy_tracks for all
  using (account_id = public.auth_account_id() and public.academy__editor())
  with check (account_id = public.auth_account_id() and public.academy__editor());
create policy academy_prereqs_select on public.academy_prereqs for select
  using (account_id = public.auth_account_id());
create policy academy_prereqs_edit on public.academy_prereqs for all
  using (account_id = public.auth_account_id() and public.academy__editor())
  with check (account_id = public.auth_account_id() and public.academy__editor());
create policy academy_skill_checks_select on public.academy_skill_checks for select
  using (public.academy__can_see(learner_id));

-- ---- Is a level complete for a learner? ---------------------------------------------------
-- Every active lesson done, scenarios answered, the assessment passed, every practical
-- skill checked off, and signed. (A level's own prerequisites aren't part of this; the
-- sign-off can't happen without them.)
create or replace function public.academy__complete(p_learner uuid, p_level uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    not exists (
      select 1 from public.academy_lessons s join public.academy_courses c on c.id = s.course_id and c.active
       where s.level_id = p_level and s.active
         and not exists (select 1 from public.academy_lesson_progress g
                          where g.learner_id = p_learner and g.lesson_id = s.id and g.done_at is not null))
    and (not exists (select 1 from public.academy_questions q where q.level_id = p_level and q.kind = 'scenario')
         or exists (select 1 from public.academy_attempts a where a.learner_id = p_learner and a.level_id = p_level and a.kind = 'scenarios'))
    and (not exists (select 1 from public.academy_questions q where q.level_id = p_level and q.kind = 'assessment')
         or exists (select 1 from public.academy_attempts a where a.learner_id = p_learner and a.level_id = p_level and a.kind = 'assessment' and a.passed))
    and not exists (
      select 1 from public.academy_levels v, unnest(v.skills) sk
       where v.id = p_level
         and not exists (select 1 from public.academy_skill_checks k where k.learner_id = p_learner and k.level_id = p_level and k.skill = sk))
    and exists (select 1 from public.academy_signoffs so where so.learner_id = p_learner and so.level_id = p_level)
$$;

-- ---- A leader checks off (or un-checks) a practical skill they watched ---------------------
create or replace function public.academy_check_skill(p_learner uuid, p_level uuid, p_skill text, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_level public.academy_levels%rowtype;
  v_me text;
begin
  if not public.academy__leader() then raise exception 'Only a leader checks off practical skills'; end if;
  if not public.academy__can_see(p_learner) then raise exception 'That person isn''t at one of your sites'; end if;
  if exists (select 1 from public.academy_learners where id = p_learner and user_id = auth.uid()) then
    raise exception 'Someone else has to check off your own skills';
  end if;
  select * into v_level from public.academy_levels where id = p_level and account_id = public.auth_account_id();
  if v_level.id is null or not (p_skill = any(v_level.skills)) then raise exception 'Skill not found'; end if;
  if p_on then
    select coalesce(nullif(trim(name), ''), email) into v_me from public.users where id = auth.uid();
    insert into public.academy_skill_checks (learner_id, level_id, skill, account_id, checked_by, checked_name)
    values (p_learner, p_level, p_skill, v_level.account_id, auth.uid(), v_me)
    on conflict (learner_id, level_id, skill) do nothing;
  else
    delete from public.academy_skill_checks where learner_id = p_learner and level_id = p_level and skill = p_skill;
  end if;
  perform public.academy__touch(p_learner);
end $$;

-- ---- Sign-off now checks prerequisites ----------------------------------------------------
create or replace function public.academy_sign(
  p_learner uuid, p_level uuid, p_name text, p_location uuid, p_signed_on date, p_leader_name text, p_verify boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_level public.academy_levels%rowtype;
  v_learner public.academy_learners%rowtype;
  v_site text;
  v_id uuid;
  v_me text;
  v_missing text;
begin
  if not public.academy__can_act(p_learner) then raise exception 'forbidden'; end if;
  select * into v_learner from public.academy_learners where id = p_learner;
  select * into v_level from public.academy_levels where id = p_level and account_id = v_learner.account_id;
  if v_level.id is null then raise exception 'Level not found'; end if;
  -- e.g. a General Manager can't be certified until T1 Maintenance is complete.
  select string_agg(r.short_title, ', ' order by t.sort, r.num) into v_missing
    from public.academy_prereqs p
    join public.academy_levels r on r.id = p.requires_id and r.active
    join public.academy_tracks t on t.id = r.track_id
   where p.level_id = p_level and not public.academy__complete(p_learner, r.id);
  if v_missing is not null then
    raise exception 'Finish % first. % can''t be signed off until then.', v_missing, v_level.short_title;
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Type your name to sign'; end if;
  if p_location is null then raise exception 'Pick the site'; end if;
  select name into v_site from public.locations where id = p_location and account_id = v_learner.account_id;
  if v_site is null then raise exception 'Site not found'; end if;
  if p_verify and (v_learner.employee_id is null or not public.academy__leader()) then
    raise exception 'Only a leader can verify a team member''s sign-off';
  end if;
  select coalesce(nullif(trim(name), ''), email) into v_me from public.users where id = auth.uid();
  insert into public.academy_signoffs (account_id, learner_id, level_id, signer_name, location_id, site_label, signed_on,
                                       leader_name, statement, signed_by, verified_by, verified_name, verified_at)
  values (v_learner.account_id, p_learner, p_level, trim(p_name), p_location, v_site, coalesce(p_signed_on, current_date),
          nullif(trim(p_leader_name), ''), v_level.ack_statement, auth.uid(),
          case when p_verify then auth.uid() end, case when p_verify then v_me end, case when p_verify then now() end)
  on conflict (learner_id, level_id) do nothing
  returning id into v_id;
  if v_id is null then raise exception 'This level is already signed'; end if;
  perform public.academy__touch(p_learner);
  return v_id;
end $$;

-- ---- Team progress gains practical skills and "complete" ---------------------------------
create or replace function public.academy_team(p_location uuid default null)
returns table (
  learner_id uuid, name text, is_user boolean, location_id uuid, level_key text,
  last_active_at timestamptz, levels jsonb
) language sql stable security definer set search_path = public as $$
  with me as (select public.auth_account_id() as acct, public.academy__leader() as leader, public.auth_role() as role),
  people as (
    select l.* from public.academy_learners l, me
     where l.account_id = me.acct and me.leader
       and (me.role = 'owner' or public.auth_has_location(l.location_id))
       and (p_location is null or l.location_id = p_location)
  ),
  lv as (
    select v.id, v.key, v.skills,
           (select count(*) from public.academy_lessons s where s.level_id = v.id and s.active
              and exists (select 1 from public.academy_courses c where c.id = s.course_id and c.active)) as lessons,
           exists (select 1 from public.academy_questions q where q.level_id = v.id and q.kind = 'scenario') as has_scen,
           exists (select 1 from public.academy_questions q where q.level_id = v.id and q.kind = 'assessment') as has_assess
      from public.academy_levels v, me where v.account_id = me.acct and v.active
  )
  select p.id, p.name, p.user_id is not null, p.location_id, p.level_key, p.last_active_at,
         coalesce((
           select jsonb_object_agg(lv.key, jsonb_build_object(
             'lessons_done', (select count(*) from public.academy_lesson_progress g
                                join public.academy_lessons s on s.id = g.lesson_id and s.active
                                join public.academy_courses c on c.id = s.course_id and c.active
                               where g.learner_id = p.id and s.level_id = lv.id and g.done_at is not null),
             'lessons_total', lv.lessons,
             'has_scenarios', lv.has_scen,
             'has_assessment', lv.has_assess,
             'scenarios', exists (select 1 from public.academy_attempts a where a.learner_id = p.id and a.level_id = lv.id and a.kind = 'scenarios'),
             'best', (select max(a.score) from public.academy_attempts a where a.learner_id = p.id and a.level_id = lv.id and a.kind = 'assessment'),
             'attempts', (select count(*) from public.academy_attempts a where a.learner_id = p.id and a.level_id = lv.id and a.kind = 'assessment'),
             'passed', exists (select 1 from public.academy_attempts a where a.learner_id = p.id and a.level_id = lv.id and a.kind = 'assessment' and a.passed),
             'skills_total', cardinality(lv.skills),
             'skills_done', (select count(*) from public.academy_skill_checks k where k.learner_id = p.id and k.level_id = lv.id and k.skill = any(lv.skills)),
             'signoff_id', so.id,
             'signed_on', so.signed_on,
             'verified', so.verified_at is not null,
             'complete', public.academy__complete(p.id, lv.id)))
             from lv left join public.academy_signoffs so on so.learner_id = p.id and so.level_id = lv.id
         ), '{}'::jsonb)
    from people p
   order by p.last_active_at desc nulls last, p.name
$$;

-- ---- Loading a program now loads it into a track -------------------------------------------
-- {track: {key, title, unit_label, code_prefix, eyebrow, headline, intro, why, sort},
--  levels: [... each may have "skills": [...] and "requires": [level keys]],
--  prereqs: [{level, requires}]}   (prereqs between existing levels, e.g. l6 needs t1)
-- With no track it uses a "Site Support" track. Refuses a track that already has levels.
create or replace function public.academy__import(p_account uuid, p_doc jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_l jsonb; v_c jsonb; v_s jsonb; v_q jsonb; v_p jsonb;
  v_track uuid; v_level uuid; v_course uuid; v_lesson uuid; v_a uuid; v_b uuid;
  v_ci integer; v_si integer; v_qi integer;
  v_t jsonb := coalesce(p_doc -> 'track', jsonb_build_object('key', 'site-support', 'title', 'Site Support'));
  v_counts jsonb := jsonb_build_object('levels', 0, 'lessons', 0, 'questions', 0, 'prereqs', 0);
begin
  insert into public.academy_programs (account_id, title, eyebrow, headline, intro, why_program, why_scenarios,
                                       why_assessment, why_signoff, draft_note)
  values (p_account, coalesce(p_doc #>> '{program,title}', 'Academy'), p_doc #>> '{program,eyebrow}',
          p_doc #>> '{program,headline}', p_doc #>> '{program,intro}', p_doc #>> '{program,why_program}',
          p_doc #>> '{program,why_scenarios}', p_doc #>> '{program,why_assessment}', p_doc #>> '{program,why_signoff}',
          p_doc #>> '{program,draft_note}')
  on conflict (account_id) do nothing;

  select id into v_track from public.academy_tracks where account_id = p_account and key = v_t ->> 'key';
  if v_track is null then
    insert into public.academy_tracks (account_id, key, title, unit_label, code_prefix, eyebrow, headline, intro, why, sort)
    values (p_account, v_t ->> 'key', v_t ->> 'title', coalesce(v_t ->> 'unit_label', 'Level'), coalesce(v_t ->> 'code_prefix', 'L'),
            coalesce(v_t ->> 'eyebrow', p_doc #>> '{program,eyebrow}'), coalesce(v_t ->> 'headline', p_doc #>> '{program,headline}'),
            coalesce(v_t ->> 'intro', p_doc #>> '{program,intro}'), coalesce(v_t ->> 'why', p_doc #>> '{program,why_program}'),
            coalesce((v_t ->> 'sort')::integer, 1))
    returning id into v_track;
  elsif exists (select 1 from public.academy_levels where track_id = v_track) then
    raise exception 'The % track already has levels', v_t ->> 'title';
  end if;

  for v_l in select * from jsonb_array_elements(coalesce(p_doc -> 'levels', '[]'::jsonb)) loop
    insert into public.academy_levels (account_id, track_id, key, num, title, short_title, role_text, blurb, why, draft, pass_pct,
                                       ack_formal, ack_title, ack_statement, skills)
    values (p_account, v_track, v_l ->> 'key', (v_l ->> 'num')::integer, v_l ->> 'title', v_l ->> 'short', v_l ->> 'role',
            v_l ->> 'blurb', v_l ->> 'why', coalesce((v_l ->> 'draft')::boolean, true), coalesce((v_l ->> 'pass')::integer, 80),
            coalesce((v_l ->> 'ack_formal')::boolean, false), v_l ->> 'ack_title', coalesce(v_l ->> 'ack_statement', ''),
            coalesce((select array_agg(x) from jsonb_array_elements_text(v_l -> 'skills') x), '{}'))
    returning id into v_level;
    v_counts := jsonb_set(v_counts, '{levels}', to_jsonb((v_counts ->> 'levels')::integer + 1));
    v_ci := 0;
    for v_c in select * from jsonb_array_elements(coalesce(v_l -> 'courses', '[]'::jsonb)) loop
      v_ci := v_ci + 1;
      insert into public.academy_courses (account_id, level_id, title, blurb, note, draft, sort)
      values (p_account, v_level, v_c ->> 'title', nullif(v_c ->> 'blurb', ''), nullif(v_c ->> 'note', ''),
              coalesce((v_c ->> 'draft')::boolean, false), v_ci)
      returning id into v_course;
      v_si := 0;
      for v_s in select * from jsonb_array_elements(coalesce(v_c -> 'lessons', '[]'::jsonb)) loop
        v_si := v_si + 1;
        insert into public.academy_lessons (account_id, level_id, course_id, key, title, minutes, why, body, kind, checks, sort)
        values (p_account, v_level, v_course, v_s ->> 'key', v_s ->> 'title', coalesce((v_s ->> 'minutes')::integer, 5),
                v_s ->> 'why', coalesce(v_s ->> 'body', ''), coalesce(v_s ->> 'kind', 'quiz'),
                coalesce((select array_agg(x) from jsonb_array_elements_text(v_s -> 'checks') x), '{}'), v_si)
        returning id into v_lesson;
        v_counts := jsonb_set(v_counts, '{lessons}', to_jsonb((v_counts ->> 'lessons')::integer + 1));
        v_qi := 0;
        for v_q in select * from jsonb_array_elements(coalesce(v_s -> 'quiz', '[]'::jsonb)) loop
          v_qi := v_qi + 1;
          insert into public.academy_questions (account_id, level_id, lesson_id, kind, sort, prompt, options, answer, why)
          values (p_account, v_level, v_lesson, 'quiz', v_qi, v_q ->> 'q',
                  (select array_agg(x) from jsonb_array_elements_text(v_q -> 'o') x), (v_q ->> 'a')::integer, v_q ->> 'why');
          v_counts := jsonb_set(v_counts, '{questions}', to_jsonb((v_counts ->> 'questions')::integer + 1));
        end loop;
      end loop;
    end loop;
    v_qi := 0;
    for v_q in select * from jsonb_array_elements(coalesce(v_l -> 'scenarios', '[]'::jsonb)) loop
      v_qi := v_qi + 1;
      insert into public.academy_questions (account_id, level_id, kind, sort, title, prompt, options, answer, why)
      values (p_account, v_level, 'scenario', v_qi, v_q ->> 't', v_q ->> 's',
              (select array_agg(x) from jsonb_array_elements_text(v_q -> 'o') x), (v_q ->> 'a')::integer, v_q ->> 'why');
      v_counts := jsonb_set(v_counts, '{questions}', to_jsonb((v_counts ->> 'questions')::integer + 1));
    end loop;
    v_qi := 0;
    for v_q in select * from jsonb_array_elements(coalesce(v_l -> 'assessment', '[]'::jsonb)) loop
      v_qi := v_qi + 1;
      insert into public.academy_questions (account_id, level_id, kind, sort, prompt, options, answer, why)
      values (p_account, v_level, 'assessment', v_qi, v_q ->> 'q',
              (select array_agg(x) from jsonb_array_elements_text(v_q -> 'o') x), (v_q ->> 'a')::integer, v_q ->> 'why');
      v_counts := jsonb_set(v_counts, '{questions}', to_jsonb((v_counts ->> 'questions')::integer + 1));
    end loop;
  end loop;

  -- Prerequisites, by level key: each level's "requires", then any listed separately.
  for v_p in
    select jsonb_build_object('level', l ->> 'key', 'requires', r)
      from jsonb_array_elements(coalesce(p_doc -> 'levels', '[]'::jsonb)) l, jsonb_array_elements_text(coalesce(l -> 'requires', '[]'::jsonb)) r
    union all
    select x from jsonb_array_elements(coalesce(p_doc -> 'prereqs', '[]'::jsonb)) x
  loop
    select a.id, b.id into v_a, v_b
      from public.academy_levels a, public.academy_levels b
     where a.account_id = p_account and a.key = v_p ->> 'level'
       and b.account_id = p_account and b.key = v_p ->> 'requires';
    if v_a is null or v_b is null then
      raise exception 'Prerequisite: % needs %, but one of those levels is missing', v_p ->> 'level', v_p ->> 'requires';
    end if;
    insert into public.academy_prereqs (account_id, level_id, requires_id) values (p_account, v_a, v_b)
    on conflict do nothing;
    v_counts := jsonb_set(v_counts, '{prereqs}', to_jsonb((v_counts ->> 'prereqs')::integer + 1));
  end loop;
  return v_counts;
end $$;

revoke all on function public.academy__complete(uuid, uuid) from public, anon, authenticated;
revoke all on function public.academy__import(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.academy_check_skill(uuid, uuid, text, boolean) from anon;
