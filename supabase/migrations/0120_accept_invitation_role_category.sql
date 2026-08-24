-- Carry the invitation's role_category onto the new user so someone invited as a
-- Regional Manager / Executive keeps that category (not just the base manager role).
create or replace function public.accept_invitation(p_token uuid, p_user_name text default null::text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  insert into public.users (id, account_id, location_ids, role, role_category, name, email)
    values (v_uid, v_inv.account_id, v_inv.location_ids, v_inv.role, v_inv.role_category, v_name, v_email);

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
end $function$;

create or replace function public.admin_accept_invitation(p_token uuid, p_user_id uuid, p_user_name text default null::text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    update public.invitations set status = 'accepted' where id = v_inv.id;
    return v_inv.account_id;
  end if;

  select email into v_email from auth.users where id = p_user_id;
  v_name := coalesce(nullif(trim(v_inv.name), ''), nullif(trim(p_user_name), ''), split_part(v_email, '@', 1));

  insert into public.users (id, account_id, location_ids, role, role_category, name, email)
    values (p_user_id, v_inv.account_id, v_inv.location_ids, v_inv.role, v_inv.role_category, v_name, v_email)
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
end $function$;
