-- 0005_audit.sql — generic audit trail for sensitive actions.

create table public.audit_log (
  id             uuid primary key default gen_random_uuid(),
  table_name     text not null,
  row_id         uuid not null,
  actor_user_id  uuid references public.users(id) on delete set null,
  action         text not null,            -- 'time_entry_edited' | 'closeout_unlocked' | 'work_order_deleted'
  diff           jsonb,                    -- { before: {...}, after: {...} }
  created_at     timestamptz not null default now()
);
create index on public.audit_log (table_name, row_id);
create index on public.audit_log (created_at);

-- time_entries: record any edit to clock_in / clock_out -----------------------
create or replace function public.audit_time_entry_edit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.clock_in is distinct from old.clock_in)
     or (new.clock_out is distinct from old.clock_out) then
    insert into public.audit_log (table_name, row_id, actor_user_id, action, diff)
    values (
      'time_entries', old.id, auth.uid(), 'time_entry_edited',
      jsonb_build_object(
        'before', jsonb_build_object('clock_in', old.clock_in, 'clock_out', old.clock_out),
        'after',  jsonb_build_object('clock_in', new.clock_in, 'clock_out', new.clock_out)
      )
    );
  end if;
  return new;
end $$;

create trigger trg_audit_time_entry_edit
  after update on public.time_entries
  for each row execute function public.audit_time_entry_edit();

-- closeouts: record unlock (locked true -> false) ----------------------------
create or replace function public.audit_closeout_unlock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.locked = true and new.locked = false then
    insert into public.audit_log (table_name, row_id, actor_user_id, action, diff)
    values (
      'closeouts', old.id, auth.uid(), 'closeout_unlocked',
      jsonb_build_object('date', old.date, 'location_id', old.location_id)
    );
  end if;
  return new;
end $$;

create trigger trg_audit_closeout_unlock
  after update on public.closeouts
  for each row execute function public.audit_closeout_unlock();

-- work_orders: record deletion -----------------------------------------------
create or replace function public.audit_work_order_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (table_name, row_id, actor_user_id, action, diff)
  values (
    'work_orders', old.id, auth.uid(), 'work_order_deleted',
    jsonb_build_object('title', old.title, 'location_id', old.location_id, 'status', old.status)
  );
  return old;
end $$;

create trigger trg_audit_work_order_delete
  before delete on public.work_orders
  for each row execute function public.audit_work_order_delete();
