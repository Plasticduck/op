-- 0013_people_rpcs.sql — Time Clock kiosk support.
-- PINs are bcrypt-hashed via pgcrypto; plaintext never touches the client or
-- the row. Both RPCs require the caller to have access to the employee's
-- location (the kiosk runs under a manager/owner session on a shared tablet).

-- Manager+ sets/updates an employee's 4-digit kiosk PIN.
create or replace function public.set_employee_pin(p_employee_id uuid, p_pin text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare v_loc uuid;
begin
  select location_id into v_loc from public.employees where id = p_employee_id;
  if v_loc is null then raise exception 'employee not found'; end if;
  if not public.auth_is_manager_plus() or not public.auth_has_location(v_loc) then
    raise exception 'forbidden';
  end if;
  if p_pin !~ '^\d{4}$' then raise exception 'PIN must be exactly 4 digits'; end if;
  update public.employees
    set pin_hash = crypt(p_pin, gen_salt('bf'))
    where id = p_employee_id;
end $$;

-- Kiosk punch: verify PIN, then toggle the employee's open time entry.
-- Returns 'in' or 'out'.
create or replace function public.kiosk_punch(p_employee_id uuid, p_pin text)
returns text language plpgsql security definer
set search_path = public, extensions as $$
declare v_loc uuid; v_hash text; v_open uuid;
begin
  select location_id, pin_hash into v_loc, v_hash
    from public.employees where id = p_employee_id;
  if v_loc is null then raise exception 'employee not found'; end if;
  if not public.auth_has_location(v_loc) then raise exception 'forbidden'; end if;
  if v_hash is null then raise exception 'no PIN set for this employee'; end if;
  if crypt(p_pin, v_hash) <> v_hash then raise exception 'invalid PIN'; end if;

  select id into v_open from public.time_entries
    where employee_id = p_employee_id and clock_out is null
    order by clock_in desc limit 1;

  if v_open is not null then
    update public.time_entries set clock_out = now() where id = v_open;
    return 'out';
  else
    insert into public.time_entries (location_id, employee_id, clock_in)
      values (v_loc, p_employee_id, now());
    return 'in';
  end if;
end $$;

-- Whether an employee has a PIN set (for kiosk UI), without exposing the hash.
create or replace function public.employee_has_pin(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select pin_hash is not null from public.employees where id = p_employee_id
$$;

grant execute on function public.set_employee_pin(uuid, text) to authenticated;
grant execute on function public.kiosk_punch(uuid, text) to authenticated;
grant execute on function public.employee_has_pin(uuid) to authenticated;
