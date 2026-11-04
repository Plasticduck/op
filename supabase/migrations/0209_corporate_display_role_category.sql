-- Add the "Corporate Display" user category: a shared login for an office screen.
-- Like the other categories it is the manager role at the DB/RLS level plus a
-- category the app uses for page access and the label. Only the role_category CHECK
-- constraints change; RLS is untouched.
alter table public.users drop constraint users_role_category_check;
alter table public.users add constraint users_role_category_check
  check (role_category is null or role_category in ('regional_manager', 'executive', 'finance', 'corporate_display'));

alter table public.invitations drop constraint invitations_role_category_check;
alter table public.invitations add constraint invitations_role_category_check
  check (role_category is null or role_category in ('regional_manager', 'executive', 'finance', 'corporate_display'));
