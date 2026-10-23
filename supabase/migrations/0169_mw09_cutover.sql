-- MW9 ran its first FlexWash washes on 2026-10-22 (185 that day, SiteWatch down
-- to 36), so it gets its cutover date. Reports that combine SiteWatch and
-- FlexWash count FlexWash for MW9 from this day on.
update public.flexwash_sites
set start_date = '2026-10-22'
where account_id = '54f3e299-1f61-4ed2-9921-3d02160b72e6' and site_number = 9 and start_date is null;
