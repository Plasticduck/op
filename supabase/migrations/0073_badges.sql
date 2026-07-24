-- Employee badges. Two sources:
--   manual  - a catalog of recognition badges managers define and award here.
--   auto    - derived live from existing data (onboarding finished, required
--             training completed, a valid certification held). Those are computed
--             at read time from the training tables, so they are never stale and
--             need no rows here.
create table if not exists public.badges (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  name        text not null,
  description text,
  emoji       text,                                  -- small visual, e.g. 'star'
  tone        text not null default 'accent',        -- accent|ok|warn|danger|neutral
  active      boolean not null default true,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.employee_badges (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  badge_id        uuid not null references public.badges(id) on delete cascade,
  awarded_by      uuid references public.users(id) on delete set null,
  awarded_by_name text,
  note            text,
  earned_at       timestamptz not null default now(),
  unique (employee_id, badge_id)
);
create index if not exists employee_badges_emp_idx on public.employee_badges (employee_id);

alter table public.badges enable row level security;
alter table public.employee_badges enable row level security;

-- Readable across the account so badges can render next to names anywhere;
-- only managers maintain the catalog and hand out awards.
create policy badges_select on public.badges
  for select using (account_id = auth_account_id());
create policy badges_write on public.badges
  for all using (account_id = auth_account_id() and auth_is_manager_plus())
  with check (account_id = auth_account_id() and auth_is_manager_plus());

create policy employee_badges_select on public.employee_badges
  for select using (account_id = auth_account_id());
create policy employee_badges_write on public.employee_badges
  for all using (account_id = auth_account_id() and auth_is_manager_plus())
  with check (account_id = auth_account_id() and auth_is_manager_plus());
