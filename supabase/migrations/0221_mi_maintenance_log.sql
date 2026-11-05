-- Maintenance Log (docs/maintenance-inventory/MAINTENANCE_LOG.md): maintenance schedules
-- for assets and parts, a log of the work done, and the parts each job used.
--
-- Same access as Maintenance Inventory: mi_members decides what a person reaches, and
-- writes go through the functions below. The log also reads completed work orders and
-- the stock ledger, so it fills in from real work as soon as people use the inventory.
-- A schedule can run by the calendar, by cars washed at the site (site_daily_metrics,
-- the same count as the dashboards), or by whichever comes first.

-- ---- Schedules ------------------------------------------------------------------
create table public.mi_schedules (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  site_id uuid not null references public.locations(id) on delete cascade,
  asset_id uuid references public.equipment(id) on delete set null,
  title text not null,
  instructions text,
  task_type text not null default 'inspect' check (task_type in ('inspect', 'lubricate', 'clean', 'replace', 'adjust', 'test', 'other')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  every_n integer check (every_n is null or every_n > 0),
  every_unit text check (every_unit in ('days', 'weeks', 'months')),
  every_cars integer check (every_cars is null or every_cars > 0),
  soon_days integer not null default 7 check (soon_days between 0 and 90),
  -- Cars count from here until it's first done.
  start_date date not null default current_date,
  last_done_at timestamptz,
  -- Calendar schedules only. Moves forward from the day it's done, not from the old due date.
  next_due_date date,
  assigned_user_id uuid references public.users(id) on delete set null,
  auto_work_order boolean not null default false,
  active boolean not null default true,
  archived_at timestamptz,
  is_sample boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mi_schedules_has_interval check (every_n is not null or every_cars is not null),
  constraint mi_schedules_unit_pair check ((every_n is null) = (every_unit is null)),
  constraint mi_schedules_due_date check (every_n is null or next_due_date is not null)
);
create index mi_schedules_site on public.mi_schedules (site_id) where archived_at is null;
create index mi_schedules_asset on public.mi_schedules (asset_id) where asset_id is not null;

create table public.mi_schedule_parts (
  schedule_id uuid not null references public.mi_schedules(id) on delete cascade,
  part_id uuid not null references public.parts(id) on delete cascade,
  qty numeric(12,3) not null check (qty > 0),
  primary key (schedule_id, part_id)
);
create index mi_schedule_parts_part on public.mi_schedule_parts (part_id);

-- A work order a schedule opened. Closing it logs the job and moves the schedule on.
alter table public.work_orders add column if not exists mi_schedule_id uuid references public.mi_schedules(id) on delete set null;
create index if not exists work_orders_mi_schedule on public.work_orders (mi_schedule_id) where mi_schedule_id is not null;

-- ---- The log --------------------------------------------------------------------
create table public.mi_log_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  site_id uuid not null references public.locations(id) on delete cascade,
  asset_id uuid references public.equipment(id) on delete set null,
  schedule_id uuid references public.mi_schedules(id) on delete set null,
  work_order_id uuid references public.work_orders(id) on delete set null,
  follow_up_work_order_id uuid references public.work_orders(id) on delete set null,
  entry_type text not null check (entry_type in ('preventive', 'repair', 'inspection', 'cleaning', 'lubrication', 'replacement', 'adjustment', 'note')),
  title text not null,
  notes text,
  result text not null default 'ok' check (result in ('ok', 'follow_up', 'failed', 'skipped')),
  performed_at timestamptz not null default now(),
  performed_by uuid references public.users(id) on delete set null,
  performed_by_name text,
  vendor_id uuid references public.vendors(id) on delete set null,
  labor_minutes integer check (labor_minutes is null or labor_minutes >= 0),
  downtime_minutes integer check (downtime_minutes is null or downtime_minutes >= 0),
  outside_cost numeric(12,2) check (outside_cost is null or outside_cost >= 0),
  -- What the schedule said when this was done, for on-time reporting.
  due_date date,
  cars_since_last numeric,
  on_time boolean,
  -- The schedule before this entry, so voiding it can put the schedule back.
  prev_last_done_at timestamptz,
  prev_next_due_date date,
  source text not null default 'web' check (source in ('mobile', 'web', 'work_order', 'system')),
  client_txn_id text,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  is_sample boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index mi_log_account_time on public.mi_log_entries (account_id, performed_at desc);
create index mi_log_site_time on public.mi_log_entries (site_id, performed_at desc);
create index mi_log_asset_time on public.mi_log_entries (asset_id, performed_at desc) where asset_id is not null;
create index mi_log_schedule on public.mi_log_entries (schedule_id, performed_at desc) where schedule_id is not null;
create unique index mi_log_one_per_wo on public.mi_log_entries (work_order_id) where work_order_id is not null;

-- The parts a log entry used. Each line points at the ledger row that took it off the shelf.
create table public.mi_log_entry_parts (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.mi_log_entries(id) on delete cascade,
  ledger_id uuid references public.mi_inventory_transactions(id) on delete set null,
  part_id uuid not null references public.parts(id) on delete cascade,
  location_id uuid references public.mi_stock_locations(id) on delete set null,
  qty numeric(12,3) not null,
  unit_cost numeric(12,4) not null default 0,
  created_at timestamptz not null default now()
);
create index mi_log_entry_parts_entry on public.mi_log_entry_parts (entry_id);
create index mi_log_entry_parts_ledger on public.mi_log_entry_parts (ledger_id);

-- ---- Who can see what -----------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['mi_schedules', 'mi_schedule_parts', 'mi_log_entries', 'mi_log_entry_parts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;

create policy mi_schedules_select on public.mi_schedules for select
  using (account_id = auth_account_id() and site_id = any ((select public.auth_site_ids())::uuid[]));
create policy mi_schedule_parts_select on public.mi_schedule_parts for select
  using (exists (select 1 from public.mi_schedules s where s.id = schedule_id));
create policy mi_log_select on public.mi_log_entries for select
  using (account_id = auth_account_id() and site_id = any ((select public.auth_site_ids())::uuid[]));
create policy mi_log_parts_select on public.mi_log_entry_parts for select
  using (exists (select 1 from public.mi_log_entries g where g.id = entry_id));

create trigger mi_schedules_audit
  after update of title, instructions, task_type, priority, asset_id, every_n, every_unit, every_cars, soon_days, assigned_user_id, auto_work_order, active, archived_at
  or delete on public.mi_schedules
  for each row execute function public.mi__audit('id');
create trigger mi_log_entries_audit after update or delete on public.mi_log_entries
  for each row execute function public.mi__audit('id');

-- ---- Dates and car counts -------------------------------------------------------
create or replace function public.mi__today(p_account uuid) returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select timezone from public.mi_settings where account_id = p_account), 'America/Chicago'))::date
$$;

create or replace function public.mi__local_date(p_account uuid, p_at timestamptz) returns date
language sql stable security definer set search_path = public as $$
  select (p_at at time zone coalesce((select timezone from public.mi_settings where account_id = p_account), 'America/Chicago'))::date
$$;

create or replace function public.mi__add_interval(p_date date, p_n integer, p_unit text) returns date
language sql immutable as $$
  select case p_unit
    when 'days' then p_date + p_n
    when 'weeks' then p_date + 7 * p_n
    when 'months' then (p_date + make_interval(months => p_n))::date
  end
$$;

create or replace function public.mi__interval_days(p_n integer, p_unit text) returns numeric
language sql immutable as $$
  select case p_unit when 'days' then p_n when 'weeks' then 7 * p_n when 'months' then round(30.44 * p_n, 2) end::numeric
$$;

-- Site numbers come from the site name (MW01 is 1), the same match the dashboards use.
create or replace function public.mi__site_number(p_site uuid) returns integer
language sql stable security definer set search_path = public as $$
  select case when name ~ '[0-9]' then substring(name from '[0-9]+')::int end from public.locations where id = p_site
$$;

-- Cars washed at a site after one day, through another: DRB less test cars, plus FlexWash.
create or replace function public.mi__site_cars(p_account uuid, p_site uuid, p_after date, p_through date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(coalesce(m.drb_cars, 0) - coalesce(m.drb_test_cars, 0) + coalesce(m.flex_cars, 0)), 0)
  from public.site_daily_metrics m
  where m.account_id = p_account and m.site_number = public.mi__site_number(p_site) and m.date > p_after and m.date <= p_through
$$;

-- A day's cars at the site, averaged over the last 28 full days.
create or replace function public.mi__site_daily_cars(p_account uuid, p_site uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select round(public.mi__site_cars(p_account, p_site, public.mi__today(p_account) - 29, public.mi__today(p_account) - 1) / 28.0, 1)
$$;

-- ---- Where each schedule stands -------------------------------------------------
-- Calendar: overdue after the due date, due on it, coming up inside soon_days.
-- Cars: due at the count, overdue 10% past it, coming up at 90% or when the site's
-- recent volume says it'll get there inside soon_days. A schedule with both takes the
-- more urgent of the two.
create or replace function public.mi__schedule_state(p_ids uuid[])
returns table (schedule_id uuid, today date, anchor date, cars_since numeric, daily_cars numeric, cars_pct numeric, cars_due_on date, due_on date, days_left integer, status text)
language sql stable security definer set search_path = public as $$
  select s.id, t.today, a.anchor, c.cars, d.daily,
    case when s.every_cars is not null then round(100.0 * c.cars / s.every_cars, 1) end,
    cd.on_date,
    least(s.next_due_date, cd.on_date),
    least(s.next_due_date, cd.on_date) - t.today,
    case
      when not s.active or s.archived_at is not null then 'paused'
      when greatest(ts.sev, cs.sev) = 4 then 'overdue'
      when greatest(ts.sev, cs.sev) = 3 then 'due'
      when greatest(ts.sev, cs.sev) = 2 then 'soon'
      else 'ok'
    end
  from public.mi_schedules s
  cross join lateral (select public.mi__today(s.account_id) as today) t
  cross join lateral (select coalesce(public.mi__local_date(s.account_id, s.last_done_at), s.start_date) as anchor) a
  cross join lateral (select case when s.every_cars is not null then public.mi__site_cars(s.account_id, s.site_id, a.anchor, t.today) end as cars) c
  cross join lateral (select case when s.every_cars is not null then public.mi__site_daily_cars(s.account_id, s.site_id) end as daily) d
  cross join lateral (select case
      when s.every_cars is null then null
      when c.cars >= s.every_cars then t.today
      when coalesce(d.daily, 0) > 0 then t.today + ceil((s.every_cars - c.cars) / d.daily)::int
    end as on_date) cd
  cross join lateral (select case
      when s.every_n is null then 0
      when s.next_due_date < t.today then 4
      when s.next_due_date = t.today then 3
      when s.next_due_date <= t.today + s.soon_days then 2
      else 1 end as sev) ts
  cross join lateral (select case
      when s.every_cars is null then 0
      when c.cars >= s.every_cars * 1.1 then 4
      when c.cars >= s.every_cars then 3
      when c.cars >= s.every_cars * 0.9 or cd.on_date <= t.today + s.soon_days then 2
      else 1 end as sev) cs
  where s.id = any (p_ids)
$$;

-- Screen rows for schedules, most urgent first. Parts show what the site has free now.
create or replace function public.mi__schedule_json(p_ids uuid[], p_attention boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(q.x order by q.sev desc, q.due_on nulls last, q.title), '[]'::jsonb) from (
    select st.due_on, s.title,
      case st.status when 'overdue' then 4 when 'due' then 3 when 'soon' then 2 when 'ok' then 1 else 0 end as sev,
      jsonb_build_object(
        'id', s.id, 'site_id', s.site_id, 'site_name', l.name, 'asset_id', s.asset_id, 'asset_name', e.name,
        'title', s.title, 'instructions', s.instructions, 'task_type', s.task_type, 'priority', s.priority,
        'every_n', s.every_n, 'every_unit', s.every_unit, 'every_cars', s.every_cars, 'soon_days', s.soon_days,
        'start_date', s.start_date, 'last_done_at', s.last_done_at, 'next_due_date', s.next_due_date,
        'assigned_user_id', s.assigned_user_id, 'assigned_name', u.name, 'auto_work_order', s.auto_work_order,
        'active', s.active, 'is_sample', s.is_sample,
        'cars_since', st.cars_since, 'daily_cars', st.daily_cars, 'cars_pct', st.cars_pct, 'cars_due_on', st.cars_due_on,
        'due_on', st.due_on, 'days_left', st.days_left, 'status', st.status,
        'parts', pr.parts, 'parts_ready', pr.ready,
        'open_work_order', (select jsonb_build_object('id', w.id, 'number', w.number, 'status', w.status)
                            from public.work_orders w where w.mi_schedule_id = s.id and w.status in ('open', 'in_progress', 'on_hold')
                            order by w.created_at desc limit 1),
        'done_count', (select count(*) from public.mi_log_entries g where g.schedule_id = s.id and g.voided_at is null)
      ) as x
    from public.mi_schedules s
    join public.mi__schedule_state(p_ids) st on st.schedule_id = s.id
    left join public.locations l on l.id = s.site_id
    left join public.equipment e on e.id = s.asset_id
    left join public.users u on u.id = s.assigned_user_id
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_object('part_id', p.id, 'part_name', p.name, 'sku', p.sku, 'uom', p.uom, 'qty', sp.qty, 'available', av.qty) order by p.name), '[]'::jsonb) as parts,
             coalesce(bool_and(av.qty >= sp.qty), true) as ready
      from public.mi_schedule_parts sp
      join public.parts p on p.id = sp.part_id
      cross join lateral (
        select coalesce(sum(sl.available), 0) as qty
        from public.mi_stock_levels sl join public.mi_stock_locations ml on ml.id = sl.location_id and ml.active
        where sl.part_id = p.id and ml.site_id = s.site_id) av
      where sp.schedule_id = s.id) pr
    where not p_attention or st.status in ('overdue', 'due', 'soon')
  ) q
$$;

-- ---- Schedule screens -----------------------------------------------------------
create or replace function public.mi_schedules_list(p_site uuid default null, p_asset uuid default null, p_part uuid default null, p_status text default null, p_q text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  sites uuid[] := public.auth_site_ids();
  q text := nullif(trim(p_q), '');
  ids uuid[];
begin
  select coalesce(array_agg(s.id), '{}') into ids
  from public.mi_schedules s
  left join public.equipment e on e.id = s.asset_id
  where s.account_id = acct and s.archived_at is null and s.site_id = any (sites)
    and (p_site is null or s.site_id = p_site)
    and (p_asset is null or s.asset_id = p_asset)
    and (p_part is null or exists (select 1 from public.mi_schedule_parts sp where sp.schedule_id = s.id and sp.part_id = p_part))
    and (q is null or s.title ilike '%' || q || '%' or e.name ilike '%' || q || '%')
    and (case p_status when 'paused' then not s.active when 'attention' then s.active else true end);
  return public.mi__schedule_json(ids, p_status = 'attention');
end;
$$;

create or replace function public.mi_log_counts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
begin
  return (
    select jsonb_build_object(
      'overdue', count(*) filter (where status = 'overdue'),
      'due', count(*) filter (where status = 'due'),
      'soon', count(*) filter (where status = 'soon'))
    from public.mi__schedule_state(array(
      select id from public.mi_schedules
      where account_id = acct and active and archived_at is null and site_id = any (public.auth_site_ids()))));
end;
$$;

create or replace function public.mi_schedule_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  s public.mi_schedules;
begin
  select * into s from public.mi_schedules where id = p_id and account_id = acct and archived_at is null;
  if not found or not s.site_id = any (public.auth_site_ids()) then raise exception 'Schedule not found.'; end if;
  return jsonb_build_object(
    'schedule', public.mi__schedule_json(array[s.id]) -> 0,
    'can_manage', public.mi_rank() >= 2,
    'history', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select jsonb_build_object('id', g.id, 'performed_at', g.performed_at, 'who', g.performed_by_name, 'result', g.result, 'on_time', g.on_time,
        'due_date', g.due_date, 'cars_since_last', g.cars_since_last, 'notes', left(g.notes, 240), 'voided', g.voided_at is not null,
        'work_order_number', w.number) as x
      from public.mi_log_entries g left join public.work_orders w on w.id = g.work_order_id
      where g.schedule_id = s.id order by g.performed_at desc limit 50) h));
end;
$$;

-- Create (one per site picked) or edit. A schedule for one machine, set up for several
-- sites, uses each site's own machine of the same type, like checklist templates do.
create or replace function public.mi_save_schedule(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  sites uuid[] := public.auth_site_ids();
  today date := public.mi__today(acct);
  tz text := coalesce((select timezone from public.mi_settings where account_id = acct), 'America/Chicago');
  sid uuid := nullif(p ->> 'id', '')::uuid;
  s public.mi_schedules;
  ttl text := trim(coalesce(p ->> 'title', ''));
  asset uuid := nullif(p ->> 'asset_id', '')::uuid;
  asset_site uuid;
  site_asset uuid;
  n integer := nullif(p ->> 'every_n', '')::integer;
  unit text := nullif(p ->> 'every_unit', '');
  cars integer := nullif(p ->> 'every_cars', '')::integer;
  last_done date := nullif(p ->> 'last_done_on', '')::date;
  next_due date := nullif(p ->> 'next_due_date', '')::date;
  start_on date := coalesce(nullif(p ->> 'start_date', '')::date, today);
  ttype text := coalesce(nullif(p ->> 'task_type', ''), 'inspect');
  prio text := coalesce(nullif(p ->> 'priority', ''), 'medium');
  assignee uuid := nullif(p ->> 'assigned_user_id', '')::uuid;
  targets uuid[];
  site uuid;
  ids uuid[] := '{}';
  matched integer := 0;
  missing integer := 0;
  new_id uuid;
  line jsonb;
begin
  perform public.mi__require_rank(2, 'set up maintenance schedules');
  if ttl = '' then raise exception 'Give the schedule a name.'; end if;
  if n is null then unit := null; end if;
  if n is null and cars is null then raise exception 'Set how often: every so many days, weeks or months, or every so many cars.'; end if;
  if n is not null and (n <= 0 or unit is null or unit not in ('days', 'weeks', 'months')) then raise exception 'Set how often in days, weeks or months.'; end if;
  if cars is not null and cars <= 0 then raise exception 'Enter a car count above zero.'; end if;
  if last_done is not null and last_done > today then raise exception 'Last done can''t be in the future.'; end if;
  if ttype not in ('inspect', 'lubricate', 'clean', 'replace', 'adjust', 'test', 'other') then raise exception 'Pick a kind of task.'; end if;
  if prio not in ('low', 'medium', 'high') then raise exception 'Pick a priority.'; end if;
  if assignee is not null and not exists (select 1 from public.mi_members m where m.user_id = assignee and m.account_id = acct) then
    raise exception 'Assign it to someone with a Maintenance Inventory role.';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p -> 'parts', '[]'::jsonb)) x
             where not exists (select 1 from public.parts pp where pp.id = nullif(x ->> 'part_id', '')::uuid and pp.account_id = acct)) then
    raise exception 'Part not found.';
  end if;
  if asset is not null then
    select location_id into asset_site from public.equipment where id = asset and account_id = acct;
    if asset_site is null then raise exception 'Asset not found.'; end if;
  end if;

  if sid is not null then
    select * into s from public.mi_schedules where id = sid and account_id = acct and archived_at is null for update;
    if not found or not s.site_id = any (sites) then raise exception 'Schedule not found.'; end if;
    if asset is not null and asset_site <> s.site_id then raise exception 'That asset is at another site.'; end if;
    update public.mi_schedules set
      title = ttl,
      instructions = nullif(trim(coalesce(p ->> 'instructions', '')), ''),
      task_type = ttype, priority = prio, asset_id = asset,
      every_n = n, every_unit = unit, every_cars = cars,
      soon_days = coalesce(nullif(p ->> 'soon_days', '')::integer, soon_days),
      assigned_user_id = assignee,
      auto_work_order = coalesce((p ->> 'auto_work_order')::boolean, auto_work_order),
      active = coalesce((p ->> 'active')::boolean, active),
      last_done_at = case when last_done is not null then (last_done::timestamp + interval '12 hours') at time zone tz else last_done_at end,
      start_date = case when s.last_done_at is null and last_done is null then coalesce(nullif(p ->> 'start_date', '')::date, start_date) else start_date end,
      next_due_date = case
        when n is null then null
        when next_due is not null then next_due
        when last_done is not null then public.mi__add_interval(last_done, n, unit)
        when s.last_done_at is not null then public.mi__add_interval(public.mi__local_date(acct, s.last_done_at), n, unit)
        else coalesce(s.next_due_date, public.mi__add_interval(today, n, unit)) end,
      updated_at = now()
    where id = s.id;
    targets := array[s.id];
    ids := array[s.id];
  else
    select coalesce(array_agg(distinct x::uuid), '{}') into targets from jsonb_array_elements_text(coalesce(p -> 'site_ids', '[]'::jsonb)) x;
    if coalesce(array_length(targets, 1), 0) = 0 and nullif(p ->> 'site_id', '') is not null then targets := array[(p ->> 'site_id')::uuid]; end if;
    if coalesce(array_length(targets, 1), 0) = 0 and asset_site is not null then targets := array[asset_site]; end if;
    if coalesce(array_length(targets, 1), 0) = 0 then raise exception 'Pick at least one site.'; end if;
    foreach site in array targets loop
      if not site = any (sites) then raise exception 'That site isn''t one of yours.' using errcode = '42501'; end if;
      site_asset := null;
      if asset is not null then
        site_asset := case when site = asset_site then asset else public.mi__checklist_asset(site, asset) end;
        if site <> asset_site then
          if site_asset is null then missing := missing + 1; else matched := matched + 1; end if;
        end if;
      end if;
      insert into public.mi_schedules (account_id, site_id, asset_id, title, instructions, task_type, priority, every_n, every_unit, every_cars, soon_days,
        start_date, last_done_at, next_due_date, assigned_user_id, auto_work_order, active, created_by)
      values (acct, site, site_asset, ttl, nullif(trim(coalesce(p ->> 'instructions', '')), ''), ttype, prio, n, unit, cars,
        coalesce(nullif(p ->> 'soon_days', '')::integer, 7),
        coalesce(last_done, start_on),
        case when last_done is not null then (last_done::timestamp + interval '12 hours') at time zone tz end,
        case when n is null then null
             when next_due is not null then next_due
             when last_done is not null then public.mi__add_interval(last_done, n, unit)
             else public.mi__add_interval(today, n, unit) end,
        assignee, coalesce((p ->> 'auto_work_order')::boolean, false), coalesce((p ->> 'active')::boolean, true), auth.uid())
      returning id into new_id;
      ids := ids || new_id;
    end loop;
  end if;

  -- The parts list is replaced whole when it's sent.
  if p ? 'parts' then
    delete from public.mi_schedule_parts where schedule_id = any (ids);
    for line in select * from jsonb_array_elements(coalesce(p -> 'parts', '[]'::jsonb)) loop
      if coalesce(nullif(line ->> 'qty', '')::numeric, 0) > 0 then
        insert into public.mi_schedule_parts (schedule_id, part_id, qty)
        select x, (line ->> 'part_id')::uuid, (line ->> 'qty')::numeric from unnest(ids) x
        on conflict (schedule_id, part_id) do update set qty = excluded.qty;
      end if;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'ids', to_jsonb(ids), 'created', case when sid is null then coalesce(array_length(ids, 1), 0) else 0 end,
    'matched_assets', matched, 'missing_assets', missing);
end;
$$;

create or replace function public.mi_archive_schedule(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
begin
  perform public.mi__require_rank(2, 'remove maintenance schedules');
  update public.mi_schedules set archived_at = now(), active = false, updated_at = now()
  where id = p_id and account_id = acct and archived_at is null and site_id = any (public.auth_site_ids());
  if not found then raise exception 'Schedule not found.'; end if;
end;
$$;

-- A work order for a schedule, with its parts as suggestions (planned at zero, so
-- nothing is set aside until someone picks the location, like checklist work orders).
create or replace function public.mi__schedule_work_order(p_schedule uuid, p_by uuid, p_by_name text) returns public.work_orders
language plpgsql security definer set search_path = public as $$
declare
  s public.mi_schedules;
  w public.work_orders;
  due date;
  tz text;
begin
  select * into s from public.mi_schedules where id = p_schedule;
  select st.due_on into due from public.mi__schedule_state(array[s.id]) st;
  tz := coalesce((select timezone from public.mi_settings where account_id = s.account_id), 'America/Chicago');
  insert into public.work_orders (account_id, location_id, title, description, status, priority, work_type, equipment_id,
    created_by, created_by_name, requested_by, requested_by_name, due_at, mi_schedule_id)
  values (s.account_id, s.site_id, s.title, s.instructions, 'open', s.priority,
    case when s.task_type in ('inspect', 'test') then 'inspection' else 'preventive' end, s.asset_id,
    p_by, coalesce(p_by_name, 'Maintenance schedule'), p_by, coalesce(p_by_name, 'Maintenance schedule'),
    case when due is not null then (due::timestamp + interval '17 hours') at time zone tz end, s.id)
  returning * into w;
  insert into public.work_order_parts (work_order_id, catalog_part_id, part_name, quantity, unit_cost, qty_planned)
  select w.id, p.id, p.name, 0, p.unit_cost, 0
  from public.mi_schedule_parts sp join public.parts p on p.id = sp.part_id where sp.schedule_id = s.id;
  if s.assigned_user_id is not null then
    insert into public.work_order_assignees (work_order_id, user_id, user_name, assigned_at)
    select w.id, u.id, coalesce(u.name, u.email, 'Someone'), now() from public.users u where u.id = s.assigned_user_id;
  end if;
  return w;
end;
$$;

create or replace function public.mi_schedule_work_order(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  s public.mi_schedules;
  w public.work_orders;
  who text;
begin
  select * into s from public.mi_schedules where id = p_id and account_id = acct and archived_at is null for update;
  if not found or not s.site_id = any (public.auth_site_ids()) then raise exception 'Schedule not found.'; end if;
  select * into w from public.work_orders where mi_schedule_id = s.id and status in ('open', 'in_progress', 'on_hold') order by created_at desc limit 1;
  if found then
    return jsonb_build_object('ok', true, 'work_order_id', w.id, 'number', w.number, 'already_open', true);
  end if;
  select name into who from public.users where id = auth.uid();
  w := public.mi__schedule_work_order(s.id, auth.uid(), who);
  return jsonb_build_object('ok', true, 'work_order_id', w.id, 'number', w.number, 'already_open', false);
end;
$$;

-- After an entry is added or voided: last done is the latest entry that stands, or what
-- it was before the first entry if that's later (a backdated entry doesn't pull it back).
create or replace function public.mi__recompute_schedule(p_schedule uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.mi_schedules;
  base public.mi_log_entries;
  latest timestamptz;
begin
  select * into s from public.mi_schedules where id = p_schedule for update;
  if not found then return; end if;
  select * into base from public.mi_log_entries where schedule_id = s.id order by created_at limit 1;
  if not found then return; end if;
  select max(performed_at) into latest from public.mi_log_entries where schedule_id = s.id and voided_at is null;
  if latest is null or latest <= coalesce(base.prev_last_done_at, '-infinity'::timestamptz) then
    update public.mi_schedules set last_done_at = base.prev_last_done_at, next_due_date = base.prev_next_due_date, updated_at = now() where id = s.id;
  else
    update public.mi_schedules set last_done_at = latest,
      next_due_date = case when every_n is not null then public.mi__add_interval(public.mi__local_date(account_id, latest), every_n, every_unit) end,
      updated_at = now()
    where id = s.id;
  end if;
end;
$$;

-- ---- Writing the log ------------------------------------------------------------
-- One call does the whole job: the entry, every part taken off the shelf (through
-- mi_issue_part, so stock, cost and alerts work as anywhere else), photos already
-- uploaded, closing the schedule's work order, moving the schedule on, and an optional
-- follow-up work order. Safe to replay with the same client id.
create or replace function public.mi_log_add(p jsonb, p_source text default 'mobile', p_client_txn_id text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  prior jsonb;
  sites uuid[] := public.auth_site_ids();
  s public.mi_schedules;
  st_due date;
  st_cars numeric;
  st_status text;
  site uuid := nullif(p ->> 'site_id', '')::uuid;
  asset uuid := nullif(p ->> 'asset_id', '')::uuid;
  etype text := nullif(p ->> 'entry_type', '');
  res text := coalesce(nullif(p ->> 'result', ''), 'ok');
  at_time timestamptz := coalesce(nullif(p ->> 'performed_at', '')::timestamptz, now());
  ttl text := nullif(trim(coalesce(p ->> 'title', '')), '');
  note text := nullif(trim(coalesce(p ->> 'notes', '')), '');
  astatus text := nullif(p ->> 'asset_status', '');
  vendor uuid := nullif(p ->> 'vendor_id', '')::uuid;
  src text := case when p_source = 'web' then 'web' else 'mobile' end;
  wo public.work_orders;
  fu public.work_orders;
  who text;
  g public.mi_log_entries;
  line jsonb;
  i integer := 0;
  issued jsonb;
  sample boolean := false;
begin
  prior := public.mi__idem_start(acct, p_client_txn_id);
  if prior is not null then return prior; end if;

  if nullif(p ->> 'schedule_id', '') is not null then
    select * into s from public.mi_schedules where id = (p ->> 'schedule_id')::uuid and account_id = acct and archived_at is null for update;
    if not found or not s.site_id = any (sites) then raise exception 'Schedule not found.'; end if;
    site := coalesce(site, s.site_id);
    if site <> s.site_id then raise exception 'That schedule is for another site.'; end if;
    asset := coalesce(asset, s.asset_id);
    ttl := coalesce(ttl, s.title);
    etype := coalesce(etype, case s.task_type when 'inspect' then 'inspection' when 'test' then 'inspection' when 'lubricate' then 'lubrication'
      when 'clean' then 'cleaning' when 'replace' then 'replacement' when 'adjust' then 'adjustment' else 'preventive' end);
    select x.due_on, x.cars_since, x.status into st_due, st_cars, st_status from public.mi__schedule_state(array[s.id]) x;
    sample := s.is_sample;
  end if;

  if site is null or not site = any (sites) then raise exception 'That site isn''t one of yours.' using errcode = '42501'; end if;
  if ttl is null then raise exception 'Say what was done.'; end if;
  if etype is null or etype not in ('preventive', 'repair', 'inspection', 'cleaning', 'lubrication', 'replacement', 'adjustment', 'note') then
    raise exception 'Pick the kind of work.';
  end if;
  if res not in ('ok', 'follow_up', 'failed', 'skipped') then raise exception 'Pick how it went.'; end if;
  if res = 'skipped' then
    if s.id is null then raise exception 'Only scheduled maintenance can be skipped.'; end if;
    perform public.mi__require_rank(2, 'skip scheduled maintenance');
  end if;
  if at_time > now() + interval '10 minutes' then raise exception 'That time is in the future.'; end if;
  if asset is not null and not exists (select 1 from public.equipment where id = asset and account_id = acct and location_id = site) then
    raise exception 'That asset isn''t at this site.';
  end if;
  if astatus is not null then
    if astatus not in ('online', 'offline_planned', 'offline_unplanned', 'retired') then raise exception 'Pick a status for the asset.'; end if;
    if asset is null then raise exception 'Pick the asset to change its status.'; end if;
  end if;
  if vendor is not null and not exists (select 1 from public.vendors where id = vendor and account_id = acct) then raise exception 'Vendor not found.'; end if;
  if exists (select 1 from jsonb_array_elements_text(coalesce(p -> 'photos', '[]'::jsonb)) x where left(x, 37) <> acct::text || '/') then
    raise exception 'Photo not found.';
  end if;

  -- The work order this closes: the one named, or the schedule's open one.
  if nullif(p ->> 'work_order_id', '') is not null then
    select * into wo from public.work_orders where id = (p ->> 'work_order_id')::uuid and account_id = acct and location_id = site;
    if not found then raise exception 'Work order not found.'; end if;
    if wo.status in ('done', 'skipped') then raise exception 'Work order #% is already closed.', wo.number; end if;
  elsif s.id is not null then
    select * into wo from public.work_orders where mi_schedule_id = s.id and status in ('open', 'in_progress', 'on_hold') order by created_at desc limit 1;
  end if;

  -- Anything done with demo stock goes when the demo is removed.
  if exists (select 1 from jsonb_array_elements(coalesce(p -> 'parts', '[]'::jsonb)) x
             left join public.parts pp on pp.id = nullif(x ->> 'part_id', '')::uuid
             left join public.mi_stock_locations ml on ml.id = nullif(x ->> 'location_id', '')::uuid
             where pp.is_sample or ml.is_sample) then
    sample := true;
  end if;

  if coalesce((p ->> 'follow_up')::boolean, false) and res in ('follow_up', 'failed') then
    fu := public.mi_create_work_order(site, 'Follow up: ' || ttl, asset, case when res = 'failed' then 'high' else 'medium' end, note, null);
  end if;

  select name into who from public.users where id = auth.uid();
  insert into public.mi_log_entries (account_id, site_id, asset_id, schedule_id, work_order_id, follow_up_work_order_id, entry_type, title, notes, result,
    performed_at, performed_by, performed_by_name, vendor_id, labor_minutes, downtime_minutes, outside_cost, due_date, cars_since_last, on_time,
    prev_last_done_at, prev_next_due_date, source, client_txn_id, is_sample, created_by)
  values (acct, site, asset, s.id, wo.id, fu.id, etype, ttl, note, res,
    at_time, auth.uid(), who, vendor, nullif(p ->> 'labor_minutes', '')::integer, nullif(p ->> 'downtime_minutes', '')::integer, nullif(p ->> 'outside_cost', '')::numeric,
    st_due, st_cars, case when s.id is not null and res <> 'skipped' then st_status <> 'overdue' end,
    s.last_done_at, s.next_due_date, src, nullif(p_client_txn_id, ''), sample, auth.uid())
  returning * into g;

  for line in select * from jsonb_array_elements(coalesce(p -> 'parts', '[]'::jsonb)) loop
    i := i + 1;
    if coalesce(nullif(line ->> 'qty', '')::numeric, 0) <= 0 then continue; end if;
    if res = 'skipped' then raise exception 'A skipped task doesn''t use parts.'; end if;
    issued := public.mi_issue_part((line ->> 'part_id')::uuid, (line ->> 'location_id')::uuid, (line ->> 'qty')::numeric, wo.id, asset, src,
      case when coalesce(p_client_txn_id, '') <> '' then p_client_txn_id || ':' || i end, 'Maintenance log: ' || ttl);
    insert into public.mi_log_entry_parts (entry_id, ledger_id, part_id, location_id, qty, unit_cost)
    values (g.id, (issued ->> 'ledger_id')::uuid, (line ->> 'part_id')::uuid, (line ->> 'location_id')::uuid, (line ->> 'qty')::numeric, coalesce((issued ->> 'unit_cost')::numeric, 0));
  end loop;

  insert into public.mi_attachments (account_id, entity_type, entity_id, storage_path, file_name, kind, uploaded_by)
  select acct, 'log_entry', g.id, x, regexp_replace(x, '^.*/[0-9a-f-]{36}-', ''), 'photo', auth.uid()
  from jsonb_array_elements_text(coalesce(p -> 'photos', '[]'::jsonb)) x;

  -- Closing the work order fires its own trigger, which sees this entry and stops there.
  if wo.id is not null then
    update public.work_orders set status = case when res = 'skipped' then 'skipped' else 'done' end, updated_at = now() where id = wo.id;
  end if;

  if s.id is not null then perform public.mi__recompute_schedule(s.id); end if;

  if asset is not null then
    update public.equipment set
      last_serviced_at = case when etype <> 'note' and res <> 'skipped' then greatest(last_serviced_at, public.mi__local_date(acct, at_time)) else last_serviced_at end,
      status = coalesce(astatus, status)
    where id = asset;
  end if;

  return public.mi__idem_finish(acct, p_client_txn_id, jsonb_build_object('ok', true, 'id', g.id, 'parts', i, 'is_sample', sample,
    'work_order_id', wo.id, 'work_order_number', wo.number,
    'follow_up', case when fu.id is not null then jsonb_build_object('id', fu.id, 'number', fu.number) end));
end;
$$;

-- Fix the words and numbers on an entry. Parts stay as they were used: put them back with
-- Return on the part's page.
create or replace function public.mi_log_update(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  g public.mi_log_entries;
  etype text;
  res text;
begin
  select * into g from public.mi_log_entries where id = p_id and account_id = acct for update;
  if not found or not g.site_id = any (public.auth_site_ids()) then raise exception 'Entry not found.'; end if;
  if g.voided_at is not null then raise exception 'That entry was voided.'; end if;
  if not (public.mi_rank() >= 2 or (g.performed_by = auth.uid() and g.created_at > now() - interval '7 days')) then
    raise exception 'Only a manager can change this entry now.' using errcode = '42501';
  end if;
  etype := coalesce(nullif(p ->> 'entry_type', ''), g.entry_type);
  res := coalesce(nullif(p ->> 'result', ''), g.result);
  if etype not in ('preventive', 'repair', 'inspection', 'cleaning', 'lubrication', 'replacement', 'adjustment', 'note') then raise exception 'Pick the kind of work.'; end if;
  if res not in ('ok', 'follow_up', 'failed', 'skipped') or ((res = 'skipped') <> (g.result = 'skipped')) then raise exception 'Pick how it went.'; end if;
  if p ? 'vendor_id' and nullif(p ->> 'vendor_id', '') is not null and not exists (select 1 from public.vendors where id = (p ->> 'vendor_id')::uuid and account_id = acct) then
    raise exception 'Vendor not found.';
  end if;
  if p ? 'performed_at' and nullif(p ->> 'performed_at', '')::timestamptz > now() + interval '10 minutes' then raise exception 'That time is in the future.'; end if;
  if exists (select 1 from jsonb_array_elements_text(coalesce(p -> 'photos', '[]'::jsonb)) x where left(x, 37) <> acct::text || '/') then
    raise exception 'Photo not found.';
  end if;

  update public.mi_log_entries set
    title = coalesce(nullif(trim(coalesce(p ->> 'title', '')), ''), title),
    notes = case when p ? 'notes' then nullif(trim(coalesce(p ->> 'notes', '')), '') else notes end,
    entry_type = etype,
    result = res,
    performed_at = coalesce(nullif(p ->> 'performed_at', '')::timestamptz, performed_at),
    vendor_id = case when p ? 'vendor_id' then nullif(p ->> 'vendor_id', '')::uuid else vendor_id end,
    labor_minutes = case when p ? 'labor_minutes' then nullif(p ->> 'labor_minutes', '')::integer else labor_minutes end,
    downtime_minutes = case when p ? 'downtime_minutes' then nullif(p ->> 'downtime_minutes', '')::integer else downtime_minutes end,
    outside_cost = case when p ? 'outside_cost' then nullif(p ->> 'outside_cost', '')::numeric else outside_cost end,
    updated_at = now()
  where id = g.id;

  insert into public.mi_attachments (account_id, entity_type, entity_id, storage_path, file_name, kind, uploaded_by)
  select acct, 'log_entry', g.id, x, regexp_replace(x, '^.*/[0-9a-f-]{36}-', ''), 'photo', auth.uid()
  from jsonb_array_elements_text(coalesce(p -> 'photos', '[]'::jsonb)) x;

  if g.schedule_id is not null and p ? 'performed_at' then perform public.mi__recompute_schedule(g.schedule_id); end if;
end;
$$;

-- Mark an entry as a mistake. It stays in the history, struck through. A scheduled task
-- goes back to how it stood before.
create or replace function public.mi_log_void(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  g public.mi_log_entries;
begin
  select * into g from public.mi_log_entries where id = p_id and account_id = acct for update;
  if not found or not g.site_id = any (public.auth_site_ids()) then raise exception 'Entry not found.'; end if;
  if g.voided_at is not null then return; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why it''s being voided.'; end if;
  if not (public.mi_rank() >= 2 or (g.created_by = auth.uid() and g.created_at > now() - interval '24 hours')) then
    raise exception 'Only a manager can void this entry now.' using errcode = '42501';
  end if;
  update public.mi_log_entries set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason), updated_at = now() where id = g.id;
  if g.schedule_id is not null then perform public.mi__recompute_schedule(g.schedule_id); end if;
end;
$$;

-- A schedule's work order closed anywhere in Operator (Work Orders, Work Orders NEW, the
-- inventory's work order screen) logs the job and moves the schedule on.
create or replace function public.mi__wo_done_to_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s public.mi_schedules;
  st_due date;
  st_cars numeric;
  st_status text;
  eq uuid;
begin
  if new.status not in ('done', 'skipped') or old.status = new.status then return new; end if;
  if exists (select 1 from public.mi_log_entries where work_order_id = new.id) then return new; end if;
  select * into s from public.mi_schedules where id = new.mi_schedule_id for update;
  if not found then return new; end if;
  select x.due_on, x.cars_since, x.status into st_due, st_cars, st_status from public.mi__schedule_state(array[s.id]) x;
  eq := coalesce(new.equipment_id, s.asset_id);
  insert into public.mi_log_entries (account_id, site_id, asset_id, schedule_id, work_order_id, entry_type, title, notes, result,
    performed_at, performed_by, performed_by_name, due_date, cars_since_last, on_time, prev_last_done_at, prev_next_due_date, source, is_sample, created_by)
  values (new.account_id, new.location_id, eq, s.id, new.id,
    case s.task_type when 'inspect' then 'inspection' when 'test' then 'inspection' when 'lubricate' then 'lubrication' when 'clean' then 'cleaning'
      when 'replace' then 'replacement' when 'adjust' then 'adjustment' else 'preventive' end,
    new.title, 'Closed on work order #' || new.number || '.', case when new.status = 'skipped' then 'skipped' else 'ok' end,
    coalesce(new.completed_at, now()), new.completed_by, new.completed_by_name, st_due, st_cars,
    case when new.status = 'done' then st_status <> 'overdue' end, s.last_done_at, s.next_due_date, 'work_order', s.is_sample, new.completed_by);
  perform public.mi__recompute_schedule(s.id);
  if new.status = 'done' and eq is not null then
    update public.equipment set last_serviced_at = greatest(last_serviced_at, public.mi__local_date(new.account_id, coalesce(new.completed_at, now()))) where id = eq;
  end if;
  return new;
end;
$$;
create trigger work_orders_mi_schedule_done after update of status on public.work_orders
  for each row when (new.mi_schedule_id is not null) execute function public.mi__wo_done_to_log();

-- ---- Reading the log ------------------------------------------------------------
create or replace function public.mi__entry_parts_cost(p_entry uuid, p_wo uuid) returns table (cost numeric, n integer)
language sql stable security definer set search_path = public as $$
  select
    case when p_wo is not null
      then (select coalesce(round(sum(wp.quantity * coalesce(wp.unit_cost, 0)), 2), 0) from public.work_order_parts wp where wp.work_order_id = p_wo)
      else (select coalesce(round(sum(lp.qty * lp.unit_cost), 2), 0) from public.mi_log_entry_parts lp where lp.entry_id = p_entry) end,
    case when p_wo is not null
      then (select count(*) from public.work_order_parts wp where wp.work_order_id = p_wo and wp.quantity > 0)::integer
      else (select count(*) from public.mi_log_entry_parts lp where lp.entry_id = p_entry)::integer end
$$;

-- One timeline from three places: log entries, finished work orders no entry covers, and
-- parts used off the shelf outside a work order or entry. Newest first, `before` pages.
create or replace function public.mi_log_feed(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  sites uuid[] := public.auth_site_ids();
  vis uuid[] := public.mi_visible_location_ids();
  tz text := coalesce((select timezone from public.mi_settings where account_id = acct), 'America/Chicago');
  d_from date := coalesce(nullif(p ->> 'from', '')::date, public.mi__today(acct) - 30);
  d_to date := coalesce(nullif(p ->> 'to', '')::date, public.mi__today(acct));
  t_from timestamptz := d_from::timestamp at time zone tz;
  t_to timestamptz := (d_to + 1)::timestamp at time zone tz;
  t_before timestamptz := nullif(p ->> 'before', '')::timestamptz;
  f_site uuid := nullif(p ->> 'site_id', '')::uuid;
  f_asset uuid := nullif(p ->> 'asset_id', '')::uuid;
  f_sched uuid := nullif(p ->> 'schedule_id', '')::uuid;
  q text := nullif(trim(coalesce(p ->> 'q', '')), '');
  kinds text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'kinds') x), array['log', 'work_order', 'parts']);
  lim integer := greatest(least(coalesce(nullif(p ->> 'limit', '')::integer, 100), 1000), 1);
  with_voided boolean := coalesce((p ->> 'include_voided')::boolean, false);
  out_rows jsonb;
  more boolean;
begin
  with feed as (
    select g.performed_at as t_at, jsonb_build_object(
      'kind', 'log', 'id', g.id, 'at', g.performed_at, 'site_id', g.site_id, 'site_name', l.name, 'asset_id', g.asset_id, 'asset_name', e.name,
      'title', g.title, 'entry_type', g.entry_type, 'result', g.result, 'who', coalesce(g.performed_by_name, u.name), 'notes', left(g.notes, 300),
      'labor_minutes', g.labor_minutes, 'downtime_minutes', g.downtime_minutes, 'outside_cost', g.outside_cost, 'vendor_name', v.name,
      'parts_cost', pc.cost, 'parts_count', pc.n,
      'photos', (select count(*) from public.mi_attachments a where a.entity_type = 'log_entry' and a.entity_id = g.id),
      'schedule_id', g.schedule_id, 'work_order_id', g.work_order_id, 'work_order_number', w.number, 'on_time', g.on_time,
      'voided', g.voided_at is not null, 'is_sample', g.is_sample, 'source', g.source) as item
    from public.mi_log_entries g
    left join public.locations l on l.id = g.site_id
    left join public.equipment e on e.id = g.asset_id
    left join public.users u on u.id = g.performed_by
    left join public.work_orders w on w.id = g.work_order_id
    left join public.vendors v on v.id = g.vendor_id
    cross join lateral public.mi__entry_parts_cost(g.id, g.work_order_id) pc
    where 'log' = any (kinds) and g.account_id = acct and g.site_id = any (sites)
      and g.performed_at >= t_from and g.performed_at < t_to and (t_before is null or g.performed_at < t_before)
      and (f_site is null or g.site_id = f_site) and (f_asset is null or g.asset_id = f_asset) and (f_sched is null or g.schedule_id = f_sched)
      and (with_voided or g.voided_at is null)
      and (q is null or g.title ilike '%' || q || '%' or g.notes ilike '%' || q || '%' or e.name ilike '%' || q || '%' or g.performed_by_name ilike '%' || q || '%')
    union all
    select w.completed_at, jsonb_build_object(
      'kind', 'work_order', 'id', w.id, 'at', w.completed_at, 'site_id', w.location_id, 'site_name', l.name, 'asset_id', w.equipment_id, 'asset_name', e.name,
      'title', w.title, 'entry_type', case w.work_type when 'preventive' then 'preventive' when 'inspection' then 'inspection' else 'repair' end,
      'result', 'ok', 'who', w.completed_by_name, 'notes', left(w.description, 300), 'priority', w.priority,
      'labor_minutes', tm.minutes, 'outside_cost', oc.amount, 'parts_cost', wp.cost, 'parts_count', wp.n,
      'work_order_id', w.id, 'work_order_number', w.number, 'schedule_id', w.mi_schedule_id, 'voided', false, 'is_sample', false) as item
    from public.work_orders w
    left join public.locations l on l.id = w.location_id
    left join public.equipment e on e.id = w.equipment_id
    left join lateral (select sum(t.minutes) as minutes from public.work_order_time_entries t where t.work_order_id = w.id) tm on true
    left join lateral (select sum(c.amount) as amount from public.work_order_other_costs c where c.work_order_id = w.id) oc on true
    left join lateral (select round(sum(x.quantity * coalesce(x.unit_cost, 0)), 2) as cost, (count(*) filter (where x.quantity > 0))::integer as n
                       from public.work_order_parts x where x.work_order_id = w.id) wp on true
    where 'work_order' = any (kinds) and w.account_id = acct and w.status = 'done' and w.location_id = any (sites)
      and coalesce(w.department, 'maintenance') = 'maintenance'
      and w.completed_at >= t_from and w.completed_at < t_to and (t_before is null or w.completed_at < t_before)
      and (f_site is null or w.location_id = f_site) and (f_asset is null or w.equipment_id = f_asset) and (f_sched is null or w.mi_schedule_id = f_sched)
      and not exists (select 1 from public.mi_log_entries g where g.work_order_id = w.id)
      and (q is null or w.title ilike '%' || q || '%' or w.number::text = q or e.name ilike '%' || q || '%' or w.completed_by_name ilike '%' || q || '%')
    union all
    select m.created_at, jsonb_build_object(
      'kind', 'parts', 'id', m.id, 'at', m.created_at, 'site_id', sl.site_id, 'site_name', coalesce(l.name, sl.name), 'asset_id', m.asset_id, 'asset_name', e.name,
      'title', case when m.type = 'issue' then 'Used ' else 'Returned ' end || trim_scale(abs(m.qty)) || ' x ' || p.name,
      'entry_type', 'parts', 'result', 'ok', 'who', u.name, 'notes', m.notes,
      'parts_cost', round(-m.qty * m.unit_cost, 2), 'parts_count', 1, 'part_id', p.id, 'location_name', sl.name, 'source', m.source,
      'voided', false, 'is_sample', m.is_sample) as item
    from public.mi_inventory_transactions m
    join public.parts p on p.id = m.part_id
    join public.mi_stock_locations sl on sl.id = m.location_id
    left join public.locations l on l.id = sl.site_id
    left join public.equipment e on e.id = m.asset_id
    left join public.users u on u.id = m.performed_by
    where 'parts' = any (kinds) and m.account_id = acct and m.type in ('issue', 'return') and m.work_order_id is null
      and m.location_id = any (vis) and f_sched is null
      and not exists (select 1 from public.mi_log_entry_parts lp where lp.ledger_id = m.id)
      and m.created_at >= t_from and m.created_at < t_to and (t_before is null or m.created_at < t_before)
      and (f_site is null or sl.site_id = f_site) and (f_asset is null or m.asset_id = f_asset)
      and (q is null or p.name ilike '%' || q || '%' or e.name ilike '%' || q || '%' or u.name ilike '%' || q || '%')
  )
  select coalesce(jsonb_agg(f.item order by f.t_at desc), '[]'::jsonb), count(*) > lim into out_rows, more
  from (select * from feed order by t_at desc limit lim + 1) f;
  if more then out_rows := out_rows - lim; end if;
  return jsonb_build_object('rows', out_rows, 'more', more, 'from', d_from, 'to', d_to);
end;
$$;

create or replace function public.mi_log_entry(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  g public.mi_log_entries;
begin
  select * into g from public.mi_log_entries where id = p_id and account_id = acct;
  if not found or not g.site_id = any (public.auth_site_ids()) then raise exception 'Entry not found.'; end if;
  return jsonb_build_object(
    'entry', to_jsonb(g) || jsonb_build_object(
      'site_name', (select name from public.locations where id = g.site_id),
      'asset_name', (select name from public.equipment where id = g.asset_id),
      'asset_status', (select status from public.equipment where id = g.asset_id),
      'schedule_title', (select title from public.mi_schedules where id = g.schedule_id),
      'vendor_name', (select name from public.vendors where id = g.vendor_id),
      'voided_by_name', (select name from public.users where id = g.voided_by),
      'work_order', (select jsonb_build_object('id', w.id, 'number', w.number, 'status', w.status) from public.work_orders w where w.id = g.work_order_id),
      'follow_up', (select jsonb_build_object('id', w.id, 'number', w.number, 'status', w.status) from public.work_orders w where w.id = g.follow_up_work_order_id),
      'can_edit', g.voided_at is null and (public.mi_rank() >= 2 or (g.performed_by = auth.uid() and g.created_at > now() - interval '7 days')),
      'can_void', g.voided_at is null and (public.mi_rank() >= 2 or (g.created_by = auth.uid() and g.created_at > now() - interval '24 hours'))),
    'parts', case when g.work_order_id is not null then
        (select coalesce(jsonb_agg(jsonb_build_object('part_id', wp.catalog_part_id, 'part_name', wp.part_name, 'qty', wp.quantity, 'unit_cost', wp.unit_cost,
            'cost', round(wp.quantity * coalesce(wp.unit_cost, 0), 2), 'location_name', ml.name) order by wp.created_at), '[]'::jsonb)
         from public.work_order_parts wp left join public.mi_stock_locations ml on ml.id = wp.mi_location_id
         where wp.work_order_id = g.work_order_id and wp.quantity > 0)
      else
        (select coalesce(jsonb_agg(jsonb_build_object('part_id', lp.part_id, 'part_name', pp.name, 'qty', lp.qty, 'unit_cost', lp.unit_cost,
            'cost', round(lp.qty * lp.unit_cost, 2), 'location_name', ml.name) order by lp.created_at), '[]'::jsonb)
         from public.mi_log_entry_parts lp join public.parts pp on pp.id = lp.part_id left join public.mi_stock_locations ml on ml.id = lp.location_id
         where lp.entry_id = g.id) end,
    'parts_cost', (select cost from public.mi__entry_parts_cost(g.id, g.work_order_id)),
    'photos', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'storage_path', a.storage_path, 'file_name', a.file_name) order by a.created_at), '[]'::jsonb)
               from public.mi_attachments a where a.entity_type = 'log_entry' and a.entity_id = g.id));
end;
$$;

-- ---- Parts the schedules will need ----------------------------------------------
-- How many times each schedule comes due inside the window (by the calendar, or by the
-- site's recent car volume), times its parts, against what each site has free and on
-- order. Shortages first.
create or replace function public.mi_parts_forecast(p_days integer default 30, p_site uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  d_today date := public.mi__today(acct);
  horizon date := public.mi__today(acct) + greatest(least(coalesce(p_days, 30), 365), 1);
  ids uuid[];
begin
  select coalesce(array_agg(s.id), '{}') into ids from public.mi_schedules s
  where s.account_id = acct and s.active and s.archived_at is null and s.site_id = any (public.auth_site_ids())
    and (p_site is null or s.site_id = p_site)
    and exists (select 1 from public.mi_schedule_parts sp where sp.schedule_id = s.id);
  return (
    with occ as (
      select s.id, s.site_id, s.title, st.due_on,
        greatest(
          case when s.every_n is not null and s.next_due_date <= horizon
            then 1 + floor((horizon - greatest(s.next_due_date, d_today)) / public.mi__interval_days(s.every_n, s.every_unit))::integer else 0 end,
          case when s.every_cars is null then 0
               when coalesce(st.daily_cars, 0) > 0 then floor((st.cars_since + st.daily_cars * (horizon - d_today)) / s.every_cars)::integer
               when st.cars_since >= s.every_cars then 1 else 0 end) as times
      from public.mi_schedules s join public.mi__schedule_state(ids) st on st.schedule_id = s.id
    ),
    need as (
      select o.site_id, sp.part_id, sum(sp.qty * o.times) as qty, min(o.due_on) as first_due,
        jsonb_agg(jsonb_build_object('schedule_id', o.id, 'title', o.title, 'times', o.times, 'qty', sp.qty * o.times, 'due_on', o.due_on) order by o.due_on) as schedules
      from occ o join public.mi_schedule_parts sp on sp.schedule_id = o.id
      where o.times > 0
      group by 1, 2
    )
    select coalesce(jsonb_agg(q.x order by q.short desc, q.first_due, q.part_name), '[]'::jsonb) from (
      select greatest(n.qty - av.qty - oo.qty, 0) as short, n.first_due, p.name as part_name, jsonb_build_object(
        'site_id', n.site_id, 'site_name', l.name, 'part_id', p.id, 'part_name', p.name, 'sku', p.sku, 'uom', p.uom, 'is_critical', p.is_critical,
        'need', n.qty, 'available', av.qty, 'on_order', oo.qty, 'short', greatest(n.qty - av.qty - oo.qty, 0), 'first_due', n.first_due,
        'schedules', n.schedules,
        'vendor_id', pv.vendor_id, 'vendor_name', v.name, 'unit_cost', coalesce(pv.price, p.unit_cost),
        'pack_qty', greatest(coalesce(pv.pack_qty, p.pack_qty, 1), 0.001),
        'location_id', loc.id, 'location_name', loc.name, 'can_order', loc.id is not null and public.mi_can_manage_at(loc.id)) as x
      from need n
      join public.parts p on p.id = n.part_id
      join public.locations l on l.id = n.site_id
      cross join lateral (
        select coalesce(sum(sl.available), 0) as qty from public.mi_stock_levels sl
        join public.mi_stock_locations ml on ml.id = sl.location_id and ml.active
        where sl.part_id = p.id and ml.site_id = n.site_id) av
      cross join lateral (
        select coalesce(sum(public.mi__on_order(p.id, ml.id)), 0) as qty from public.mi_stock_locations ml where ml.site_id = n.site_id and ml.active) oo
      left join public.mi_part_vendors pv on pv.part_id = p.id and pv.preferred
      left join public.vendors v on v.id = pv.vendor_id
      left join lateral (
        select ml.id, ml.name from public.mi_stock_locations ml
        left join public.mi_stock_levels sl on sl.location_id = ml.id and sl.part_id = p.id
        where ml.site_id = n.site_id and ml.active and ml.type <> 'truck'
        order by (sl.id is not null) desc, sl.on_hand desc nulls last, (ml.type = 'stockroom') desc, ml.name limit 1) loc on true
    ) q);
end;
$$;

-- ---- Reports --------------------------------------------------------------------
create or replace function public.mi_log_report(p_from date default null, p_to date default null, p_site uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  sites uuid[];
  vis uuid[];
  tz text := coalesce((select timezone from public.mi_settings where account_id = acct), 'America/Chicago');
  d_to date := coalesce(p_to, public.mi__today(acct));
  d_from date := coalesce(p_from, public.mi__today(acct) - 89);
  t_from timestamptz := d_from::timestamp at time zone tz;
  t_to timestamptz := (d_to + 1)::timestamp at time zone tz;
  sched_ids uuid[];
begin
  perform public.mi__require_rank(2, 'see maintenance reports');
  select coalesce(array_agg(x), '{}') into sites from unnest(public.auth_site_ids()) x where p_site is null or x = p_site;
  select coalesce(array_agg(l.id), '{}') into vis from public.mi_stock_locations l where l.id = any (public.mi_visible_location_ids()) and l.site_id = any (sites);
  select coalesce(array_agg(id), '{}') into sched_ids from public.mi_schedules where account_id = acct and active and archived_at is null and site_id = any (sites);

  return (
    with ent as (
      select g.*, (g.result in ('follow_up', 'failed') or g.entry_type = 'repair') as is_problem
      from public.mi_log_entries g
      where g.account_id = acct and g.site_id = any (sites) and g.voided_at is null and g.performed_at >= t_from and g.performed_at < t_to
    ),
    wos as (
      select w.* from public.work_orders w
      where w.account_id = acct and w.location_id = any (sites) and w.status = 'done' and coalesce(w.department, 'maintenance') = 'maintenance'
        and w.completed_at >= t_from and w.completed_at < t_to
        and not exists (select 1 from public.mi_log_entries g where g.work_order_id = w.id)
    ),
    led as (
      select m.*, ml.site_id from public.mi_inventory_transactions m join public.mi_stock_locations ml on ml.id = m.location_id
      where m.account_id = acct and m.location_id = any (vis) and m.type in ('issue', 'return') and m.created_at >= t_from and m.created_at < t_to
    ),
    states as (select * from public.mi__schedule_state(sched_ids)),
    events as (
      select site_id, asset_id, performed_at as ev_at, (schedule_id is not null and result <> 'skipped') as preventive, is_problem from ent
      union all
      select location_id, equipment_id, completed_at, work_type in ('preventive', 'inspection'), work_type = 'reactive' from wos
    )
    select jsonb_build_object(
      'range', jsonb_build_object('from', d_from, 'to', d_to),
      'scheduled_done', (select count(*) from ent where schedule_id is not null and result <> 'skipped'),
      'skipped', (select count(*) from ent where result = 'skipped'),
      'on_time_pct', (select round(100.0 * count(*) filter (where on_time) / nullif(count(*) filter (where on_time is not null), 0), 1) from ent),
      'schedules_active', coalesce(array_length(sched_ids, 1), 0),
      'overdue_now', (select count(*) from states where status = 'overdue'),
      'due_now', (select count(*) from states where status = 'due'),
      'entries', (select count(*) from ent),
      'work_orders_done', (select count(*) from wos),
      'repairs', (select count(*) from events where is_problem),
      'preventive', (select count(*) from events where preventive),
      'labor_hours', round(((select coalesce(sum(labor_minutes), 0) from ent)
        + (select coalesce(sum(t.minutes), 0) from public.work_order_time_entries t where t.work_order_id in (select id from wos))) / 60.0, 1),
      'downtime_hours', round((select coalesce(sum(downtime_minutes), 0) from ent) / 60.0, 1),
      'parts_cost', (select coalesce(round(sum(-qty * unit_cost), 2), 0) from led),
      'outside_cost', (select coalesce(sum(outside_cost), 0) from ent)
        + (select coalesce(sum(c.amount), 0) from public.work_order_other_costs c where c.work_order_id in (select id from wos)),
      'by_site', (select coalesce(jsonb_agg(x order by x ->> 'site_name'), '[]'::jsonb) from (
        select jsonb_build_object('site_id', l.id, 'site_name', l.name,
          'scheduled_done', (select count(*) from ent where site_id = l.id and schedule_id is not null and result <> 'skipped'),
          'on_time_pct', (select round(100.0 * count(*) filter (where on_time) / nullif(count(*) filter (where on_time is not null), 0), 1) from ent where site_id = l.id),
          'overdue_now', (select count(*) from states st join public.mi_schedules s on s.id = st.schedule_id where s.site_id = l.id and st.status = 'overdue'),
          'repairs', (select count(*) from events where site_id = l.id and is_problem),
          'parts_cost', (select coalesce(round(sum(-qty * unit_cost), 2), 0) from led where site_id = l.id),
          'outside_cost', (select coalesce(sum(outside_cost), 0) from ent where site_id = l.id),
          'labor_hours', round((select coalesce(sum(labor_minutes), 0) from ent where site_id = l.id) / 60.0, 1),
          'downtime_hours', round((select coalesce(sum(downtime_minutes), 0) from ent where site_id = l.id) / 60.0, 1),
          'cars', public.mi__site_cars(acct, l.id, d_from - 1, d_to)) as x
        from public.locations l
        where l.id = any (sites)
          and (exists (select 1 from events e where e.site_id = l.id) or exists (select 1 from led where site_id = l.id)
               or exists (select 1 from public.mi_schedules s where s.site_id = l.id and s.id = any (sched_ids)))) y),
      'by_type', (select coalesce(jsonb_object_agg(entry_type, n), '{}'::jsonb) from (select entry_type, count(*) as n from ent group by 1) t),
      'top_assets', (select coalesce(jsonb_agg(x order by (x ->> 'cost')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object('asset_id', a.asset_id, 'asset_name', e.name, 'site_name', l.name, 'cost', round(a.cost, 2), 'events', a.events) as x
        from (
          select asset_id, sum(cost) as cost, sum(events) as events from (
            select asset_id, sum(-qty * unit_cost) as cost, 0 as events from led where asset_id is not null group by 1
            union all select asset_id, sum(coalesce(outside_cost, 0)), count(*) from ent where asset_id is not null group by 1
            union all select equipment_id, 0, count(*) from wos where equipment_id is not null group by 1) u
          group by 1 order by 2 desc limit 10) a
        join public.equipment e on e.id = a.asset_id left join public.locations l on l.id = e.location_id
        where a.cost > 0 or a.events > 0) t),
      'repeat_problems', (select coalesce(jsonb_agg(x order by (x ->> 'count')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('asset_id', ev.asset_id, 'asset_name', e.name, 'site_name', l.name, 'count', count(*), 'last_at', max(ev.ev_at)) as x
        from events ev join public.equipment e on e.id = ev.asset_id left join public.locations l on l.id = e.location_id
        where ev.is_problem and ev.asset_id is not null
        group by ev.asset_id, e.name, l.name having count(*) >= 3 order by count(*) desc limit 15) t),
      'monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'preventive', pv, 'repairs', rp) order by m), '[]'::jsonb) from (
        select to_char(ev_at at time zone tz, 'YYYY-MM') as m, count(*) filter (where preventive) as pv, count(*) filter (where is_problem) as rp
        from events group by 1) t)
    ));
end;
$$;

-- ---- Nightly: schedule work orders and reminders --------------------------------
-- Opens a work order for each schedule that wants one once it's coming up, and raises
-- one reminder per schedule per cycle when it's due and again if it goes overdue. The
-- reminders go out with the low-stock digest, and only once texts are turned on.
create or replace function public.mi__schedules_nightly(p_account uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
  made integer := 0;
  alerts integer := 0;
  key text;
begin
  for r in
    select s.id, s.title, s.site_id, s.assigned_user_id, s.auto_work_order, s.last_done_at, st.status, l.name as site_name, e.name as asset_name
    from public.mi_schedules s
    join public.mi__schedule_state(array(select id from public.mi_schedules where account_id = p_account and active and archived_at is null)) st on st.schedule_id = s.id
    left join public.locations l on l.id = s.site_id
    left join public.equipment e on e.id = s.asset_id
    where st.status in ('soon', 'due', 'overdue')
  loop
    if r.auto_work_order and not exists (select 1 from public.work_orders w where w.mi_schedule_id = r.id and w.status in ('open', 'in_progress', 'on_hold')) then
      perform public.mi__schedule_work_order(r.id, null, 'Maintenance schedule');
      made := made + 1;
    end if;
    if r.status in ('due', 'overdue') then
      key := 'maintenance_due:' || r.id || ':' || coalesce(r.last_done_at::text, 'never') || ':' || r.status;
      if not exists (select 1 from public.mi_alerts a where a.account_id = p_account and a.dedupe_key = key) then
        perform public.mi__raise_alert(p_account, 'maintenance_due', key,
          case when r.status = 'overdue' then 'Overdue: ' else 'Due: ' end || r.title || coalesce(' (' || r.asset_name || ')', '') || ' at ' || coalesce(r.site_name, 'a site') || '.',
          p_target => r.assigned_user_id, p_detail => jsonb_build_object('site_id', r.site_id, 'schedule_id', r.id));
        alerts := alerts + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('schedule_work_orders', made, 'maintenance_reminders', alerts);
end;
$$;

alter table public.mi_alerts drop constraint mi_alerts_kind_check;
alter table public.mi_alerts add constraint mi_alerts_kind_check check (kind in ('critical_below_min', 'critical_zero', 'low_stock', 'tool_overdue', 'tool_overdue_manager',
  'count_variance', 'transfer_variance', 'tool_transfer', 'maintenance_due'));

-- Maintenance reminders join low stock in the nightly digest.
create or replace function public.mi__raise_alert(
  p_account uuid, p_kind text, p_key text, p_message text, p_part uuid default null, p_location uuid default null,
  p_tool uuid default null, p_count uuid default null, p_target uuid default null, p_bypass boolean default false, p_detail jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- One alert per thing per day, however many times it happens.
  if exists (select 1 from public.mi_alerts a where a.account_id = p_account and a.dedupe_key = p_key and a.created_at > now() - interval '24 hours') then
    return;
  end if;
  insert into public.mi_alerts (account_id, kind, dedupe_key, message, part_id, location_id, tool_id, count_id, target_user_id, bypass_quiet, detail, status)
  values (p_account, p_kind, p_key, p_message, p_part, p_location, p_tool, p_count, p_target, p_bypass, p_detail,
          case when p_kind in ('low_stock', 'maintenance_due') then 'digest' else 'pending' end);
end;
$$;

-- A maintenance reminder goes to whoever the schedule is assigned to, otherwise the
-- site's managers, then the region, then the director and admins.
create or replace function public.mi__alert_recipients(p_alert uuid)
returns table (user_id uuid, name text, phone text, sms_ok boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  a public.mi_alerts;
  site uuid;
  region text;
  ids uuid[] := '{}';
begin
  select * into a from public.mi_alerts where id = p_alert;
  if a.kind in ('tool_overdue', 'tool_transfer') or (a.kind = 'maintenance_due' and a.target_user_id is not null) then
    ids := array[a.target_user_id];
  else
    if a.kind = 'maintenance_due' then
      site := nullif(a.detail ->> 'site_id', '')::uuid;
    elsif a.tool_id is not null then
      select l.site_id, l.region_name into site, region from public.mi_tools t join public.mi_stock_locations l on l.id = t.home_location_id where t.id = a.tool_id;
    else
      select l.site_id, l.region_name into site, region from public.mi_stock_locations l where l.id = a.location_id;
    end if;
    select coalesce(array_agg(m.user_id), '{}') into ids from public.mi_members m
    where m.account_id = a.account_id and (
      (m.role = 'site_manager' and site = any (m.site_ids))
      or (m.role = 'regional_manager' and (
        site = any (m.site_ids) or site = any (public.mi__region_sites(m.account_id, m.region_names)) or region = any (m.region_names)))
    );
    if a.kind = 'critical_zero' or coalesce(array_length(ids, 1), 0) = 0 then
      ids := ids || (select coalesce(array_agg(m.user_id), '{}') from public.mi_members m
                     where m.account_id = a.account_id and m.role in ('corporate_maintenance_director', 'admin'));
    end if;
  end if;
  return query
    select u.id, u.name, u.phone, (coalesce(u.phone, '') <> '' and coalesce(u.sms_opt_in, false))
    from public.users u where u.id = any (ids);
end;
$$;

-- The nightly job gains the schedule step (everything above it is unchanged from 0216).
create or replace function public.mi__nightly(p_account uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s record;
  t record;
  st public.mi_settings;
  l record;
  scanned integer := 0;
  overdue integer := 0;
  counts integer := 0;
  sched jsonb;
  spec record;
  maint jsonb;
begin
  select * into st from public.mi_settings where account_id = p_account;
  for s in select part_id, location_id from public.mi_stock_levels where account_id = p_account loop
    perform public.mi__eval_stock(s.part_id, s.location_id);
    scanned := scanned + 1;
  end loop;

  for t in
    select tt.*, u.name as custodian_name from public.mi_tools tt left join public.users u on u.id = tt.custodian_user_id
    where tt.account_id = p_account and tt.status = 'checked_out' and tt.due_at < now()
  loop
    overdue := overdue + 1;
    if t.custodian_user_id is not null then
      perform public.mi__raise_alert(p_account, 'tool_overdue', 'tool_overdue:' || t.id,
        t.name || ' was due back ' || to_char(t.due_at at time zone st.timezone, 'Mon DD') || '. Please return it or update the due date.',
        p_tool => t.id, p_target => t.custodian_user_id);
    end if;
    if t.due_at < now() - interval '24 hours' then
      perform public.mi__raise_alert(p_account, 'tool_overdue_manager', 'tool_overdue_manager:' || t.id,
        t.name || ' is overdue with ' || coalesce(t.custodian_name, 'a truck or crib') || ' since ' || to_char(t.due_at at time zone st.timezone, 'Mon DD') || '.',
        p_tool => t.id);
    end if;
  end loop;

  if st.auto_counts_enabled then
    sched := st.count_schedule;
    for l in select id from public.mi_stock_locations where account_id = p_account and active loop
      for spec in
        select * from (values
          ('critical', null::text, (sched ->> 'critical_days')::int),
          ('abc', 'A', (sched ->> 'a_days')::int),
          ('abc', 'B', (sched ->> 'b_days')::int),
          ('abc', 'C', (sched ->> 'c_days')::int)) v(scope_type, scope_value, days)
      loop
        if spec.days is not null
           and not exists (select 1 from public.mi_cycle_counts c
                           where c.location_id = l.id and c.scope_type = spec.scope_type and c.scope_value is not distinct from spec.scope_value
                             and c.scheduled and c.status <> 'cancelled' and c.created_at > now() - make_interval(days => spec.days))
           and exists (select 1 from public.mi_stock_levels x join public.parts p on p.id = x.part_id
                       where x.location_id = l.id and case when spec.scope_type = 'critical' then p.is_critical else p.abc_class = spec.scope_value end)
        then
          perform public.mi__make_count(p_account, l.id, spec.scope_type, spec.scope_value, true, current_date + 3, 'Scheduled count', true);
          counts := counts + 1;
        end if;
      end loop;
    end loop;
  end if;

  maint := public.mi__schedules_nightly(p_account);
  return jsonb_build_object('stock_rows', scanned, 'overdue_tools', overdue, 'counts_created', counts) || maint;
end;
$$;

-- ---- Sample data ----------------------------------------------------------------
-- Same as 0216, plus demo schedules, the entries and work orders they made, and any
-- entry that used demo stock.
create or replace function public.mi_remove_sample_data() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  locs uuid[];
  n_parts integer;
  n_sched integer;
begin
  perform public.mi__require_rank(5, 'remove sample data');
  perform set_config('mi.purge', 'on', true);
  select coalesce(array_agg(id), '{}') into locs from public.mi_stock_locations where account_id = acct and is_sample;

  delete from public.mi_alerts where account_id = acct and kind = 'maintenance_due'
    and (detail ->> 'schedule_id')::uuid in (select id from public.mi_schedules where account_id = acct and is_sample);
  delete from public.mi_attachments where account_id = acct and entity_type = 'log_entry'
    and entity_id in (select id from public.mi_log_entries where account_id = acct
                      and (is_sample or schedule_id in (select id from public.mi_schedules where account_id = acct and is_sample)));
  delete from public.work_orders where account_id = acct and status in ('open', 'in_progress', 'on_hold')
    and id in (select follow_up_work_order_id from public.mi_log_entries where account_id = acct
               and (is_sample or schedule_id in (select id from public.mi_schedules where account_id = acct and is_sample)));
  delete from public.mi_log_entries where account_id = acct
    and (is_sample or schedule_id in (select id from public.mi_schedules where account_id = acct and is_sample));
  delete from public.work_orders where account_id = acct and mi_schedule_id in (select id from public.mi_schedules where account_id = acct and is_sample);
  delete from public.mi_schedules where account_id = acct and is_sample;
  get diagnostics n_sched = row_count;

  delete from public.mi_tags t where t.account_id = acct and (
    (t.entity_type = 'location' and t.entity_id = any (locs))
    or (t.entity_type = 'bin' and t.entity_id in (select b.id from public.mi_bins b where b.location_id = any (locs)))
    or (t.entity_type = 'tool' and t.entity_id in (select id from public.mi_tools where account_id = acct and is_sample)));
  delete from public.mi_alerts where account_id = acct and (location_id = any (locs) or tool_id in (select id from public.mi_tools where account_id = acct and is_sample)
    or part_id in (select id from public.parts where account_id = acct and is_sample));
  delete from public.mi_receipts where account_id = acct and location_id = any (locs);
  delete from public.mi_inventory_transactions where account_id = acct and (is_sample or location_id = any (locs)
    or part_id in (select id from public.parts where account_id = acct and is_sample));
  delete from public.mi_purchase_orders where account_id = acct and (is_sample or ship_to_location_id = any (locs));
  delete from public.mi_transfers where account_id = acct and (is_sample or from_location_id = any (locs) or to_location_id = any (locs));
  delete from public.mi_cycle_counts where account_id = acct and (is_sample or location_id = any (locs));
  delete from public.mi_tool_audits where account_id = acct and location_id = any (locs);
  delete from public.mi_tools where account_id = acct and (is_sample or home_location_id = any (locs) or custodian_location_id = any (locs));
  delete from public.mi_kits where account_id = acct and is_sample;
  delete from public.mi_stock_levels where account_id = acct and (is_sample or location_id = any (locs)
    or part_id in (select id from public.parts where account_id = acct and is_sample));
  delete from public.work_order_parts wp where wp.catalog_part_id in (select id from public.parts where account_id = acct and is_sample);
  delete from public.parts where account_id = acct and is_sample;
  get diagnostics n_parts = row_count;
  delete from public.mi_stock_locations where account_id = acct and is_sample;
  perform set_config('mi.purge', 'off', true);
  return jsonb_build_object('ok', true, 'locations', coalesce(array_length(locs, 1), 0), 'parts', n_parts, 'schedules', n_sched);
end;
$$;

-- ---- Grants ---------------------------------------------------------------------
revoke all on function public.mi__today(uuid) from public, anon, authenticated;
revoke all on function public.mi__local_date(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.mi__add_interval(date, integer, text) from public, anon, authenticated;
revoke all on function public.mi__interval_days(integer, text) from public, anon, authenticated;
revoke all on function public.mi__site_number(uuid) from public, anon, authenticated;
revoke all on function public.mi__site_cars(uuid, uuid, date, date) from public, anon, authenticated;
revoke all on function public.mi__site_daily_cars(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mi__schedule_state(uuid[]) from public, anon, authenticated;
revoke all on function public.mi__schedule_json(uuid[], boolean) from public, anon, authenticated;
revoke all on function public.mi__schedule_work_order(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.mi__recompute_schedule(uuid) from public, anon, authenticated;
revoke all on function public.mi__wo_done_to_log() from public, anon, authenticated;
revoke all on function public.mi__entry_parts_cost(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mi__schedules_nightly(uuid) from public, anon, authenticated;
revoke all on function public.mi__raise_alert(uuid, text, text, text, uuid, uuid, uuid, uuid, uuid, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.mi__alert_recipients(uuid) from public, anon, authenticated;
revoke all on function public.mi__nightly(uuid) from public, anon, authenticated;

revoke all on function public.mi_schedules_list(uuid, uuid, uuid, text, text) from public, anon;
revoke all on function public.mi_log_counts() from public, anon;
revoke all on function public.mi_schedule_detail(uuid) from public, anon;
revoke all on function public.mi_save_schedule(jsonb) from public, anon;
revoke all on function public.mi_archive_schedule(uuid) from public, anon;
revoke all on function public.mi_schedule_work_order(uuid) from public, anon;
revoke all on function public.mi_log_add(jsonb, text, text) from public, anon;
revoke all on function public.mi_log_update(uuid, jsonb) from public, anon;
revoke all on function public.mi_log_void(uuid, text) from public, anon;
revoke all on function public.mi_log_feed(jsonb) from public, anon;
revoke all on function public.mi_log_entry(uuid) from public, anon;
revoke all on function public.mi_parts_forecast(integer, uuid) from public, anon;
revoke all on function public.mi_log_report(date, date, uuid) from public, anon;
revoke all on function public.mi_remove_sample_data() from public, anon;

grant execute on function public.mi_schedules_list(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.mi_log_counts() to authenticated;
grant execute on function public.mi_schedule_detail(uuid) to authenticated;
grant execute on function public.mi_save_schedule(jsonb) to authenticated;
grant execute on function public.mi_archive_schedule(uuid) to authenticated;
grant execute on function public.mi_schedule_work_order(uuid) to authenticated;
grant execute on function public.mi_log_add(jsonb, text, text) to authenticated;
grant execute on function public.mi_log_update(uuid, jsonb) to authenticated;
grant execute on function public.mi_log_void(uuid, text) to authenticated;
grant execute on function public.mi_log_feed(jsonb) to authenticated;
grant execute on function public.mi_log_entry(uuid) to authenticated;
grant execute on function public.mi_parts_forecast(integer, uuid) to authenticated;
grant execute on function public.mi_log_report(date, date, uuid) to authenticated;
grant execute on function public.mi_remove_sample_data() to authenticated;
