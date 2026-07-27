-- Live sync of MaintainX work orders. The work_orders_touch trigger overwrites
-- updated_at on every UPDATE, so we keep the source MaintainX updatedAt in its
-- own column and use MAX(maintainx_updated_at) as the incremental watermark.
alter table public.work_orders add column if not exists maintainx_updated_at timestamptz;

update public.work_orders
  set maintainx_updated_at = updated_at
  where account_id = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
    and maintainx_id is not null
    and maintainx_updated_at is null;

-- Upsert a batch of MaintainX work orders. Rows carry MaintainX ids; the
-- function resolves them to Operator site/asset via the backfilled maintainx_id
-- columns, defaulting unmapped sites to "Mighty Wash (Unassigned)". Idempotent
-- on (account_id, maintainx_id). Runs as owner (service_role only) so it can
-- write across the account.
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

revoke all on function public.sync_maintainx_work_orders(jsonb) from public;
revoke all on function public.sync_maintainx_work_orders(jsonb) from authenticated;
grant execute on function public.sync_maintainx_work_orders(jsonb) to service_role;
