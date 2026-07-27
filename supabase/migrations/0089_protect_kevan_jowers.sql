-- Hard guard: the user "Kevan Jowers" can never be deleted, by any path (UI,
-- API, or direct SQL through the app). A BEFORE DELETE trigger raises on any
-- attempt to remove a row whose name is "Kevan Jowers" (case/space-insensitive),
-- which covers every such account/login.
create or replace function public.protect_kevan_jowers()
returns trigger
language plpgsql
as $$
begin
  if lower(btrim(coalesce(old.name, ''))) = 'kevan jowers' then
    raise exception 'This user is protected and cannot be deleted.';
  end if;
  return old;
end $$;

drop trigger if exists protect_kevan_jowers on public.users;
create trigger protect_kevan_jowers
  before delete on public.users
  for each row execute function public.protect_kevan_jowers();
