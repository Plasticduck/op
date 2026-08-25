-- Allow uniform requests for "Store Stock" (general inventory, not a person):
-- employee_id becomes nullable and a location_id scopes store-stock requests to a
-- site. RLS gains a location branch for manager+ when there's no employee.
alter table public.uniform_requests add column if not exists location_id uuid references public.locations(id) on delete cascade;
alter table public.uniform_requests alter column employee_id drop not null;

-- Backfill location_id from the employee so existing rows still load by location.
update public.uniform_requests ur
  set location_id = e.location_id
  from public.employees e
  where ur.employee_id = e.id and ur.location_id is null;

drop policy if exists uniforms_select on public.uniform_requests;
create policy uniforms_select on public.uniform_requests for select using (
  (employee_id is not null and auth_can_see_employee(employee_id) and auth_is_manager_plus())
  or (employee_id = auth_employee_id())
  or (employee_id is null and auth_has_location(location_id) and auth_is_manager_plus())
);

drop policy if exists uniforms_insert on public.uniform_requests;
create policy uniforms_insert on public.uniform_requests for insert with check (
  (employee_id is not null and auth_can_see_employee(employee_id) and auth_is_manager_plus())
  or (employee_id = auth_employee_id())
  or (employee_id is null and auth_has_location(location_id) and auth_is_manager_plus())
);

drop policy if exists uniforms_update on public.uniform_requests;
create policy uniforms_update on public.uniform_requests for update using (
  (employee_id is not null and auth_can_see_employee(employee_id) and auth_is_manager_plus())
  or (employee_id is null and auth_has_location(location_id) and auth_is_manager_plus())
) with check (
  (employee_id is not null and auth_can_see_employee(employee_id) and auth_is_manager_plus())
  or (employee_id is null and auth_has_location(location_id) and auth_is_manager_plus())
);

drop policy if exists uniforms_delete on public.uniform_requests;
create policy uniforms_delete on public.uniform_requests for delete using (
  (employee_id is not null and auth_can_see_employee(employee_id) and auth_is_manager_plus())
  or (employee_id is null and auth_has_location(location_id) and auth_is_manager_plus())
);
