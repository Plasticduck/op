-- Each signage order gets a short title the requester types.
alter table public.signage_requests
  add column if not exists title text;
