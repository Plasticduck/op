-- Teams: MaintainX-style assignment groups. A work order can be assigned to a
-- team (in addition to individual assignees). Account-scoped; managers manage
-- teams, all members can see them.
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  color text not null default '#2563eb',
  description text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists teams_account_idx on public.teams (account_id, name);
alter table public.teams enable row level security;

drop policy if exists teams_select on public.teams;
drop policy if exists teams_write on public.teams;
create policy teams_select on public.teams for select
  using (account_id = auth_account_id());
create policy teams_write on public.teams for all
  using (account_id = auth_account_id() and auth_is_manager_plus())
  with check (account_id = auth_account_id() and auth_is_manager_plus());

create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  primary key (team_id, user_id)
);
alter table public.team_members enable row level security;

drop policy if exists team_members_select on public.team_members;
drop policy if exists team_members_write on public.team_members;
create policy team_members_select on public.team_members for select
  using (exists (select 1 from public.teams t
    where t.id = team_members.team_id and t.account_id = auth_account_id()));
create policy team_members_write on public.team_members for all
  using (exists (select 1 from public.teams t
    where t.id = team_members.team_id and t.account_id = auth_account_id() and auth_is_manager_plus()))
  with check (exists (select 1 from public.teams t
    where t.id = team_members.team_id and t.account_id = auth_account_id() and auth_is_manager_plus()));

-- Work-order team assignment (mirrors work_order_assignees; team_name denormalized
-- for display). Editable by anyone who can edit the work order's site.
create table if not exists public.work_order_teams (
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  team_name text not null,
  primary key (work_order_id, team_id)
);
alter table public.work_order_teams enable row level security;

drop policy if exists work_order_teams_select on public.work_order_teams;
drop policy if exists work_order_teams_write on public.work_order_teams;
create policy work_order_teams_select on public.work_order_teams for select
  using (exists (select 1 from public.work_orders w
    where w.id = work_order_teams.work_order_id and w.account_id = auth_account_id() and auth_has_location(w.location_id)));
create policy work_order_teams_write on public.work_order_teams for all
  using (exists (select 1 from public.work_orders w
    where w.id = work_order_teams.work_order_id and w.account_id = auth_account_id() and auth_has_location(w.location_id)))
  with check (exists (select 1 from public.work_orders w
    where w.id = work_order_teams.work_order_id and w.account_id = auth_account_id() and auth_has_location(w.location_id)));
