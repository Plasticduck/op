-- 0045_google_calendar.sql
-- Per-user Google Calendar connections for the read-only calendar overlay.
-- Tokens are sensitive, so this table is locked down: RLS is enabled with NO
-- policies, meaning the client (anon/authenticated) can't read or write it at
-- all. Only the edge functions (service role, which bypasses RLS) touch it.

create table public.google_calendar_connections (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  user_id       uuid not null unique references public.users(id) on delete cascade,
  email         text,
  calendar_id   text not null default 'primary',
  access_token  text,
  refresh_token text not null,
  token_expiry  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.google_calendar_connections (user_id);

alter table public.google_calendar_connections enable row level security;
-- Intentionally no policies: edge functions (service role) are the only accessor.
