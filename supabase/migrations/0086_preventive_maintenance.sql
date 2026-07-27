-- Preventive Maintenance: recurring plans that auto-generate work orders on a
-- schedule (every N days/weeks/months), optionally attaching a procedure and a
-- team to each generated work order. A daily job generates due plans.

alter table public.work_orders add column if not exists pm_plan_id uuid;

create table if not exists public.pm_plans (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  equipment_id uuid references public.equipment(id) on delete set null,
  title text not null,
  description text,
  priority text not null default 'medium',
  procedure_template_id uuid references public.procedure_templates(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  frequency_count int not null default 1 check (frequency_count >= 1),
  frequency_unit text not null default 'months' check (frequency_unit in ('days','weeks','months')),
  lead_time_days int not null default 0 check (lead_time_days >= 0),
  next_due_date date not null,
  last_generated_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pm_plans_account_idx on public.pm_plans (account_id, next_due_date);
alter table public.work_orders
  add constraint work_orders_pm_plan_fk foreign key (pm_plan_id) references public.pm_plans(id) on delete set null;

alter table public.pm_plans enable row level security;
drop policy if exists pm_plans_select on public.pm_plans;
drop policy if exists pm_plans_write on public.pm_plans;
create policy pm_plans_select on public.pm_plans for select
  using (account_id = auth_account_id() and auth_has_location(location_id));
create policy pm_plans_write on public.pm_plans for all
  using (account_id = auth_account_id() and auth_is_manager_plus())
  with check (account_id = auth_account_id() and auth_is_manager_plus());

-- Generate one work order from a plan (snapshotting its procedure + team).
-- p_advance = true rolls the plan's next_due_date forward one cycle (the daily
-- job); false leaves the schedule alone (a manual "generate now").
create or replace function public.pm_generate_for_plan(p_plan_id uuid, p_advance boolean default true)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare p public.pm_plans; woid uuid; procid uuid; tname text;
begin
  select * into p from public.pm_plans where id = p_plan_id;
  if not found then return null; end if;

  insert into public.work_orders
    (account_id, location_id, equipment_id, title, description, status, priority,
     work_type, recurrence, due_at, created_by_name, requested_by_name, pm_plan_id)
  values
    (p.account_id, p.location_id, p.equipment_id, p.title, p.description, 'open', p.priority,
     'preventive', 'none', p.next_due_date, 'Preventive Maintenance', 'Preventive Maintenance', p.id)
  returning id into woid;

  if p.procedure_template_id is not null then
    select name into tname from public.procedure_templates where id = p.procedure_template_id;
    insert into public.work_order_procedures (work_order_id, template_id, name)
      values (woid, p.procedure_template_id, coalesce(tname, 'Procedure')) returning id into procid;
    insert into public.work_order_procedure_items (wo_procedure_id, order_index, label, type, required, options)
      select procid, f.order_index, f.label, f.type, f.required, f.options
      from public.procedure_fields f where f.template_id = p.procedure_template_id;
  end if;

  if p.team_id is not null then
    insert into public.work_order_teams (work_order_id, team_id, team_name)
      select woid, t.id, t.name from public.teams t where t.id = p.team_id;
  end if;

  if p_advance then
    update public.pm_plans
      set next_due_date = (next_due_date + (frequency_count || ' ' || frequency_unit)::interval)::date,
          last_generated_at = now(), updated_at = now()
      where id = p.id;
  else
    update public.pm_plans set last_generated_at = now() where id = p.id;
  end if;
  return woid;
end $$;

-- Daily job: generate every active plan that is due (within its lead time).
create or replace function public.generate_due_pm_work_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare r record; n int := 0;
begin
  for r in select id from public.pm_plans where active and next_due_date <= current_date + lead_time_days loop
    perform public.pm_generate_for_plan(r.id, true);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Manual "generate now" for one plan, from the UI (account + manager checked).
create or replace function public.generate_pm_plan(p_plan_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare acct uuid;
begin
  select account_id into acct from public.pm_plans where id = p_plan_id;
  if acct is null or acct <> auth_account_id() or not auth_is_manager_plus() then
    raise exception 'not authorized';
  end if;
  return public.pm_generate_for_plan(p_plan_id, false);
end $$;

revoke all on function public.pm_generate_for_plan(uuid, boolean) from public, authenticated;
revoke all on function public.generate_due_pm_work_orders() from public, authenticated;
grant execute on function public.generate_pm_plan(uuid) to authenticated;
