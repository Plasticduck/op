-- 0011_work_order_logic.sql — server-side work order integrity:
--  * closing a work order decrements matched parts inventory + stamps closed_at
--  * work_orders.cost stays in sync with attached parts + labor_cost

-- Recompute total cost = sum(parts) + labor.
create or replace function public.wo_recompute_cost(p_wo uuid)
returns void language sql security definer set search_path = public as $$
  update public.work_orders w set cost =
    coalesce((select sum(quantity * unit_cost)
              from public.work_order_parts where work_order_id = p_wo), 0)
    + coalesce(w.labor_cost, 0)
  where w.id = p_wo;
$$;

-- On transition into 'closed': stamp closed_at, decrement matched parts once.
create or replace function public.wo_on_close()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    if new.closed_at is null then new.closed_at := now(); end if;
    update public.parts_inventory pi
      set quantity_on_hand = pi.quantity_on_hand - wop.quantity,
          last_updated_at = now()
      from public.work_order_parts wop
      where wop.work_order_id = new.id and wop.part_id = pi.id;
  end if;
  return new;
end $$;

create trigger trg_wo_on_close
  before update on public.work_orders
  for each row execute function public.wo_on_close();

-- Keep cost in sync when parts are added / changed / removed.
create or replace function public.wop_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.wo_recompute_cost(coalesce(new.work_order_id, old.work_order_id));
  return null;
end $$;

create trigger trg_wop_change
  after insert or update or delete on public.work_order_parts
  for each row execute function public.wop_after_change();

-- Keep cost in sync when labor_cost changes (guarded to avoid recursion).
create or replace function public.wo_labor_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.labor_cost is distinct from old.labor_cost then
    perform public.wo_recompute_cost(new.id);
  end if;
  return null;
end $$;

create trigger trg_wo_labor
  after update on public.work_orders
  for each row execute function public.wo_labor_change();
