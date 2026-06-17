-- 0008_rpc.sql — SECURITY DEFINER RPCs for flows that must bypass RLS:
-- account bootstrap at signup, invitation acceptance, counseling ack.

-- signup_account: called once by a freshly authenticated user with no profile.
-- Creates the account, its first location, and the caller's owner user row.
create or replace function public.signup_account(
  p_account_name text,
  p_location_name text,
  p_timezone text default 'America/New_York',
  p_user_name text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_account_id uuid;
  v_location_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.users where id = v_uid) then
    raise exception 'profile already exists';
  end if;

  select email into v_email from auth.users where id = v_uid;

  insert into public.accounts (name) values (p_account_name)
    returning id into v_account_id;

  insert into public.locations (account_id, name, timezone)
    values (v_account_id, p_location_name, coalesce(p_timezone, 'America/New_York'))
    returning id into v_location_id;

  insert into public.users (id, account_id, location_ids, role, name, email)
    values (
      v_uid, v_account_id, array[v_location_id], 'owner',
      coalesce(p_user_name, split_part(v_email, '@', 1)), v_email
    );

  return v_account_id;
end $$;

-- accept_invitation: called by a freshly authenticated invited user. Validates
-- the token, creates their profile from the invite, marks the invite accepted.
create or replace function public.accept_invitation(
  p_token uuid,
  p_user_name text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_inv public.invitations;
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

  insert into public.users (id, account_id, location_ids, role, name, email)
    values (
      v_uid, v_inv.account_id, v_inv.location_ids, v_inv.role,
      coalesce(p_user_name, split_part(v_email, '@', 1)), v_email
    );

  update public.invitations set status = 'accepted' where id = v_inv.id;

  return v_inv.account_id;
end $$;

-- acknowledge_counseling: lets an employee acknowledge their own counseling
-- record without being able to read others' (RLS hides the table from them).
create or replace function public.acknowledge_counseling(p_record_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.auth_employee_id();
begin
  if v_emp is null then
    raise exception 'no employee profile';
  end if;
  update public.counseling_records
    set employee_acknowledged = true, acknowledged_at = now()
    where id = p_record_id and employee_id = v_emp;
  if not found then
    raise exception 'record not found or not yours';
  end if;
end $$;

grant execute on function public.signup_account(text, text, text, text) to authenticated;
grant execute on function public.accept_invitation(uuid, text) to authenticated;
grant execute on function public.acknowledge_counseling(uuid) to authenticated;
