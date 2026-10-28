-- Site Visits People tab: merge duplicate people. On days a vehicle had no
-- driver assigned in Reveal, its trips are attributed to the vehicle
-- ('v:<vehicle number>', named after the vehicle), which usually duplicates the
-- person who drives it. merged_into points such a row at the person it really
-- is; the app shows its visits under that person. Visits keep their original
-- person_key, so a merge can be undone. Kept one level deep by the app.
alter table public.fleet_people add column merged_into text;
grant update (merged_into) on public.fleet_people to authenticated;
