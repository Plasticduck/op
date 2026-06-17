-- 0025_demo_requests.sql
-- Lead capture for the On-Demand Demo. Visitors submit name/email/phone (company
-- and details optional); we then email them a magic link to enter the demo.
-- This is a public marketing form, so the anon role may INSERT but nobody can
-- read rows back through the API (owner reads them via the dashboard / service
-- role).
create table public.demo_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text not null,
  company text,
  details text,
  created_at timestamptz not null default now()
);

alter table public.demo_requests enable row level security;

grant insert on public.demo_requests to anon, authenticated;

create policy demo_requests_insert on public.demo_requests
  for insert to anon, authenticated
  with check (true);
