-- Allow an admin (owner) to invite another admin. The invitations role check
-- previously excluded 'owner'; add it so owner invites can be stored. Only
-- owners are offered the option in the UI.
alter table public.invitations drop constraint if exists invitations_role_check;
alter table public.invitations add constraint invitations_role_check
  check (role = any (array['owner'::text, 'manager'::text, 'employee'::text, 'technician'::text]));

-- Only an admin (owner) may create/keep an owner invite. Blocks a non-owner
-- from escalating by crafting an owner invite directly (bypassing the UI).
-- auth.uid() is null for trusted backend/service contexts, which are allowed.
create or replace function public.guard_owner_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'owner' and auth.uid() is not null and coalesce(auth_role(), '') <> 'owner' then
    raise exception 'Only an admin can invite another admin.';
  end if;
  return new;
end $$;

drop trigger if exists guard_owner_invite on public.invitations;
create trigger guard_owner_invite
  before insert or update on public.invitations
  for each row execute function public.guard_owner_invite();
