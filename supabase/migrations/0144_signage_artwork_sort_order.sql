-- Gallery ordering for the signage catalog. A null sort_order sorts after any
-- explicitly ordered signs (by created_at, the previous default). Only the admin
-- (kevan@washlyfe.com) can rearrange, enforced in the signage-reorder edge
-- function; this column just stores the chosen order per artwork.
alter table public.signage_artwork
  add column if not exists sort_order integer;

create index if not exists signage_artwork_sort_order_idx
  on public.signage_artwork (account_id, sign_category, sort_order);
