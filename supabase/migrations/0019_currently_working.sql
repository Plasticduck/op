-- 0019_currently_working.sql
-- Employees can only read their OWN time entries (RLS), but the dashboard needs
-- to show everyone currently on shift. This RPC returns just the roster of
-- who's clocked in (name + since) for a location the caller can access — no
-- full time-entry rows exposed.

create or replace function public.currently_working(p_location_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.auth_has_location(p_location_id) then coalesce(
    (select jsonb_agg(jsonb_build_object(
       'name', e.first_name || ' ' || e.last_name,
       'since', t.clock_in
     ) order by t.clock_in)
     from public.time_entries t
     join public.employees e on e.id = t.employee_id
     where t.location_id = p_location_id and t.clock_out is null),
    '[]'::jsonb)
  else '[]'::jsonb end
$$;

grant execute on function public.currently_working(uuid) to authenticated;
