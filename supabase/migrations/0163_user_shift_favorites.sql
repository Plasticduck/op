-- Per-user "frequently used shifts": as a user creates shifts in the scheduler,
-- Operator remembers them (by start/end, with a use count) so they can be dragged
-- from the shift palette. Personal to each user. Shape: jsonb array of
-- { start, end, count, last_used }.
alter table public.users
  add column if not exists shift_favorites jsonb;
