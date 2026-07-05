-- 0048_invitation_name.sql
-- The inviter now provides the person's name when creating the invite, so store
-- it on the invitation. The accept-invite page can then stop asking for the name
-- again and just collect a password, and accept_invitation names the new
-- user/employee record from the invitation.

alter table public.invitations add column if not exists name text;

-- Expose email + name to the unauthenticated accept-invite page. Returns null
-- for invalid / expired / consumed tokens.
create or replace function public.get_invitation_info(p_token uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('email', email, 'name', name)
  from public.invitations
  where token = p_token and status = 'pending' and expires_at > now()
$$;

grant execute on function public.get_invitation_info(uuid) to anon, authenticated;

-- accept_invitation now prefers the name captured at invite time, falling back to
-- any name the invitee typed, then the email local-part. Body otherwise matches
-- 0023 (links/creates the People-module employee record for employee invites).
create or replace function public.accept_invitation(
  p_token uuid,
  p_user_name text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_inv   public.invitations;
  v_name  text;
  v_first text;
  v_last  text;
  v_emp   uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.users where id = v_uid) then
    raise exception 'profile already exists';
  end if;

  select * into v_inv from public.invitations where token = p_token;
  if v_inv.id is null then
    raise exception 'invalid invitation';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'invitation is %', v_inv.status;
  end if;
  if v_inv.expires_at < now() then
    update public.invitations set status = 'expired' where id = v_inv.id;
    raise exception 'invitation expired';
  end if;

  select email into v_email from auth.users where id = v_uid;
  v_name := coalesce(
    nullif(trim(v_inv.name), ''),
    nullif(trim(p_user_name), ''),
    split_part(v_email, '@', 1)
  );

  insert into public.users (id, account_id, location_ids, role, name, email)
    values (v_uid, v_inv.account_id, v_inv.location_ids, v_inv.role, v_name, v_email);

  update public.invitations set status = 'accepted' where id = v_inv.id;

  if v_inv.role = 'employee' and array_length(v_inv.location_ids, 1) >= 1 then
    update public.employees
      set user_id = v_uid
      where user_id is null
        and lower(email) = lower(v_email)
        and location_id = any (v_inv.location_ids)
      returning id into v_emp;

    if v_emp is null then
      v_first := split_part(v_name, ' ', 1);
      v_last  := coalesce(nullif(trim(substr(v_name, length(v_first) + 1)), ''), '');
      insert into public.employees (location_id, user_id, first_name, last_name, email, status)
        values (v_inv.location_ids[1], v_uid, v_first, v_last, v_email, 'active');
    end if;
  end if;

  return v_inv.account_id;
end $$;

grant execute on function public.accept_invitation(uuid, text) to authenticated;
