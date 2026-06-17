-- 0024_break_autoclock.sql
-- Break flow change: going on break auto-clocks the employee out, and returning
-- from break is kiosk-only (the "End break" button is removed from the app).
--   • start_break(p_break_id): employee marks a break started → also closes their
--     open time entry (auto clock-out).
--   • kiosk_punch_by_pin: when a punch results in a clock-IN, also end any active
--     break for that employee (so clocking back in at the kiosk ends the break).

create or replace function public.start_break(p_break_id uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare
  v_emp uuid := public.auth_employee_id();
  v_break_emp uuid;
begin
  if v_emp is null then raise exception 'no employee profile'; end if;

  select employee_id into v_break_emp from public.breaks where id = p_break_id;
  if v_break_emp is null then raise exception 'break not found'; end if;
  if v_break_emp <> v_emp then raise exception 'forbidden'; end if;

  update public.breaks
    set started_at = coalesce(started_at, now())
    where id = p_break_id and ended_at is null;

  -- Auto clock-out: close any open time entry for this employee.
  update public.time_entries
    set clock_out = now()
    where employee_id = v_emp and clock_out is null;
end $$;

grant execute on function public.start_break(uuid) to authenticated;

-- Recreate the kiosk punch so a clock-IN also ends an in-progress break.
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
    -- Returning from break: end any break that's started but not yet ended.
    update public.breaks set ended_at = now()
      where employee_id = v_id and started_at is not null and ended_at is null;
  end if;

  return jsonb_build_object('action', v_action, 'name', v_first || ' ' || v_last);
end $$;

grant execute on function public.kiosk_punch_by_pin(uuid, text) to authenticated;
