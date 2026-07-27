-- Push-back half of the MaintainX two-way sync. Operator writes status/edits/
-- deletes straight to work_orders from several call sites, so we capture those
-- changes with a trigger into an outbox and let a worker push them to MaintainX.
-- Loop prevention: the pull RPC sets app.mx_syncing so its own writes are ignored.

create table if not exists public.maintainx_wo_outbox (
  id bigint generated always as identity primary key,
  work_order_id uuid,
  maintainx_id bigint not null,
  op text not null check (op in ('update','status','delete')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','done','error')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists maintainx_wo_outbox_pending_idx
  on public.maintainx_wo_outbox (created_at) where status = 'pending';
alter table public.maintainx_wo_outbox enable row level security;
-- No policies: only the service role (edge functions / cron) touches this.

create or replace function public.mx_wo_enqueue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_account uuid := '54f3e299-1f61-4ed2-9921-3d02160b72e6';
begin
  -- Skip writes originating from the MaintainX pull sync (avoids ping-pong).
  if coalesce(current_setting('app.mx_syncing', true), '') = 'on' then
    return null;
  end if;

  if TG_OP = 'DELETE' then
    if OLD.account_id = v_account and OLD.maintainx_id is not null then
      insert into public.maintainx_wo_outbox (work_order_id, maintainx_id, op, payload)
      values (OLD.id, OLD.maintainx_id, 'delete', '{}'::jsonb);
    end if;
    return OLD;
  end if;

  if NEW.account_id = v_account and NEW.maintainx_id is not null then
    if NEW.status is distinct from OLD.status then
      insert into public.maintainx_wo_outbox (work_order_id, maintainx_id, op, payload)
      values (NEW.id, NEW.maintainx_id, 'status', jsonb_build_object('status', NEW.status));
    end if;
    if NEW.title is distinct from OLD.title
       or NEW.description is distinct from OLD.description
       or NEW.priority is distinct from OLD.priority
       or NEW.work_type is distinct from OLD.work_type
       or NEW.due_at is distinct from OLD.due_at
       or NEW.start_at is distinct from OLD.start_at then
      insert into public.maintainx_wo_outbox (work_order_id, maintainx_id, op, payload)
      values (NEW.id, NEW.maintainx_id, 'update', jsonb_build_object(
        'title', NEW.title, 'description', NEW.description, 'priority', NEW.priority,
        'work_type', NEW.work_type, 'due_at', NEW.due_at, 'start_at', NEW.start_at));
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists mx_wo_enqueue_upd on public.work_orders;
drop trigger if exists mx_wo_enqueue_del on public.work_orders;
create trigger mx_wo_enqueue_upd after update on public.work_orders
  for each row execute function public.mx_wo_enqueue();
create trigger mx_wo_enqueue_del after delete on public.work_orders
  for each row execute function public.mx_wo_enqueue();

-- Mark pull-sync writes so the enqueue trigger ignores them.
create or replace function public.sync_maintainx_work_orders(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid := '54f3e299-1f61-4ed2-9921-3d02160b72e6';
  v_unassigned uuid;
  n int;
begin
  perform set_config('app.mx_syncing', 'on', true);

  select id into v_unassigned from public.locations
    where account_id = v_account and name = 'Mighty Wash (Unassigned)' limit 1;

  insert into public.work_orders
    (account_id, location_id, equipment_id, number, title, description, status,
     priority, work_type, recurrence, created_at, completed_at, updated_at,
     maintainx_updated_at, requested_by_name, created_by_name, completed_by_name,
     maintainx_id)
  select
    v_account,
    coalesce(l.id, v_unassigned),
    e.id,
    r.number, r.title, r.description, r.status, r.priority, r.work_type, 'none',
    r.created_at, r.completed_at, r.updated_at, r.updated_at,
    r.requested_by_name, r.created_by_name, r.completed_by_name, r.maintainx_id
  from jsonb_to_recordset(p_rows) as r(
    maintainx_id bigint, mx_location_id bigint, mx_asset_id bigint,
    number int, title text, description text, status text, priority text,
    work_type text, created_at timestamptz, completed_at timestamptz,
    updated_at timestamptz, requested_by_name text, created_by_name text,
    completed_by_name text
  )
  left join public.locations l on l.account_id = v_account and l.maintainx_id = r.mx_location_id
  left join public.equipment e on e.account_id = v_account and e.maintainx_id = r.mx_asset_id
  on conflict (account_id, maintainx_id) where maintainx_id is not null
  do update set
    status = excluded.status,
    priority = excluded.priority,
    title = excluded.title,
    description = excluded.description,
    completed_at = excluded.completed_at,
    completed_by_name = excluded.completed_by_name,
    maintainx_updated_at = excluded.maintainx_updated_at,
    equipment_id = excluded.equipment_id,
    location_id = excluded.location_id,
    work_type = excluded.work_type;

  get diagnostics n = row_count;
  return n;
end $$;
