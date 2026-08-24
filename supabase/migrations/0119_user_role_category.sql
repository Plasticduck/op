-- Regional Manager / Executive "user categories". These are the manager role at
-- the DB/RLS level (so they inherit exactly a manager's access) plus a category
-- that the app uses to gate the deltas (Bonuses, Invoice Approval) and the label.
-- Kept off the users_role_check enum on purpose: RLS never has to change.
alter table public.users
  add column if not exists role_category text
  check (role_category is null or role_category in ('regional_manager', 'executive'));

alter table public.invitations
  add column if not exists role_category text
  check (role_category is null or role_category in ('regional_manager', 'executive'));
