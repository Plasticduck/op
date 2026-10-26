-- Event Pay Requests (Operations - Admin), 2026-10-26. Replaces Mighty Wash's paper
-- "Check Request Form" for paying team members who work an event: the Mighty Maxx
-- mascot (a flat amount, typically $50) and hourly team members (paid their rate
-- for the time present). One row per event; the team members on it are a jsonb
-- array of { name, arrival, departure, hours, mighty_maxx, amount }. On submit the
-- request is emailed (with a PDF) for approval by the event-pay-request-email
-- function, which stamps emailed_at.
create table if not exists public.event_pay_requests (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  location_id    uuid references public.locations(id) on delete set null,
  event_name     text not null,
  event_date     date not null,
  -- "Requested by" as written on the form (usually the RM), and the app user who
  -- actually submitted it.
  requester_name text not null,
  submitted_by   uuid references public.users(id) on delete set null,
  submitter_name text,
  attendees      jsonb not null default '[]'::jsonb,
  notes          text,
  emailed_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists event_pay_requests_acct_idx
  on public.event_pay_requests (account_id, created_at desc);

alter table public.event_pay_requests enable row level security;

-- Submitters see the requests they sent; account owners see every request.
create policy event_pay_requests_select on public.event_pay_requests
  for select using (
    account_id = auth_account_id()
    and (submitted_by = auth.uid() or auth_role() = 'owner')
  );
create policy event_pay_requests_insert on public.event_pay_requests
  for insert with check (
    account_id = auth_account_id()
    and submitted_by = auth.uid()
    and (location_id is null or auth_has_location(location_id))
  );
-- Requests are a record once sent: no client updates (emailed_at is written by the
-- service-role email function); owners can delete a mistaken one.
create policy event_pay_requests_delete on public.event_pay_requests
  for delete using (account_id = auth_account_id() and auth_role() = 'owner');
