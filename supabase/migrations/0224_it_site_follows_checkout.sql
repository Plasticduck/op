-- IT Inventory: an item's Site can be changed in Edit while it's checked out.
--
-- A check-out row keeps the site it was made at, and checking in needs write
-- access to that site (it_assignments RLS). So when a checked-out item's site
-- changes, the open check-out moves with it; otherwise a manager at the new site
-- couldn't check it in.
--
-- Checked out to a person or lent to another site: it moves, still checked out.
-- Checked out to an area or to another device: those belong to the old site, so
-- it has to be checked in first (the same as Move, it_move, for every check-out).
-- Lent to a site and moved to that same site: checked in first too, since an item
-- can't be lent to its own site.

create or replace function public.it_assets_site_follow()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  open_a public.it_assignments%rowtype;
begin
  select * into open_a from public.it_assignments
   where asset_id = new.id and checked_in_at is null;
  if not found then
    return new;
  end if;
  if open_a.assigned_type in ('area', 'asset') then
    raise exception 'Checked out to %. Check it in first to move it to another site.', open_a.assigned_label
      using errcode = 'P0001';
  end if;
  if open_a.assigned_type = 'site' and open_a.assigned_id = new.location_id then
    raise exception 'It''s lent to %. Check it in first, then move it there.', open_a.assigned_label
      using errcode = 'P0001';
  end if;
  update public.it_assignments set location_id = new.location_id where id = open_a.id;
  return new;
end $$;

drop trigger if exists it_assets_site_follow_trg on public.it_assets;
create trigger it_assets_site_follow_trg before update of location_id on public.it_assets
  for each row when (new.location_id is distinct from old.location_id)
  execute function public.it_assets_site_follow();
