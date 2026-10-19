-- Per-user mobile bottom-nav customization: the ordered list of nav routes the
-- user has pinned to their phone bottom bar (up to 4). Null/empty = app default.
-- Self-service: RLS already lets a user update their own row (id = auth.uid()).
alter table public.users
  add column if not exists nav_favorites text[];
