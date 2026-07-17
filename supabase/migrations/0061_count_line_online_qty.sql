-- 0061_count_line_online_qty.sql
-- Chemical counts capture both a physical count (quantity) and an online (OL)
-- reading. online_quantity is null for divisions that do not use it.
alter table public.inventory_count_lines
  add column if not exists online_quantity numeric;
