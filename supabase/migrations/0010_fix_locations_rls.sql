-- 0010_fix_locations_rls.sql
-- Fix: `locations_select` used auth_has_location(id), which self-queries the
-- locations table. On INSERT ... RETURNING, Postgres also evaluates the SELECT
-- policy against the new row, but that row isn't visible to the STABLE
-- security-definer subquery yet — so every owner location insert failed with
-- "new row violates row-level security policy".
--
-- New policy reads only the row's own columns + the caller's own location_ids
-- (via a helper), with no self-reference. Same access semantics: owners see all
-- locations in their account; managers/employees see their assigned ones.

create or replace function public.auth_location_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(location_ids, '{}') from public.users where id = auth.uid()
$$;

drop policy if exists locations_select on public.locations;

create policy locations_select on public.locations
  for select using (
    (public.auth_role() = 'owner' and account_id = public.auth_account_id())
    or id = any(public.auth_location_ids())
  );
