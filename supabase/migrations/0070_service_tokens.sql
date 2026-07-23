-- Server-side cache for third-party access tokens (e.g. FlexWash). FlexWash
-- tokens last 24h and token generation is rate-limited to 75/day, so we mint one
-- and reuse it. Only the service role (edge functions) touches this table; there
-- are no RLS policies, so it is invisible to the browser.
create table if not exists public.service_tokens (
  provider   text primary key,
  token      text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.service_tokens enable row level security;
