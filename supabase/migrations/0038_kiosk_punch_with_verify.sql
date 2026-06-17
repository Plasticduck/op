-- 0038_kiosk_punch_with_verify.sql
-- Two changes:
--   1) New SECURITY DEFINER `resolve_kiosk_pin` so the kiosk can look up the
--      employee BEFORE punching - lets us pre-capture the selfie and check the
--      geofence with the employee's name on screen, then commit atomically.
--   2) Extended `kiosk_punch_by_pin` that accepts the verification metadata
--      (lat/lng, distance, fence flag, face flag, photo path) and returns the
--      created/updated row id so the manager view can deep-link to it.
--      Existing callers that only pass (location, pin) keep working unchanged.

create or replace function public.resolve_kiosk_pin(
  p_location_id uuid,
  p_pin text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_emp record;
  v_open uuid;
begin
  if not public.auth_is_manager_plus() then raise exception 'forbidden'; end if;
  if not public.auth_has_location(p_location_id) then raise exception 'forbidden'; end if;
  if p_pin !~ '^\d{4}$' then raise exception 'invalid PIN'; end if;

  select e.id, e.first_name, e.last_name, l.account_id
    into v_emp
    from public.employees e
    join public.locations l on l.id = e.location_id
   where e.location_id = p_location_id
     and e.status = 'active'
     and e.pin_hash is not null
     and e.pin_hash = crypt(p_pin, e.pin_hash)
   limit 1;
  if v_emp is null then raise exception 'invalid PIN'; end if;

  select id into v_open from public.time_entries
   where employee_id = v_emp.id and clock_out is null
   order by clock_in desc limit 1;

  return jsonb_build_object(
    'employee_id', v_emp.id,
    'account_id', v_emp.account_id,
    'name', v_emp.first_name || ' ' || v_emp.last_name,
    'next_action', case when v_open is null then 'in' else 'out' end
  );
end $$;

-- Replace the punch RPC with a version that takes verification metadata. The
-- two new params default to NULL so older clients keep working. Returns the
-- time_entries row id alongside the action and name.

drop function if exists public.kiosk_punch_by_pin(uuid, text);

create or replace function public.kiosk_punch_by_pin(
  p_location_id uuid,
  p_pin text,
  p_lat numeric default null,
  p_lng numeric default null,
  p_distance_m integer default null,
  p_outside_fence boolean default null,
  p_face_detected boolean default null,
  p_photo_path text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid; v_first text; v_last text; v_open uuid; v_action text; v_entry_id uuid;
begin
  if not public.auth_is_manager_plus() then raise exception 'forbidden'; end if;
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
    update public.time_entries
       set clock_out = now(),
           punch_out_lat = p_lat,
           punch_out_lng = p_lng,
           punch_out_distance_m = p_distance_m,
           punch_out_outside_fence = p_outside_fence,
           punch_out_face_detected = p_face_detected,
           punch_out_photo_path = p_photo_path
     where id = v_open
     returning id into v_entry_id;
    v_action := 'out';
  else
    insert into public.time_entries (
      location_id, employee_id, clock_in,
      punch_in_lat, punch_in_lng, punch_in_distance_m,
      punch_in_outside_fence, punch_in_face_detected, punch_in_photo_path
    ) values (
      p_location_id, v_id, now(),
      p_lat, p_lng, p_distance_m,
      p_outside_fence, p_face_detected, p_photo_path
    ) returning id into v_entry_id;
    v_action := 'in';
  end if;

  return jsonb_build_object(
    'id', v_entry_id,
    'action', v_action,
    'name', v_first || ' ' || v_last
  );
end $$;
