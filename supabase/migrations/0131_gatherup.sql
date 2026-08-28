-- GatherUp integration. Each site maps to a GatherUp business; the Google star
-- rating + review count now come from GatherUp and reuse the existing
-- locations.google_rating / google_rating_count / google_rating_synced_at
-- columns, so the rating tiles and the Site Scorecard "Google Rating" factor
-- need no change. Recent reviews are cached for a dashboard feed.

alter table public.locations add column if not exists gatherup_business_id integer;

create table if not exists public.gatherup_reviews (
  review_id bigint primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  author text,
  rating numeric(2,1),
  content text,
  review_time timestamptz,
  synced_at timestamptz not null default now()
);
create index if not exists gatherup_reviews_loc_idx
  on public.gatherup_reviews (location_id, review_time desc);

alter table public.gatherup_reviews enable row level security;

drop policy if exists gatherup_reviews_read on public.gatherup_reviews;
create policy gatherup_reviews_read on public.gatherup_reviews
  for select
  using (account_id = auth_account_id() and auth_has_location(location_id));
