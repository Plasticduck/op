-- Signage catalog (2026-10-20): "Wind Signs and A-Frames" becomes "General Site
-- Signage", and the Aluminum Signs and Safety Signs categories are retired.
-- Catalog galleries match artwork by sign_category (both library uploads and
-- artwork attached to past orders), so existing rows are re-tagged to keep their
-- artwork in a real gallery instead of falling into Other Items.
--
-- Retired-category rows move under General Site Signage. Aluminum orders keep
-- what they were as the sign type "Aluminum", which is one of General Site
-- Signage's materials. (Safety Signs had no artwork or orders.)
update public.signage_artwork
set sign_category = 'General Site Signage'
where sign_category in ('Wind Signs and A-Frames', 'Aluminum Signs', 'Safety Signs');

update public.signage_requests
set sign_type = coalesce(sign_type, 'Aluminum')
where sign_category = 'Aluminum Signs';

update public.signage_requests
set sign_category = 'General Site Signage'
where sign_category in ('Wind Signs and A-Frames', 'Aluminum Signs', 'Safety Signs');
