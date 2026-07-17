-- 0058_inventory_chemical_division.sql
-- Add a Chemical division to inventory (alongside Lube, Wash, Maintenance).
alter table public.inventory_items drop constraint if exists inventory_items_division_check;
alter table public.inventory_items
  add constraint inventory_items_division_check
  check (division in ('lube', 'wash', 'maintenance', 'chemical'));
