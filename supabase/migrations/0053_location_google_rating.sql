-- 0053_location_google_rating.sql
-- Live Google rating per site. google_place_id is the stable Places API id
-- (safe to store indefinitely); the rating fields are a cache refreshed by the
-- google-place-rating edge function at most about once a day to keep Places API
-- cost low. No RLS change: these columns ride along with the locations row, so
-- anyone who can already see the location can see its rating.
alter table public.locations
  add column if not exists google_place_id text,
  add column if not exists google_rating numeric(2,1),
  add column if not exists google_rating_count integer,
  add column if not exists google_rating_synced_at timestamptz;
