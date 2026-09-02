-- 0136_gm_bonus_under_construction.sql — a site can be flagged "under
-- construction" for a given month on the GM/AGM bonus page. While flagged, the
-- prior month's numbers carry forward and the bonus pays $0.

alter table public.gm_bonus_months
  add column if not exists under_construction boolean not null default false;
