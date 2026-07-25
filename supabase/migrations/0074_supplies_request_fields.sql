-- Richer supply request form: requester name, category (with an "Other"
-- explanation), and priority. Item, quantity, location, and status already exist.
alter table public.supplies_requests
  add column if not exists first_name     text,
  add column if not exists last_name      text,
  add column if not exists category       text,
  add column if not exists category_other text,
  add column if not exists priority       text not null default 'middle';
