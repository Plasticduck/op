-- 0051_checklist_account_rls.sql
-- Fix checklist template visibility. Migration 0031 moved checklists to an
-- account-scoped template model (location_id nullable, sites assigned via the
-- checklist_locations M:N table), but the RLS policies still gated on
-- auth_has_location(location_id). For a new-model template location_id is NULL,
-- so auth_has_location(NULL) is false and the template + its items become
-- invisible to everyone -- which made the daily view's checklist embed come back
-- null and crash the page. Gate on the account instead (with a location
-- fallback so any legacy single-location rows keep working).

drop policy if exists checklists_select on public.checklists;
create policy checklists_select on public.checklists for select
  using (
    account_id = public.auth_account_id()
    or public.auth_has_location(location_id)
  );

drop policy if exists checklists_write on public.checklists;
create policy checklists_write on public.checklists for all
  using (
    (account_id = public.auth_account_id() or public.auth_has_location(location_id))
    and public.auth_is_manager_plus()
  )
  with check (
    (account_id = public.auth_account_id() or public.auth_has_location(location_id))
    and public.auth_is_manager_plus()
  );

drop policy if exists checklist_items_select on public.checklist_items;
create policy checklist_items_select on public.checklist_items for select
  using (
    exists (
      select 1 from public.checklists c
      where c.id = checklist_items.checklist_id
        and (c.account_id = public.auth_account_id() or public.auth_has_location(c.location_id))
    )
  );

drop policy if exists checklist_items_write on public.checklist_items;
create policy checklist_items_write on public.checklist_items for all
  using (
    exists (
      select 1 from public.checklists c
      where c.id = checklist_items.checklist_id
        and (c.account_id = public.auth_account_id() or public.auth_has_location(c.location_id))
        and public.auth_is_manager_plus()
    )
  )
  with check (
    exists (
      select 1 from public.checklists c
      where c.id = checklist_items.checklist_id
        and (c.account_id = public.auth_account_id() or public.auth_has_location(c.location_id))
        and public.auth_is_manager_plus()
    )
  );
