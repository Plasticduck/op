-- 0042_tips.sql
--
-- Cashless tipping. Each location onboards its own Stripe Connect Express
-- account so customer tips settle DIRECTLY in the site's bank account (the
-- platform never holds the money). A public per-site tip page is reachable by
-- QR code; paid Checkout Sessions are recorded here for the daily
-- disbursement report (hours-weighted split across employees who worked that
-- day, exported to payroll).

alter table public.locations
  add column stripe_connect_account_id text,
  add column tips_enabled boolean not null default false;

create table public.tips (
  id                       uuid primary key default gen_random_uuid(),
  account_id               uuid not null references public.accounts(id) on delete cascade,
  location_id              uuid not null references public.locations(id) on delete cascade,
  amount_cents             integer not null check (amount_cents > 0),
  currency                 text not null default 'usd',
  stripe_session_id        text not null unique,
  stripe_payment_intent_id text,
  status                   text not null default 'paid' check (status in ('paid','refunded')),
  tipper_note              text,
  tipped_at                timestamptz not null default now(),
  created_at               timestamptz not null default now()
);
create index tips_location_day_idx on public.tips (location_id, tipped_at);

alter table public.tips enable row level security;

-- Managers/owners can read tips for sites they can see. Writes happen only
-- via the service role (edge functions), so no insert/update policies.
create policy tips_select on public.tips for select
  using (
    account_id = public.auth_account_id()
    and public.auth_is_manager_plus()
    and public.auth_has_location(location_id)
  );
