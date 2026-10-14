-- SMS opt-in captured at signup: the mobile number, whether the user consented to
-- texts, and when (the consent record for A2P 10DLC). Self-service: RLS already
-- lets a user update their own row (id = auth.uid()).
alter table public.users
  add column if not exists phone text,
  add column if not exists sms_opt_in boolean not null default false,
  add column if not exists sms_opt_in_at timestamptz;
