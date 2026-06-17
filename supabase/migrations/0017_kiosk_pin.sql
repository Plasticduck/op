-- 0017_kiosk_pin.sql — PIN-first kiosk.
-- The kiosk now identifies the employee by their 4-digit PIN (no name picker),
-- so PINs must be unique among active employees at a location.

-- Enforce per-location PIN uniqueness when setting a PIN.
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
  if exists (
    select 1 from public.employees e
    where e.location_id = v_loc
      and e.id <> p_employee_id
      and e.status = 'active'
      and e.pin_hash is not null
      and e.pin_hash = crypt(p_pin, e.pin_hash)
  ) then
    raise exception 'That PIN is already in use at this location';
  end if;
  update public.employees set pin_hash = crypt(p_pin, gen_salt('bf')) where id = p_employee_id;
end $$;

-- Punch by PIN: find the active employee at the location whose PIN matches,
-- toggle their open time entry, and return who + which direction.
create or replace function public.kiosk_punch_by_pin(p_location_id uuid, p_pin text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare v_id uuid; v_first text; v_last text; v_open uuid; v_action text;
begin
  if not public.auth_has_location(p_location_id) then raise exception 'forbidden'; end if;
  if p_pin !~ '^\d{4}$' then raise exception 'invalid PIN'; end if;

  select id, first_name, last_name into v_id, v_first, v_last
    from public.employees
    where location_id = p_location_id
      and status = 'active'
      and pin_hash is not null
      and pin_hash = crypt(p_pin, pin_hash)
    limit 1;
  if v_id is null then raise exception 'invalid PIN'; end if;

  select id into v_open from public.time_entries
    where employee_id = v_id and clock_out is null
    order by clock_in desc limit 1;

  if v_open is not null then
    update public.time_entries set clock_out = now() where id = v_open;
    v_action := 'out';
  else
    insert into public.time_entries (location_id, employee_id, clock_in)
      values (p_location_id, v_id, now());
    v_action := 'in';
  end if;

  return jsonb_build_object('action', v_action, 'name', v_first || ' ' || v_last);
end $$;

grant execute on function public.kiosk_punch_by_pin(uuid, text) to authenticated;
