-- 0043_technician_role.sql
-- Adds a fourth role, `technician`: a cross-site maintenance role. In the app it
-- sees Overview + Maintenance in full, a slice of Operations (contacts,
-- invoices, inventory) and People (time clock, time off, breaks, calendar), and
-- Team + Locations under Account. The fine-grained menu/route gating lives in
-- the frontend (src/routes, src/components/layout/Sidebar.tsx).
--
-- At the database level a technician is treated as:
--   * all-sites (like an owner) for location access, and
--   * manager-plus for writes,
-- so the maintenance features actually function. RLS uses one global
-- auth_is_manager_plus() helper rather than per-table policies, so this grants
-- technicians manager-level read/write on every manager-plus table. If you need
-- DB-level isolation of HR/vendor/marketing tables from technicians, that's a
-- follow-up requiring per-table policies.

-- 1. Allow the new role value on users and invites. ---------------------------
alter table public.users drop constraint if exists users_role_check;
alter table public.users
  add constraint users_role_check
  check (role in ('owner', 'manager', 'employee', 'technician'));

alter table public.invitations drop constraint if exists invitations_role_check;
alter table public.invitations
  add constraint invitations_role_check
  check (role in ('manager', 'employee', 'technician'));

-- 2. Location access: technicians span every site in their account, like owners.
create or replace function public.auth_has_location(loc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and (
        (u.role in ('owner', 'technician')
          and exists (
            select 1 from public.locations l
            where l.id = loc and l.account_id = u.account_id
          ))
        or loc = any(u.location_ids)
      )
  )
$$;

-- 3. Writes: technicians act as manager-plus so they can run maintenance work.
create or replace function public.auth_is_manager_plus()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role from public.users where id = auth.uid()) in ('owner', 'manager', 'technician'),
    false
  )
$$;

-- 4. The locations list must surface all account sites for technicians too. ----
drop policy if exists locations_select on public.locations;
create policy locations_select on public.locations
  for select using (
    (public.auth_role() in ('owner', 'technician') and account_id = public.auth_account_id())
    or id = any(public.auth_location_ids())
  );
