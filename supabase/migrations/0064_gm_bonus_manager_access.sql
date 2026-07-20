-- 0064_gm_bonus_manager_access.sql
-- Let granted managers use the GM/AGM bonuses for their own sites. Owners keep
-- full access (auth_has_location has an owner bypass). Regional stays owner-only
-- in the UI. Employees/technicians remain excluded.

drop policy if exists gm_bonus_base_all on public.gm_bonus_base;
create policy gm_bonus_base_all on public.gm_bonus_base
  for all
  using (account_id = auth_account_id() and auth_role() in ('owner', 'manager') and auth_has_location(location_id))
  with check (account_id = auth_account_id() and auth_role() in ('owner', 'manager') and auth_has_location(location_id));

drop policy if exists gm_bonus_months_all on public.gm_bonus_months;
create policy gm_bonus_months_all on public.gm_bonus_months
  for all
  using (account_id = auth_account_id() and auth_role() in ('owner', 'manager') and auth_has_location(location_id))
  with check (account_id = auth_account_id() and auth_role() in ('owner', 'manager') and auth_has_location(location_id));

-- GM/AGM manager names live in accounts.company_settings (owner-only, since it
-- also holds permissions/regions). This function lets a manager save ONLY the
-- siteManagers key, so they can edit names without touching anything else.
create or replace function public.gm_bonus_set_site_managers(p_account_id uuid, p_site_managers jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_account_id <> auth_account_id() or auth_role() not in ('owner', 'manager') then
    raise exception 'not authorized';
  end if;
  update public.accounts
    set company_settings = jsonb_set(coalesce(company_settings, '{}'::jsonb), '{siteManagers}', p_site_managers, true)
    where id = p_account_id;
end $$;

grant execute on function public.gm_bonus_set_site_managers(uuid, jsonb) to authenticated;
