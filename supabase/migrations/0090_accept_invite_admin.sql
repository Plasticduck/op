-- Harden invite acceptance so a re-invited email that already has a login (from
-- an earlier signup or a removed profile) completes cleanly instead of stranding
-- the user with a login but no profile. Used by the accept-invite edge function.

-- Look up an auth user id by email (service-role only).
create or replace function public._auth_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1
$$;
revoke all on function public._auth_user_id_by_email(text) from public, authenticated;
grant execute on function public._auth_user_id_by_email(text) to service_role;

-- Accept an invitation for an EXPLICIT user id (the edge function passes the
-- resolved auth user). Unlike accept_invitation this does not read auth.uid(),
-- is idempotent, and refuses to attach an email that already belongs to a
-- different account.
create or replace function public.admin_accept_invitation(p_token uuid, p_user_id uuid, p_user_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text; v_inv public.invitations; v_name text; v_first text; v_last text; v_emp uuid;
  v_existing_account uuid;
begin
  select * into v_inv from public.invitations where token = p_token;
  if v_inv.id is null then raise exception 'invalid invitation'; end if;
  if v_inv.status <> 'pending' then raise exception 'invitation is %', v_inv.status; end if;
  if v_inv.expires_at < now() then
    update public.invitations set status = 'expired' where id = v_inv.id;
    raise exception 'invitation expired';
  end if;

  select account_id into v_existing_account from public.users where id = p_user_id;
  if v_existing_account is not null then
    if v_existing_account <> v_inv.account_id then
      raise exception 'email already belongs to another account';
    end if;
    -- Already a member of this account: just consume the invitation.
    update public.invitations set status = 'accepted' where id = v_inv.id;
    return v_inv.account_id;
  end if;

  select email into v_email from auth.users where id = p_user_id;
  v_name := coalesce(nullif(trim(v_inv.name), ''), nullif(trim(p_user_name), ''), split_part(v_email, '@', 1));

  insert into public.users (id, account_id, location_ids, role, name, email)
    values (p_user_id, v_inv.account_id, v_inv.location_ids, v_inv.role, v_name, v_email)
    on conflict (id) do nothing;

  update public.invitations set status = 'accepted' where id = v_inv.id;

  if v_inv.role = 'employee' and array_length(v_inv.location_ids, 1) >= 1 then
    update public.employees
      set user_id = p_user_id
      where user_id is null and lower(email) = lower(v_email) and location_id = any (v_inv.location_ids)
      returning id into v_emp;
    if v_emp is null then
      v_first := split_part(v_name, ' ', 1);
      v_last  := coalesce(nullif(trim(substr(v_name, length(v_first) + 1)), ''), '');
      insert into public.employees (location_id, user_id, first_name, last_name, email, status)
        values (v_inv.location_ids[1], p_user_id, v_first, v_last, v_email, 'active');
    end if;
  end if;

  return v_inv.account_id;
end $$;
revoke all on function public.admin_accept_invitation(uuid, uuid, text) from public, authenticated;
grant execute on function public.admin_accept_invitation(uuid, uuid, text) to service_role;
