-- Multi-day mileage trips: expense_date holds the start date; end_date holds the
-- last day (null for a single-day trip).
alter table public.mileage_requests
  add column if not exists end_date date;
