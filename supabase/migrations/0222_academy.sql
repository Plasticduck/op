-- Academy (docs/academy/README.md): a native training program inside Training.
-- Levels hold courses of lessons. Each lesson has a knowledge check (or a self-check),
-- and each level ends with scenario practice, an assessment and a sign-off that a
-- leader verifies. It replaces the hosted Mighty Wash Academy page.
--
-- Content is per account, read by everyone in it and edited by Admins.
-- Progress belongs to a learner: a signed-in user, or a team member without a login
-- whom a leader trains on their own device. Learners never read answer keys: they get
-- questions through academy_level_questions(), which leaves the answers out, and the check
-- functions grade on the server. Every progress write goes through a function.

-- ---- Who can do what --------------------------------------------------------------
-- Leaders see and verify the training of people at their sites. The shared office
-- screen login (corporate_display) is a manager in the database but isn't a leader.
create or replace function public.academy__leader()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users u
     where u.id = auth.uid()
       and u.role in ('owner', 'manager')
       and u.role_category is distinct from 'corporate_display'
  )
$$;

-- Admins edit the content.
create or replace function public.academy__editor()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_role() = 'owner', false)
$$;

-- ---- Content ------------------------------------------------------------------------
-- The program's own wording: its name, the home page intro, and the "why" notes on
-- the scenario, assessment and sign-off pages.
create table public.academy_programs (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  title text not null default 'Academy',
  eyebrow text,
  headline text,
  intro text,
  why_program text,
  why_scenarios text,
  why_assessment text,
  why_signoff text,
  draft_note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

create table public.academy_levels (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9-]{1,40}$'),          -- used in links
  num integer not null default 1,                                 -- place on the ladder
  title text not null,
  short_title text not null,
  role_text text,                                                 -- what the role is
  blurb text,
  why text,
  draft boolean not null default true,
  pass_pct integer not null default 80 check (pass_pct between 1 and 100),
  ack_formal boolean not null default false,                      -- a formal acknowledgment (GM)
  ack_title text,
  ack_statement text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  unique (account_id, key)
);

create table public.academy_courses (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  level_id uuid not null references public.academy_levels(id) on delete cascade,
  title text not null,
  blurb text,
  note text,                                                      -- e.g. who issued it
  draft boolean not null default false,
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index academy_courses_level_idx on public.academy_courses (level_id, sort);

create table public.academy_lessons (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  level_id uuid not null references public.academy_levels(id) on delete cascade,  -- set from the course
  course_id uuid not null references public.academy_courses(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9-]{1,40}$'),
  title text not null,
  minutes integer not null default 5 check (minutes between 1 and 240),
  why text,
  body text not null default '',                                  -- sanitized HTML
  kind text not null default 'quiz' check (kind in ('quiz', 'selfcheck')),
  checks text[] not null default '{}',                            -- self-check statements
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  unique (account_id, key)
);
create index academy_lessons_course_idx on public.academy_lessons (course_id, sort);
create index academy_lessons_level_idx on public.academy_lessons (level_id);

create or replace function public.academy__lesson_level()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select c.level_id, c.account_id into new.level_id, new.account_id
    from public.academy_courses c where c.id = new.course_id;
  if new.level_id is null then raise exception 'course not found'; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger academy_lessons_level before insert or update of course_id, title, minutes, why, body, kind, checks, sort, active
  on public.academy_lessons for each row execute function public.academy__lesson_level();

-- Knowledge-check questions (kind quiz, on a lesson), scenarios and assessment
-- questions (on the level).
create table public.academy_questions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  level_id uuid not null references public.academy_levels(id) on delete cascade,
  lesson_id uuid references public.academy_lessons(id) on delete cascade,
  kind text not null check (kind in ('quiz', 'scenario', 'assessment')),
  sort integer not null default 0,
  title text,                                                     -- a scenario's name
  prompt text not null,                                           -- the question, or the situation
  options text[] not null check (cardinality(options) between 2 and 8),
  answer integer not null,                                        -- 0-based
  why text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_questions_answer check (answer >= 0 and answer < cardinality(options)),
  constraint academy_questions_lesson check ((kind = 'quiz') = (lesson_id is not null))
);
create index academy_questions_level_idx on public.academy_questions (level_id, kind, sort);
create index academy_questions_lesson_idx on public.academy_questions (lesson_id, sort);

-- ---- Learners and progress -------------------------------------------------------------
create table public.academy_learners (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid unique references public.users(id) on delete cascade,
  employee_id uuid unique references public.employees(id) on delete cascade,
  name text not null,
  location_id uuid references public.locations(id) on delete set null,
  level_key text,                                                 -- "my current role"
  last_active_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_learners_one check (num_nonnulls(user_id, employee_id) = 1)
);
create index academy_learners_acct_idx on public.academy_learners (account_id, location_id);

create table public.academy_lesson_progress (
  learner_id uuid not null references public.academy_learners(id) on delete cascade,
  lesson_id uuid not null references public.academy_lessons(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  done_at timestamptz,
  score integer,
  data jsonb not null default '{}'::jsonb,                        -- self-check answers
  by_user uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (learner_id, lesson_id)
);

create table public.academy_attempts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  learner_id uuid not null references public.academy_learners(id) on delete cascade,
  level_id uuid not null references public.academy_levels(id) on delete cascade,
  kind text not null check (kind in ('scenarios', 'assessment')),
  correct integer not null,
  total integer not null,
  score integer not null,
  passed boolean not null,
  answers jsonb not null default '{}'::jsonb,                     -- question id -> option chosen
  by_user uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index academy_attempts_learner_idx on public.academy_attempts (learner_id, level_id, kind);

create table public.academy_signoffs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  learner_id uuid not null references public.academy_learners(id) on delete cascade,
  level_id uuid not null references public.academy_levels(id) on delete cascade,
  signer_name text not null,
  location_id uuid references public.locations(id) on delete set null,
  site_label text,
  signed_on date not null,
  leader_name text,
  statement text not null,                                        -- what they agreed to, as worded then
  signed_by uuid references public.users(id) on delete set null,  -- the login it was signed under
  signed_at timestamptz not null default now(),
  verified_by uuid references public.users(id) on delete set null,
  verified_name text,
  verified_at timestamptz,
  unique (learner_id, level_id)
);

-- ---- Row security ---------------------------------------------------------------------
alter table public.academy_programs enable row level security;
alter table public.academy_levels enable row level security;
alter table public.academy_courses enable row level security;
alter table public.academy_lessons enable row level security;
alter table public.academy_questions enable row level security;
alter table public.academy_learners enable row level security;
alter table public.academy_lesson_progress enable row level security;
alter table public.academy_attempts enable row level security;
alter table public.academy_signoffs enable row level security;

create policy academy_programs_select on public.academy_programs for select
  using (account_id = public.auth_account_id());
create policy academy_programs_edit on public.academy_programs for all
  using (account_id = public.auth_account_id() and public.academy__editor())
  with check (account_id = public.auth_account_id() and public.academy__editor());

create policy academy_levels_select on public.academy_levels for select
  using (account_id = public.auth_account_id());
create policy academy_levels_edit on public.academy_levels for all
  using (account_id = public.auth_account_id() and public.academy__editor())
  with check (account_id = public.auth_account_id() and public.academy__editor());

create policy academy_courses_select on public.academy_courses for select
  using (account_id = public.auth_account_id());
create policy academy_courses_edit on public.academy_courses for all
  using (account_id = public.auth_account_id() and public.academy__editor())
  with check (account_id = public.auth_account_id() and public.academy__editor());

create policy academy_lessons_select on public.academy_lessons for select
  using (account_id = public.auth_account_id());
create policy academy_lessons_edit on public.academy_lessons for all
  using (account_id = public.auth_account_id() and public.academy__editor())
  with check (account_id = public.auth_account_id() and public.academy__editor());

-- Answer keys: editors only. Everyone else uses academy_level_questions().
create policy academy_questions_edit on public.academy_questions for all
  using (account_id = public.auth_account_id() and public.academy__editor())
  with check (account_id = public.auth_account_id() and public.academy__editor());

-- Can the caller see this learner's record? Their own, or a leader's people.
create or replace function public.academy__can_see(p_learner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.academy_learners l
     where l.id = p_learner
       and l.account_id = public.auth_account_id()
       and (l.user_id = auth.uid()
            or (public.academy__leader()
                and (public.auth_role() = 'owner' or public.auth_has_location(l.location_id))))
  )
$$;

-- Can the caller record progress for this learner? Their own, or (for a team member
-- without a login) a leader at that person's site training them on this device.
create or replace function public.academy__can_act(p_learner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.academy_learners l
     where l.id = p_learner
       and l.account_id = public.auth_account_id()
       and (l.user_id = auth.uid()
            or (l.employee_id is not null and public.academy__leader()
                and (public.auth_role() = 'owner' or public.auth_has_location(l.location_id))))
  )
$$;

create policy academy_learners_select on public.academy_learners for select
  using (public.academy__can_see(id));
create policy academy_lesson_progress_select on public.academy_lesson_progress for select
  using (public.academy__can_see(learner_id));
create policy academy_attempts_select on public.academy_attempts for select
  using (public.academy__can_see(learner_id));
create policy academy_signoffs_select on public.academy_signoffs for select
  using (public.academy__can_see(learner_id));

-- ---- Learner records ----------------------------------------------------------------------
-- The caller's own learner record (made on first visit) and what they can do.
-- The shared office screen browses the content without a record.
create or replace function public.academy_me()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user public.users%rowtype;
  v_learner public.academy_learners%rowtype;
begin
  select * into v_user from public.users where id = auth.uid();
  if v_user.id is null then raise exception 'not signed in'; end if;
  if v_user.role_category is distinct from 'corporate_display' then
    select * into v_learner from public.academy_learners where user_id = v_user.id;
    if v_learner.id is null then
      insert into public.academy_learners (account_id, user_id, name, location_id, created_by)
      values (v_user.account_id, v_user.id, coalesce(nullif(trim(v_user.name), ''), v_user.email, 'Me'),
              case when cardinality(v_user.location_ids) = 1 then v_user.location_ids[1] end, v_user.id)
      returning * into v_learner;
    elsif v_learner.name is distinct from coalesce(nullif(trim(v_user.name), ''), v_learner.name) then
      update public.academy_learners set name = trim(v_user.name), updated_at = now()
       where id = v_learner.id returning * into v_learner;
    end if;
  end if;
  return jsonb_build_object(
    'learner', case when v_learner.id is null then null else to_jsonb(v_learner) end,
    'leader', public.academy__leader(),
    'editor', public.academy__editor()
  );
end $$;

-- A leader starts training a team member on their device. Returns that person's
-- learner record, made the first time.
create or replace function public.academy_trainee(p_employee uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp record;
  v_learner public.academy_learners%rowtype;
begin
  if not public.academy__leader() then raise exception 'Only leaders can train someone on their device'; end if;
  select e.id, trim(e.first_name || ' ' || coalesce(e.last_name, '')) as name, e.location_id, l.account_id
    into v_emp
    from public.employees e join public.locations l on l.id = e.location_id
   where e.id = p_employee;
  if v_emp.id is null or v_emp.account_id <> public.auth_account_id() then raise exception 'Team member not found'; end if;
  if not (public.auth_role() = 'owner' or public.auth_has_location(v_emp.location_id)) then
    raise exception 'That team member works at a site you do not lead';
  end if;
  insert into public.academy_learners (account_id, employee_id, name, location_id, created_by)
  values (v_emp.account_id, v_emp.id, v_emp.name, v_emp.location_id, auth.uid())
  on conflict (employee_id) do update
     set name = excluded.name, location_id = excluded.location_id, updated_at = now()
  returning * into v_learner;
  return to_jsonb(v_learner);
end $$;

-- Set "my current role" and site.
create or replace function public.academy_update_learner(p_learner uuid, p_level_key text, p_location uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.academy__can_act(p_learner) then raise exception 'forbidden'; end if;
  if p_location is not null and not (public.auth_role() = 'owner' or public.auth_has_location(p_location)) then
    raise exception 'Pick one of your sites';
  end if;
  if p_level_key is not null and not exists (
    select 1 from public.academy_levels where account_id = public.auth_account_id() and key = p_level_key
  ) then raise exception 'Unknown level'; end if;
  update public.academy_learners
     set level_key = p_level_key, location_id = p_location, updated_at = now()
   where id = p_learner;
end $$;

create or replace function public.academy__touch(p_learner uuid)
returns void language sql security definer set search_path = public as $$
  update public.academy_learners set last_active_at = now() where id = p_learner
$$;

-- ---- Questions without answers -------------------------------------------------------------
create or replace function public.academy_level_questions(p_level uuid)
returns table (id uuid, lesson_id uuid, kind text, sort integer, title text, prompt text, options text[])
language sql stable security definer set search_path = public as $$
  select q.id, q.lesson_id, q.kind, q.sort, q.title, q.prompt, q.options
    from public.academy_questions q
   where q.level_id = p_level and q.account_id = public.auth_account_id()
     and (q.lesson_id is null or exists (select 1 from public.academy_lessons s join public.academy_courses c on c.id = s.course_id
                                          where s.id = q.lesson_id and s.active and c.active))
   order by q.kind, q.lesson_id, q.sort, q.id
$$;

-- How many questions each lesson check, scenario set and assessment has (for the outline).
create or replace function public.academy_question_counts()
returns table (level_id uuid, lesson_id uuid, kind text, n integer)
language sql stable security definer set search_path = public as $$
  select q.level_id, q.lesson_id, q.kind, count(*)::integer
    from public.academy_questions q
   where q.account_id = public.auth_account_id()
   group by q.level_id, q.lesson_id, q.kind
$$;

-- Grade a set of answers ({question id: option index}) against the questions given.
-- Every question must be answered.
create or replace function public.academy__grade(p_ids uuid[], p_answers jsonb, p_reveal boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_q record;
  v_pick integer;
  v_right integer := 0;
  v_total integer := 0;
  v_results jsonb := '{}'::jsonb;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'Answer every question'; end if;
  for v_q in select q.id, q.answer, q.why from public.academy_questions q where q.id = any(p_ids) loop
    v_total := v_total + 1;
    if not (p_answers ? v_q.id::text) or jsonb_typeof(p_answers -> v_q.id::text) <> 'number' then
      raise exception 'Answer every question';
    end if;
    v_pick := (p_answers ->> v_q.id::text)::integer;
    if v_pick = v_q.answer then v_right := v_right + 1; end if;
    v_results := v_results || jsonb_build_object(v_q.id::text, jsonb_build_object(
      'correct', v_pick = v_q.answer,
      'answer', case when p_reveal or v_pick = v_q.answer then v_q.answer end,
      'why', case when p_reveal or v_pick = v_q.answer then v_q.why end));
  end loop;
  if v_total = 0 then raise exception 'There are no questions here yet'; end if;
  return jsonb_build_object('correct', v_right, 'total', v_total,
    'score', round(v_right * 100.0 / v_total)::integer, 'results', v_results);
end $$;

-- A lesson's knowledge check. All correct completes the lesson. Without a learner
-- (an editor previewing, or the office screen) it only grades.
create or replace function public.academy_check_quiz(p_lesson uuid, p_answers jsonb, p_learner uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lesson public.academy_lessons%rowtype;
  v_ids uuid[];
  v_out jsonb;
  v_done boolean;
begin
  select * into v_lesson from public.academy_lessons where id = p_lesson and account_id = public.auth_account_id();
  if v_lesson.id is null then raise exception 'Lesson not found'; end if;
  if p_learner is not null and not public.academy__can_act(p_learner) then raise exception 'forbidden'; end if;
  select array_agg(q.id) into v_ids from public.academy_questions q where q.lesson_id = p_lesson and q.kind = 'quiz';
  if v_ids is null then
    -- A lesson without a check is complete once it's been read.
    v_out := jsonb_build_object('correct', 0, 'total', 0, 'score', 100, 'results', '{}'::jsonb);
  else
    v_out := public.academy__grade(v_ids, p_answers, true);
  end if;
  v_done := (v_out ->> 'correct')::integer = (v_out ->> 'total')::integer;
  if p_learner is not null and v_done then
    insert into public.academy_lesson_progress (learner_id, lesson_id, account_id, done_at, score, by_user)
    values (p_learner, p_lesson, v_lesson.account_id, now(), 100, auth.uid())
    on conflict (learner_id, lesson_id) do update
       set done_at = coalesce(academy_lesson_progress.done_at, now()), score = 100, updated_at = now();
  end if;
  if p_learner is not null then perform public.academy__touch(p_learner); end if;
  return v_out || jsonb_build_object('done', v_done);
end $$;

-- A self-check lesson: save the boxes and the focus item; finishing needs a focus item.
create or replace function public.academy_save_selfcheck(p_lesson uuid, p_checks boolean[], p_focus integer, p_finish boolean, p_learner uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_lesson public.academy_lessons%rowtype;
begin
  select * into v_lesson from public.academy_lessons
   where id = p_lesson and account_id = public.auth_account_id() and kind = 'selfcheck';
  if v_lesson.id is null then raise exception 'Lesson not found'; end if;
  if not public.academy__can_act(p_learner) then raise exception 'forbidden'; end if;
  if p_finish and p_focus is null then raise exception 'Choose your focus item first'; end if;
  insert into public.academy_lesson_progress (learner_id, lesson_id, account_id, done_at, data, by_user)
  values (p_learner, p_lesson, v_lesson.account_id, case when p_finish then now() end,
          jsonb_build_object('checks', to_jsonb(coalesce(p_checks, '{}')), 'focus', p_focus), auth.uid())
  on conflict (learner_id, lesson_id) do update
     set data = excluded.data,
         done_at = case when p_finish then now() else academy_lesson_progress.done_at end,
         updated_at = now();
  perform public.academy__touch(p_learner);
end $$;

-- Scenario practice or the level assessment. Scenarios always show the standard;
-- the assessment shows the right answers only once it's passed, so a retake still
-- tests what was learned.
create or replace function public.academy_submit(p_level uuid, p_kind text, p_answers jsonb, p_learner uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_level public.academy_levels%rowtype;
  v_ids uuid[];
  v_out jsonb;
  v_pass boolean;
  v_reveal boolean;
begin
  if p_kind not in ('scenarios', 'assessment') then raise exception 'bad kind'; end if;
  select * into v_level from public.academy_levels where id = p_level and account_id = public.auth_account_id();
  if v_level.id is null then raise exception 'Level not found'; end if;
  if p_learner is not null and not public.academy__can_act(p_learner) then raise exception 'forbidden'; end if;
  select array_agg(q.id) into v_ids from public.academy_questions q
   where q.level_id = p_level and q.kind = case p_kind when 'scenarios' then 'scenario' else 'assessment' end;
  -- Grade once without revealing to learn the score, then reveal if allowed.
  v_out := public.academy__grade(coalesce(v_ids, '{}'), p_answers, false);
  v_pass := p_kind = 'scenarios' or (v_out ->> 'score')::integer >= v_level.pass_pct;
  v_reveal := p_kind = 'scenarios' or v_pass;
  if v_reveal then v_out := public.academy__grade(v_ids, p_answers, true); end if;
  if p_learner is not null then
    insert into public.academy_attempts (account_id, learner_id, level_id, kind, correct, total, score, passed, answers, by_user)
    values (v_level.account_id, p_learner, p_level, p_kind, (v_out ->> 'correct')::integer, (v_out ->> 'total')::integer,
            (v_out ->> 'score')::integer, v_pass, p_answers, auth.uid());
    perform public.academy__touch(p_learner);
  end if;
  return v_out || jsonb_build_object('passed', v_pass, 'pass_pct', v_level.pass_pct, 'revealed', v_reveal);
end $$;

-- ---- Sign-offs ------------------------------------------------------------------------------
-- The learner signs the level's statement. A leader training a team member on their
-- device can verify it in the same step.
create or replace function public.academy_sign(
  p_learner uuid, p_level uuid, p_name text, p_location uuid, p_signed_on date, p_leader_name text, p_verify boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_level public.academy_levels%rowtype;
  v_learner public.academy_learners%rowtype;
  v_site text;
  v_id uuid;
  v_me text;
begin
  if not public.academy__can_act(p_learner) then raise exception 'forbidden'; end if;
  select * into v_learner from public.academy_learners where id = p_learner;
  select * into v_level from public.academy_levels where id = p_level and account_id = v_learner.account_id;
  if v_level.id is null then raise exception 'Level not found'; end if;
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

-- Take a sign-off back. The learner can until a leader verifies it; a leader at their
-- site can any time.
create or replace function public.academy_unsign(p_signoff uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row public.academy_signoffs%rowtype;
  v_learner public.academy_learners%rowtype;
  v_leader boolean;
begin
  select * into v_row from public.academy_signoffs where id = p_signoff;
  if v_row.id is null or not public.academy__can_see(v_row.learner_id) then raise exception 'Sign-off not found'; end if;
  select * into v_learner from public.academy_learners where id = v_row.learner_id;
  v_leader := public.academy__leader() and v_learner.user_id is distinct from auth.uid();
  if not v_leader then
    if not public.academy__can_act(v_row.learner_id) then raise exception 'forbidden'; end if;
    if v_row.verified_at is not null then raise exception 'A leader has verified this sign-off, so ask them to reopen it'; end if;
  end if;
  delete from public.academy_signoffs where id = p_signoff;
end $$;

-- A leader confirms (or un-confirms) someone's sign-off. Nobody verifies their own.
create or replace function public.academy_verify(p_signoff uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row public.academy_signoffs%rowtype;
  v_me text;
begin
  select * into v_row from public.academy_signoffs where id = p_signoff;
  if v_row.id is null or not public.academy__can_see(v_row.learner_id) then raise exception 'Sign-off not found'; end if;
  if not public.academy__leader() then raise exception 'Only leaders verify sign-offs'; end if;
  if exists (select 1 from public.academy_learners where id = v_row.learner_id and user_id = auth.uid()) then
    raise exception 'Someone else has to verify your own sign-off';
  end if;
  select coalesce(nullif(trim(name), ''), email) into v_me from public.users where id = auth.uid();
  update public.academy_signoffs
     set verified_by = case when p_on then auth.uid() end,
         verified_name = case when p_on then v_me end,
         verified_at = case when p_on then now() end
   where id = p_signoff;
end $$;

-- ---- Team progress -----------------------------------------------------------------------------
-- One row per learner the caller can see, with a summary for each active level.
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
    select v.id, v.key,
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
             'signoff_id', so.id,
             'signed_on', so.signed_on,
             'verified', so.verified_at is not null))
             from lv left join public.academy_signoffs so on so.learner_id = p.id and so.level_id = lv.id
         ), '{}'::jsonb)
    from people p
   order by p.last_active_at desc nulls last, p.name
$$;

-- ---- Bringing over progress from the old hosted page ---------------------------------------------
-- The hosted Academy kept progress in the browser (localStorage). The first time a
-- person opens the native Academy on that browser, the app sends it here once. It
-- only fills gaps: anything already recorded stays as it is.
create or replace function public.academy_import_local(p_state jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_learner public.academy_learners%rowtype;
  v_k text;
  v_v jsonb;
  v_lesson public.academy_lessons%rowtype;
  v_level public.academy_levels%rowtype;
  v_loc uuid;
  v_n integer := 0;
  v_at timestamptz;
begin
  select * into v_learner from public.academy_learners where user_id = auth.uid();
  if v_learner.id is null then raise exception 'No learner record'; end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then return jsonb_build_object('imported', 0); end if;

  for v_k, v_v in select * from jsonb_each(coalesce(p_state -> 'lessons', '{}'::jsonb)) loop
    if jsonb_typeof(v_v) = 'object' and (v_v ->> 'done') = 'true' then
      select * into v_lesson from public.academy_lessons where account_id = v_learner.account_id and key = v_k;
      continue when v_lesson.id is null;
      v_at := case when (v_v ->> 'at') ~ '^\d{10,14}$' then to_timestamp((v_v ->> 'at')::bigint / 1000.0) else now() end;
      insert into public.academy_lesson_progress (learner_id, lesson_id, account_id, done_at, score, data, by_user)
      values (v_learner.id, v_lesson.id, v_learner.account_id, v_at,
              case when (v_v ->> 'score') ~ '^\d{1,3}$' then (v_v ->> 'score')::integer end,
              case when v_lesson.kind = 'selfcheck' and jsonb_typeof(p_state -> 'selfcheck') = 'object'
                   then jsonb_build_object('checks', coalesce(p_state -> 'selfcheck' -> 'checks', '[]'::jsonb),
                                           'focus', case when (p_state -> 'selfcheck' ->> 'focus') ~ '^\d+$'
                                                         then (p_state -> 'selfcheck' ->> 'focus')::integer end)
                   else '{}'::jsonb end,
              auth.uid())
      on conflict (learner_id, lesson_id) do nothing;
      if found then v_n := v_n + 1; end if;
    end if;
  end loop;

  for v_k, v_v in select * from jsonb_each(coalesce(p_state -> 'scenarios', '{}'::jsonb)) loop
    select * into v_level from public.academy_levels where account_id = v_learner.account_id and key = v_k;
    continue when v_level.id is null or jsonb_typeof(v_v) <> 'object' or (v_v ->> 'done') is distinct from 'true';
    continue when exists (select 1 from public.academy_attempts where learner_id = v_learner.id and level_id = v_level.id and kind = 'scenarios');
    insert into public.academy_attempts (account_id, learner_id, level_id, kind, correct, total, score, passed, by_user, created_at)
    select v_learner.account_id, v_learner.id, v_level.id, 'scenarios',
           least(coalesce(case when (v_v ->> 'right') ~ '^\d+$' then (v_v ->> 'right')::integer end, 0), n), n,
           case when n = 0 then 0 else round(least(coalesce(case when (v_v ->> 'right') ~ '^\d+$' then (v_v ->> 'right')::integer end, 0), n) * 100.0 / n)::integer end,
           true, auth.uid(),
           case when (v_v ->> 'at') ~ '^\d{10,14}$' then to_timestamp((v_v ->> 'at')::bigint / 1000.0) else now() end
      from (select count(*)::integer as n from public.academy_questions where level_id = v_level.id and kind = 'scenario') c;
    v_n := v_n + 1;
  end loop;

  for v_k, v_v in select * from jsonb_each(coalesce(p_state -> 'assess', '{}'::jsonb)) loop
    select * into v_level from public.academy_levels where account_id = v_learner.account_id and key = v_k;
    continue when v_level.id is null or jsonb_typeof(v_v) <> 'object' or coalesce(v_v ->> 'score', '') !~ '^\d{1,3}$';
    continue when exists (select 1 from public.academy_attempts where learner_id = v_learner.id and level_id = v_level.id and kind = 'assessment');
    insert into public.academy_attempts (account_id, learner_id, level_id, kind, correct, total, score, passed, by_user, created_at)
    select v_learner.account_id, v_learner.id, v_level.id, 'assessment',
           round(least((v_v ->> 'score')::integer, 100) * n / 100.0)::integer, n, least((v_v ->> 'score')::integer, 100),
           least((v_v ->> 'score')::integer, 100) >= v_level.pass_pct, auth.uid(),
           case when (v_v ->> 'at') ~ '^\d{10,14}$' then to_timestamp((v_v ->> 'at')::bigint / 1000.0) else now() end
      from (select count(*)::integer as n from public.academy_questions where level_id = v_level.id and kind = 'assessment') c;
    v_n := v_n + 1;
  end loop;

  for v_k, v_v in select * from jsonb_each(coalesce(p_state -> 'ack', '{}'::jsonb)) loop
    select * into v_level from public.academy_levels where account_id = v_learner.account_id and key = v_k;
    continue when v_level.id is null or jsonb_typeof(v_v) <> 'object' or coalesce(trim(v_v ->> 'name'), '') = '';
    -- The old page took the site as typed text; match it to a site name when we can.
    select l.id into v_loc from public.locations l
     where l.account_id = v_learner.account_id and not l.archived
       and coalesce(trim(v_v ->> 'site'), '') <> ''
       and (l.name ilike trim(v_v ->> 'site') or l.name ilike '%' || trim(v_v ->> 'site') || '%')
     order by length(l.name) limit 1;
    insert into public.academy_signoffs (account_id, learner_id, level_id, signer_name, location_id, site_label, signed_on,
                                         leader_name, statement, signed_by, signed_at)
    values (v_learner.account_id, v_learner.id, v_level.id, left(trim(v_v ->> 'name'), 200), v_loc,
            nullif(left(trim(coalesce(v_v ->> 'site', '')), 200), ''),
            case when (v_v ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' then (v_v ->> 'date')::date else current_date end,
            nullif(left(trim(coalesce(v_v ->> 'rm', '')), 200), ''), v_level.ack_statement, auth.uid(),
            case when (v_v ->> 'at') ~ '^\d{10,14}$' then to_timestamp((v_v ->> 'at')::bigint / 1000.0) else now() end)
    on conflict (learner_id, level_id) do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;

  if v_learner.level_key is null and (p_state ->> 'role') ~ '^[a-z0-9-]{1,40}$'
     and exists (select 1 from public.academy_levels where account_id = v_learner.account_id and key = p_state ->> 'role') then
    update public.academy_learners set level_key = p_state ->> 'role', updated_at = now() where id = v_learner.id;
  end if;
  if v_n > 0 then perform public.academy__touch(v_learner.id); end if;
  return jsonb_build_object('imported', v_n);
end $$;

-- ---- Editing questions ----------------------------------------------------------------------------
-- Replace one set of questions (a lesson's check, or a level's scenarios or
-- assessment) with the list given. Items that keep their id are updated in place.
create or replace function public.academy_save_questions(p_level uuid, p_lesson uuid, p_kind text, p_items jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_level public.academy_levels%rowtype;
  v_item jsonb;
  v_i integer := 0;
  v_keep uuid[] := '{}';
  v_id uuid;
  v_opts text[];
begin
  if not public.academy__editor() then raise exception 'Only Admins edit the Academy'; end if;
  select * into v_level from public.academy_levels where id = p_level and account_id = public.auth_account_id();
  if v_level.id is null then raise exception 'Level not found'; end if;
  if p_kind not in ('quiz', 'scenario', 'assessment') then raise exception 'bad kind'; end if;
  if (p_kind = 'quiz') <> (p_lesson is not null) then raise exception 'A knowledge check belongs to a lesson'; end if;
  if p_lesson is not null and not exists (select 1 from public.academy_lessons where id = p_lesson and level_id = p_level) then
    raise exception 'Lesson not found';
  end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'items must be a list'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_i := v_i + 1;
    select coalesce(array_agg(trim(o) order by n), '{}') into v_opts
      from jsonb_array_elements_text(coalesce(v_item -> 'options', '[]'::jsonb)) with ordinality as t(o, n);
    if coalesce(trim(v_item ->> 'prompt'), '') = '' then raise exception 'Question % has no wording', v_i; end if;
    if cardinality(v_opts) < 2 or exists (select 1 from unnest(v_opts) o where o = '') then
      raise exception 'Question % needs at least two filled-in choices', v_i;
    end if;
    if coalesce(v_item ->> 'answer', '') !~ '^\d+$' or (v_item ->> 'answer')::integer >= cardinality(v_opts) then
      raise exception 'Question % needs its right answer picked', v_i;
    end if;
    v_id := case when (v_item ->> 'id') ~ '^[0-9a-f-]{36}$' then (v_item ->> 'id')::uuid end;
    if v_id is not null and exists (select 1 from public.academy_questions where id = v_id and level_id = p_level and kind = p_kind
                                      and lesson_id is not distinct from p_lesson) then
      update public.academy_questions
         set sort = v_i, title = nullif(trim(v_item ->> 'title'), ''), prompt = trim(v_item ->> 'prompt'),
             options = v_opts, answer = (v_item ->> 'answer')::integer, why = nullif(trim(v_item ->> 'why'), ''),
             updated_at = now()
       where id = v_id;
    else
      insert into public.academy_questions (account_id, level_id, lesson_id, kind, sort, title, prompt, options, answer, why)
      values (v_level.account_id, p_level, p_lesson, p_kind, v_i, nullif(trim(v_item ->> 'title'), ''), trim(v_item ->> 'prompt'),
              v_opts, (v_item ->> 'answer')::integer, nullif(trim(v_item ->> 'why'), ''))
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;

  delete from public.academy_questions
   where level_id = p_level and kind = p_kind and lesson_id is not distinct from p_lesson and not (id = any(v_keep));
  return v_i;
end $$;

-- ---- Loading a whole program -------------------------------------------------------------------------
-- Loads a program from JSON ({levels: [...]} shaped like the hosted page's data) into
-- an account. Used by supabase/seed/academy_mighty_wash.sql; service role only.
create or replace function public.academy__import(p_account uuid, p_doc jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_l jsonb; v_c jsonb; v_s jsonb; v_q jsonb;
  v_level uuid; v_course uuid; v_lesson uuid;
  v_ci integer; v_si integer; v_qi integer;
  v_counts jsonb := jsonb_build_object('levels', 0, 'lessons', 0, 'questions', 0);
begin
  if exists (select 1 from public.academy_levels where account_id = p_account) then
    raise exception 'This account already has Academy content';
  end if;
  insert into public.academy_programs (account_id, title, eyebrow, headline, intro, why_program, why_scenarios,
                                       why_assessment, why_signoff, draft_note)
  values (p_account, coalesce(p_doc #>> '{program,title}', 'Academy'), p_doc #>> '{program,eyebrow}',
          p_doc #>> '{program,headline}', p_doc #>> '{program,intro}', p_doc #>> '{program,why_program}',
          p_doc #>> '{program,why_scenarios}', p_doc #>> '{program,why_assessment}', p_doc #>> '{program,why_signoff}',
          p_doc #>> '{program,draft_note}')
  on conflict (account_id) do nothing;
  for v_l in select * from jsonb_array_elements(p_doc -> 'levels') loop
    insert into public.academy_levels (account_id, key, num, title, short_title, role_text, blurb, why, draft, pass_pct,
                                       ack_formal, ack_title, ack_statement)
    values (p_account, v_l ->> 'key', (v_l ->> 'num')::integer, v_l ->> 'title', v_l ->> 'short', v_l ->> 'role',
            v_l ->> 'blurb', v_l ->> 'why', coalesce((v_l ->> 'draft')::boolean, true), coalesce((v_l ->> 'pass')::integer, 80),
            coalesce((v_l ->> 'ack_formal')::boolean, false), v_l ->> 'ack_title', coalesce(v_l ->> 'ack_statement', ''))
    returning id into v_level;
    v_counts := jsonb_set(v_counts, '{levels}', to_jsonb((v_counts ->> 'levels')::integer + 1));
    v_ci := 0;
    for v_c in select * from jsonb_array_elements(v_l -> 'courses') loop
      v_ci := v_ci + 1;
      insert into public.academy_courses (account_id, level_id, title, blurb, note, draft, sort)
      values (p_account, v_level, v_c ->> 'title', nullif(v_c ->> 'blurb', ''), nullif(v_c ->> 'note', ''),
              coalesce((v_c ->> 'draft')::boolean, false), v_ci)
      returning id into v_course;
      v_si := 0;
      for v_s in select * from jsonb_array_elements(v_c -> 'lessons') loop
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
  return v_counts;
end $$;

-- ---- Grants ---------------------------------------------------------------------------------------
revoke all on function public.academy__import(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.academy__grade(uuid[], jsonb, boolean) from public, anon, authenticated;
revoke all on function public.academy__lesson_level() from public, anon, authenticated;
revoke all on function public.academy__touch(uuid) from public, anon, authenticated;
revoke execute on function public.academy__can_act(uuid) from anon;
revoke execute on function public.academy__can_see(uuid) from anon;
revoke execute on function public.academy__leader() from anon;
revoke execute on function public.academy__editor() from anon;
revoke execute on function public.academy_me() from anon;
revoke execute on function public.academy_trainee(uuid) from anon;
revoke execute on function public.academy_update_learner(uuid, text, uuid) from anon;
revoke execute on function public.academy_level_questions(uuid) from anon;
revoke execute on function public.academy_question_counts() from anon;
revoke execute on function public.academy_check_quiz(uuid, jsonb, uuid) from anon;
revoke execute on function public.academy_save_selfcheck(uuid, boolean[], integer, boolean, uuid) from anon;
revoke execute on function public.academy_submit(uuid, text, jsonb, uuid) from anon;
revoke execute on function public.academy_sign(uuid, uuid, text, uuid, date, text, boolean) from anon;
revoke execute on function public.academy_unsign(uuid) from anon;
revoke execute on function public.academy_verify(uuid, boolean) from anon;
revoke execute on function public.academy_team(uuid) from anon;
revoke execute on function public.academy_import_local(jsonb) from anon;
revoke execute on function public.academy_save_questions(uuid, uuid, text, jsonb) from anon;
