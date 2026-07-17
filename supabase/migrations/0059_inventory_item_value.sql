-- 0059_inventory_item_value.sql
-- Per-item value (unit cost/price) for inventory catalog items.
alter table public.inventory_items
  add column if not exists value numeric;
