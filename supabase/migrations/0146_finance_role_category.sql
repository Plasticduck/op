-- Add the "Finance" user category. Like Regional Manager / Executive it is the
-- manager role at the DB/RLS level plus a category the app uses for page access
-- and the label. Only the role_category CHECK constraints change; RLS is untouched.
-- Drop any existing role_category check (its auto-generated name may vary), then
-- re-add it with 'finance' allowed.
do $$
declare r record;
begin
  for r in
    select conname, conrelid::regclass as tbl
    from pg_constraint
    where contype = 'c'
      and conrelid in ('public.users'::regclass, 'public.invitations'::regclass)
      and pg_get_constraintdef(oid) ilike '%role_category%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table public.users add constraint users_role_category_check
  check (role_category is null or role_category in ('regional_manager', 'executive', 'finance'));

alter table public.invitations add constraint invitations_role_category_check
  check (role_category is null or role_category in ('regional_manager', 'executive', 'finance'));
