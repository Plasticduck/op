-- Flags use preset size options (not free width/height) and a single/double-sided
-- choice. Store the chosen preset label and the sided value alongside the existing
-- width/height (used by the non-flag categories).
alter table public.signage_requests
  add column if not exists size_option text,
  add column if not exists sided       text;
