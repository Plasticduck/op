-- Household Finder expansion: members-only, plus phone and shared-card matching.
-- match_type is now one of 'address' | 'phone' | 'card'. match_value holds the
-- shared identifier for display (the phone for phone matches; the street address
-- is already in `address`). card_last4 holds only the last four digits of the
-- card for card matches. The clustering key (token) is never stored.

alter table public.drb_households add column if not exists match_value text;
alter table public.drb_households add column if not exists card_last4 text;
