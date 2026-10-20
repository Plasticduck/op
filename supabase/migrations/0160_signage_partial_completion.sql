-- Signage fulfillment: track how many units of an order are done, so an order of
-- 6 can be marked 4 complete while the other 2 stay in the Fulfillment report.
-- The page moves an order to Completed once every unit is done.
alter table public.signage_requests
  add column if not exists quantity_completed numeric not null default 0
    check (quantity_completed >= 0);

-- Orders already marked Completed count as fully done.
update public.signage_requests
set quantity_completed = quantity
where lower(coalesce(status, '')) = 'completed' and quantity_completed = 0;
