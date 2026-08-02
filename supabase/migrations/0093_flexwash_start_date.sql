-- Per-site FlexWash cutover date. For a site that converted from SiteWatch to
-- FlexWash (e.g. MW29), sync-flexwash only writes dates on/after start_date, so
-- the daily 5-day lookback never overwrites the SiteWatch history before the
-- changeover. Null means write all dates (sites that were always FlexWash).
alter table public.flexwash_sites add column if not exists start_date date;
