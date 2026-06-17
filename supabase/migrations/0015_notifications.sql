-- 0015_notifications.sql — in-app notifications (table + RLS + realtime + triggers).
-- Event-driven notifications only (work order assigned, low stock). Time-based
-- ones (overdue checklist, missing closeout, review due) require a scheduled
-- job and are added with the cron Edge Function later.

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  kind       text not null,
  payload    jsonb not null default '{}',
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);
create index on public.notifications (user_id, read_at);

alter table public.notifications enable row level security;

-- Users see and update only their own notifications. Inserts come from triggers
-- (SECURITY DEFINER), which bypass RLS, so there is no client INSERT policy.
create policy notifications_select on public.notifications
  for select using (user_id = auth.uid());
create policy notifications_update on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications
  for delete using (user_id = auth.uid());

-- Realtime stream for the topbar bell.
alter publication supabase_realtime add table public.notifications;

-- Notify every owner (account-wide) + manager assigned to a location. ---------
create or replace function public.notify_location_managers(
  p_location_id uuid, p_kind text, p_payload jsonb
) returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, kind, payload)
  select u.id, p_kind, p_payload
  from public.users u
  where (u.role = 'owner'
         and u.account_id = (select account_id from public.locations where id = p_location_id))
     or (u.role = 'manager' and p_location_id = any(u.location_ids));
$$;

-- Work order assigned → notify the assignee (unless they assigned themselves). -
create or replace function public.notify_wo_assigned()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is not null
     and new.assigned_to is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    insert into public.notifications (user_id, kind, payload)
    values (new.assigned_to, 'work_order_assigned',
      jsonb_build_object('work_order_id', new.id, 'title', new.title, 'priority', new.priority));
  end if;
  return new;
end $$;

create trigger trg_notify_wo_assigned
  after insert or update of assigned_to on public.work_orders
  for each row execute function public.notify_wo_assigned();

-- Parts cross the reorder threshold (downward) → notify location managers. -----
create or replace function public.notify_low_stock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.quantity_on_hand <= new.reorder_threshold
     and old.quantity_on_hand > old.reorder_threshold then
    perform public.notify_location_managers(
      new.location_id, 'low_stock',
      jsonb_build_object('part_id', new.id, 'name', new.name, 'quantity', new.quantity_on_hand));
  end if;
  return new;
end $$;

create trigger trg_notify_low_stock
  after update on public.parts_inventory
  for each row execute function public.notify_low_stock();
