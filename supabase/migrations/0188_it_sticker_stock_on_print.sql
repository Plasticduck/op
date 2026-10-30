-- IT Inventory (2026-10-30): printing stickers uses up each site's Sticker
-- Stock, the same way receipt paper gets used, so the low-stock reminder can
-- tell a manager to reorder before the roll runs out. Same trigger as the
-- print counts in 0184, so a print can't skip it.

create or replace function public.it_label_print_jobs_apply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.it_asset_tags t
     set printed_count = t.printed_count + new.copies, last_printed_at = new.printed_at
   where t.account_id = new.account_id
     and (t.id = any (new.tag_ids)
          or t.tag in (select a.asset_tag from public.it_assets a
                        where a.id = any (new.asset_ids) and a.account_id = new.account_id));
  update public.it_assets
     set sticker_condition = 'unknown'
   where id = any (new.asset_ids) and account_id = new.account_id
     and sticker_condition in ('faded', 'missing');

  -- One "used" stock event per site the printed assets are at.
  insert into public.it_consumable_events (account_id, location_id, consumable_id, delta, reason, note, user_id)
  select new.account_id, c.location_id, c.id, -(s.n * new.copies), 'used', 'Printed stickers', new.printed_by
    from (select a.location_id, count(*)::integer n
            from public.it_assets a
           where a.id = any (new.asset_ids) and a.account_id = new.account_id
           group by a.location_id) s
    join public.it_consumables c
      on c.location_id = s.location_id and c.is_sticker_stock and c.deleted_at is null;

  -- Blank pool tags count against the site they were printed for, if any.
  if new.location_id is not null and coalesce(array_length(new.tag_ids, 1), 0) > 0 then
    insert into public.it_consumable_events (account_id, location_id, consumable_id, delta, reason, note, user_id)
    select new.account_id, c.location_id, c.id, -(array_length(new.tag_ids, 1) * new.copies), 'used',
           'Printed blank tags', new.printed_by
      from public.it_consumables c
     where c.location_id = new.location_id and c.is_sticker_stock and c.deleted_at is null;
  end if;
  return new;
end $$;
