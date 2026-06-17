-- 0016_billing.sql — Stripe billing fields on accounts.
-- Source of truth for billing_status is the Stripe webhook (service role).
-- Trial starts at signup; 14 days, no card required.

alter table public.accounts
  add column if not exists billing_status text not null default 'trial'
    check (billing_status in ('trial','active','past_due','canceled')),
  add column if not exists trial_ends_at timestamptz not null default (now() + interval '14 days'),
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_quantity integer not null default 1;
