-- Personal opt-in links for SMS alerts. An emailed link lets an existing user
-- add their mobile number and consent without logging in (many staff have never
-- set a password). Each link is scoped to one user, can only change that user's
-- phone and SMS opt-in, and expires.
--
-- Only a SHA-256 hash of the token is stored, so a database read never yields a
-- working link. Service-role edge functions are the only readers/writers.
create table if not exists public.sms_optin_tokens (
  token_hash  text primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index if not exists sms_optin_tokens_user_idx on public.sms_optin_tokens (user_id, created_at desc);
alter table public.sms_optin_tokens enable row level security;
-- No policies: inaccessible to anon/authenticated; edge functions use service role.

-- How consent was given, alongside the existing timestamp (sms_opt_in_at), for
-- the carrier (A2P 10DLC) consent record: 'signup', 'email_link', 'direct_request'.
alter table public.users add column if not exists sms_opt_in_source text;
