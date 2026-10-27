-- Quarterly Goal Tracker (Operations - Admin), 2026-10-27. Kevan records each
-- executive's goals for a quarter and tracks them on a timeline. Goals belong to
-- a person by name (not a login), since one admin enters everything.
--   exec_goals            one goal: a number target (start -> target, current) or
--                         a set of milestones, over a start..due window
--   exec_goal_milestones  dated steps on a goal; done_at when completed
--   exec_goal_checkins    progress updates over time (value and/or a note), which
--                         draw the goal's progress line against its ideal pace
create table if not exists public.exec_goals (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  quarter         text not null,               -- e.g. '2026-Q4'
  owner_name      text not null,
  title           text not null,
  description     text,
  category        text,
  kind            text not null default 'metric' check (kind in ('metric', 'milestones')),
  unit            text,                        -- e.g. '$', '%', 'members'
  start_value     numeric,
  target_value    numeric,
  current_value   numeric,
  start_date      date not null,
  due_date        date not null,
  status_override text check (status_override in ('done', 'dropped')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists exec_goals_acct_quarter_idx on public.exec_goals (account_id, quarter);

create table if not exists public.exec_goal_milestones (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  goal_id    uuid not null references public.exec_goals(id) on delete cascade,
  title      text not null,
  due_date   date,
  done_at    timestamptz,
  sort       int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists exec_goal_milestones_goal_idx on public.exec_goal_milestones (goal_id);

create table if not exists public.exec_goal_checkins (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  goal_id      uuid not null references public.exec_goals(id) on delete cascade,
  checkin_date date not null default current_date,
  value        numeric,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists exec_goal_checkins_goal_idx on public.exec_goal_checkins (goal_id, checkin_date);

alter table public.exec_goals enable row level security;
alter table public.exec_goal_milestones enable row level security;
alter table public.exec_goal_checkins enable row level security;

-- Account owners only (the page itself is limited to Kevan while it's being set up).
create policy exec_goals_owner on public.exec_goals
  for all using (account_id = auth_account_id() and auth_role() = 'owner')
  with check (account_id = auth_account_id() and auth_role() = 'owner');
create policy exec_goal_milestones_owner on public.exec_goal_milestones
  for all using (account_id = auth_account_id() and auth_role() = 'owner')
  with check (account_id = auth_account_id() and auth_role() = 'owner');
create policy exec_goal_checkins_owner on public.exec_goal_checkins
  for all using (account_id = auth_account_id() and auth_role() = 'owner')
  with check (account_id = auth_account_id() and auth_role() = 'owner');
