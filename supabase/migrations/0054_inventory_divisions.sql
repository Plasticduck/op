-- 0054_inventory_divisions.sql
-- Split inventory into divisions (Lube, Wash, Maintenance). Existing catalog
-- items and their counts all belong to the Lube Center, so they backfill to
-- 'lube'. The catalog UI keeps each division in its own section and no longer
-- shows everything at once.
alter table public.inventory_items
  add column if not exists division text not null default 'lube';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_items_division_check') then
    alter table public.inventory_items
      add constraint inventory_items_division_check
      check (division in ('lube', 'wash', 'maintenance'));
  end if;
end $$;

alter table public.inventory_counts
  add column if not exists division text;

update public.inventory_counts set division = 'lube' where division is null;
