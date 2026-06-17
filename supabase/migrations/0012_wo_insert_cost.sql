-- 0012_wo_insert_cost.sql — reflect labor_cost in total cost at creation time.
-- (0011 only recomputed on UPDATE / parts changes, so a new work order created
-- with labor but no parts showed $0 until the next edit.)

create or replace function public.wo_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.labor_cost, 0) <> 0 then
    perform public.wo_recompute_cost(new.id);
  end if;
  return null;
end $$;

create trigger trg_wo_insert
  after insert on public.work_orders
  for each row execute function public.wo_after_insert();
