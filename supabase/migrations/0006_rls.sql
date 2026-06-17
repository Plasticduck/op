-- 0006_rls.sql — Row Level Security for every table.
--
-- Model: three roles (owner | manager | employee), scoped by account + location.
-- Helpers from 0001 (auth_account_id / auth_role / auth_has_location /
-- auth_is_manager_plus) are SECURITY DEFINER and bypass RLS, so policies can
-- reference `users` without recursion.
--
-- Cross-cutting decisions:
--  * accounts/users/invitations creation happens via SECURITY DEFINER RPCs
--    (signup, accept_invitation) defined in a later migration — there are no
--    client INSERT policies for them here on purpose.
--  * ai_insights rows are written by the service-role Edge Function, which
--    bypasses RLS; clients only read + acknowledge.

-- Extra helper: current user's employee record (if any). ----------------------
create or replace function public.auth_employee_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.employees where user_id = auth.uid() limit 1
$$;

-- Helper: is `emp` at a location the current user can access? -----------------
create or replace function public.auth_can_see_employee(emp uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employees e
    where e.id = emp and public.auth_has_location(e.location_id)
  )
$$;

-- ===========================================================================
-- CORE
-- ===========================================================================
alter table public.accounts     enable row level security;
alter table public.locations    enable row level security;
alter table public.users        enable row level security;
alter table public.invitations  enable row level security;

create policy accounts_select on public.accounts
  for select using (id = public.auth_account_id());
create policy accounts_update on public.accounts
  for update using (id = public.auth_account_id() and public.auth_role() = 'owner')
  with check (id = public.auth_account_id() and public.auth_role() = 'owner');

-- Owners see every location in their account; managers/employees only the
-- locations they are assigned to (auth_has_location encodes both rules).
create policy locations_select on public.locations
  for select using (public.auth_has_location(id));
create policy locations_insert on public.locations
  for insert with check (account_id = public.auth_account_id() and public.auth_role() = 'owner');
create policy locations_update on public.locations
  for update using (account_id = public.auth_account_id() and public.auth_role() = 'owner')
  with check (account_id = public.auth_account_id() and public.auth_role() = 'owner');

create policy users_select on public.users
  for select using (
    id = auth.uid()
    or (account_id = public.auth_account_id() and public.auth_is_manager_plus())
  );
create policy users_update on public.users
  for update using (
    id = auth.uid()
    or (account_id = public.auth_account_id() and public.auth_role() = 'owner')
  )
  with check (
    id = auth.uid()
    or (account_id = public.auth_account_id() and public.auth_role() = 'owner')
  );
create policy users_delete on public.users
  for delete using (account_id = public.auth_account_id() and public.auth_role() = 'owner');

create policy invitations_all on public.invitations
  for all using (account_id = public.auth_account_id() and public.auth_role() = 'owner')
  with check (account_id = public.auth_account_id() and public.auth_role() = 'owner');

-- ===========================================================================
-- OPS — manager+ management tables (employees have no access)
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'equipment','work_orders','downtime_events','parts_inventory',
    'closeouts','contacts'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$
      create policy %1$s_select on public.%1$s for select
        using (public.auth_has_location(location_id) and public.auth_is_manager_plus());
    $f$, t);
    execute format($f$
      create policy %1$s_insert on public.%1$s for insert
        with check (public.auth_has_location(location_id) and public.auth_is_manager_plus());
    $f$, t);
    execute format($f$
      create policy %1$s_update on public.%1$s for update
        using (public.auth_has_location(location_id) and public.auth_is_manager_plus())
        with check (public.auth_has_location(location_id) and public.auth_is_manager_plus());
    $f$, t);
    execute format($f$
      create policy %1$s_delete on public.%1$s for delete
        using (public.auth_has_location(location_id) and public.auth_role() = 'owner');
    $f$, t);
  end loop;
end $$;

-- work_order_parts: scope through parent work order's location ----------------
alter table public.work_order_parts enable row level security;
create policy wop_all on public.work_order_parts
  for all using (
    exists (
      select 1 from public.work_orders w
      where w.id = work_order_id
        and public.auth_has_location(w.location_id)
        and public.auth_is_manager_plus()
    )
  )
  with check (
    exists (
      select 1 from public.work_orders w
      where w.id = work_order_id
        and public.auth_has_location(w.location_id)
        and public.auth_is_manager_plus()
    )
  );

-- Checklists: definitions readable by all roles at location; manager+ writes --
alter table public.checklists      enable row level security;
alter table public.checklist_items enable row level security;

create policy checklists_select on public.checklists
  for select using (public.auth_has_location(location_id));
create policy checklists_write on public.checklists
  for all using (public.auth_has_location(location_id) and public.auth_is_manager_plus())
  with check (public.auth_has_location(location_id) and public.auth_is_manager_plus());

create policy checklist_items_select on public.checklist_items
  for select using (
    exists (select 1 from public.checklists c
            where c.id = checklist_id and public.auth_has_location(c.location_id))
  );
create policy checklist_items_write on public.checklist_items
  for all using (
    exists (select 1 from public.checklists c
            where c.id = checklist_id and public.auth_has_location(c.location_id)
              and public.auth_is_manager_plus())
  )
  with check (
    exists (select 1 from public.checklists c
            where c.id = checklist_id and public.auth_has_location(c.location_id)
              and public.auth_is_manager_plus())
  );

-- Checklist completions: any role at location may read + complete -------------
alter table public.checklist_completions enable row level security;
create policy cc_select on public.checklist_completions
  for select using (public.auth_has_location(location_id));
create policy cc_insert on public.checklist_completions
  for insert with check (public.auth_has_location(location_id));
create policy cc_modify on public.checklist_completions
  for update using (public.auth_has_location(location_id) and public.auth_is_manager_plus())
  with check (public.auth_has_location(location_id) and public.auth_is_manager_plus());
create policy cc_delete on public.checklist_completions
  for delete using (public.auth_has_location(location_id) and public.auth_is_manager_plus());

-- Documents: read by all at location; write manager+ -------------------------
alter table public.documents enable row level security;
create policy documents_select on public.documents
  for select using (public.auth_has_location(location_id));
create policy documents_write on public.documents
  for all using (public.auth_has_location(location_id) and public.auth_is_manager_plus())
  with check (public.auth_has_location(location_id) and public.auth_is_manager_plus());

-- Supplies requests: any role submits + reads; manager+ updates status -------
alter table public.supplies_requests enable row level security;
create policy supplies_select on public.supplies_requests
  for select using (public.auth_has_location(location_id));
create policy supplies_insert on public.supplies_requests
  for insert with check (public.auth_has_location(location_id));
create policy supplies_update on public.supplies_requests
  for update using (public.auth_has_location(location_id) and public.auth_is_manager_plus())
  with check (public.auth_has_location(location_id) and public.auth_is_manager_plus());
create policy supplies_delete on public.supplies_requests
  for delete using (public.auth_has_location(location_id) and public.auth_is_manager_plus());

-- ===========================================================================
-- PEOPLE
-- ===========================================================================
alter table public.employees           enable row level security;
alter table public.schedules           enable row level security;
alter table public.shifts              enable row level security;
alter table public.schedule_templates  enable row level security;
alter table public.time_entries        enable row level security;
alter table public.reviews             enable row level security;
alter table public.counseling_records  enable row level security;
alter table public.injury_reports      enable row level security;
alter table public.uniform_requests    enable row level security;

-- employees: manager+ full at location; employee may read own record ---------
create policy employees_select on public.employees
  for select using (
    (public.auth_has_location(location_id) and public.auth_is_manager_plus())
    or user_id = auth.uid()
  );
create policy employees_write on public.employees
  for all using (public.auth_has_location(location_id) and public.auth_is_manager_plus())
  with check (public.auth_has_location(location_id) and public.auth_is_manager_plus());

-- schedules: manager+ full; employees read published at their location -------
create policy schedules_select on public.schedules
  for select using (
    (public.auth_has_location(location_id) and public.auth_is_manager_plus())
    or (public.auth_has_location(location_id) and published = true)
  );
create policy schedules_write on public.schedules
  for all using (public.auth_has_location(location_id) and public.auth_is_manager_plus())
  with check (public.auth_has_location(location_id) and public.auth_is_manager_plus());

-- shifts: manager+ full; employees read only their own (published) shifts ----
create policy shifts_select on public.shifts
  for select using (
    exists (
      select 1 from public.schedules s
      where s.id = schedule_id
        and (
          (public.auth_has_location(s.location_id) and public.auth_is_manager_plus())
          or (s.published = true and employee_id = public.auth_employee_id())
        )
    )
  );
create policy shifts_write on public.shifts
  for all using (
    exists (select 1 from public.schedules s
            where s.id = schedule_id
              and public.auth_has_location(s.location_id)
              and public.auth_is_manager_plus())
  )
  with check (
    exists (select 1 from public.schedules s
            where s.id = schedule_id
              and public.auth_has_location(s.location_id)
              and public.auth_is_manager_plus())
  );

create policy sched_templates_all on public.schedule_templates
  for all using (public.auth_has_location(location_id) and public.auth_is_manager_plus())
  with check (public.auth_has_location(location_id) and public.auth_is_manager_plus());

-- time_entries: manager+ full at location; employee read/insert/update own ---
create policy time_entries_select on public.time_entries
  for select using (
    (public.auth_has_location(location_id) and public.auth_is_manager_plus())
    or employee_id = public.auth_employee_id()
  );
create policy time_entries_insert on public.time_entries
  for insert with check (
    (public.auth_has_location(location_id) and public.auth_is_manager_plus())
    or employee_id = public.auth_employee_id()
  );
create policy time_entries_update on public.time_entries
  for update using (
    (public.auth_has_location(location_id) and public.auth_is_manager_plus())
    or employee_id = public.auth_employee_id()
  )
  with check (
    (public.auth_has_location(location_id) and public.auth_is_manager_plus())
    or employee_id = public.auth_employee_id()
  );
create policy time_entries_delete on public.time_entries
  for delete using (public.auth_has_location(location_id) and public.auth_is_manager_plus());

-- reviews: manager+ full; employee reads own completed reviews ---------------
create policy reviews_select on public.reviews
  for select using (
    public.auth_can_see_employee(employee_id) and public.auth_is_manager_plus()
    or (employee_id = public.auth_employee_id() and status = 'completed')
  );
create policy reviews_write on public.reviews
  for all using (public.auth_can_see_employee(employee_id) and public.auth_is_manager_plus())
  with check (public.auth_can_see_employee(employee_id) and public.auth_is_manager_plus());

-- counseling_records: manager+ only. Employee acknowledgement is handled by a
-- SECURITY DEFINER RPC (Phase 6), so there is no employee policy here.
create policy counseling_all on public.counseling_records
  for all using (public.auth_can_see_employee(employee_id) and public.auth_is_manager_plus())
  with check (public.auth_can_see_employee(employee_id) and public.auth_is_manager_plus());

-- injury_reports: manager+ only ----------------------------------------------
create policy injuries_all on public.injury_reports
  for all using (public.auth_has_location(location_id) and public.auth_is_manager_plus())
  with check (public.auth_has_location(location_id) and public.auth_is_manager_plus());

-- uniform_requests: manager+ full; employee reads + submits own --------------
create policy uniforms_select on public.uniform_requests
  for select using (
    (public.auth_can_see_employee(employee_id) and public.auth_is_manager_plus())
    or employee_id = public.auth_employee_id()
  );
create policy uniforms_insert on public.uniform_requests
  for insert with check (
    (public.auth_can_see_employee(employee_id) and public.auth_is_manager_plus())
    or employee_id = public.auth_employee_id()
  );
create policy uniforms_update on public.uniform_requests
  for update using (public.auth_can_see_employee(employee_id) and public.auth_is_manager_plus())
  with check (public.auth_can_see_employee(employee_id) and public.auth_is_manager_plus());
create policy uniforms_delete on public.uniform_requests
  for delete using (public.auth_can_see_employee(employee_id) and public.auth_is_manager_plus());

-- ===========================================================================
-- REPORTS / AI / AUDIT
-- ===========================================================================
alter table public.saved_reports            enable row level security;
alter table public.ai_insights              enable row level security;
alter table public.ai_insights_refresh_log  enable row level security;
alter table public.audit_log                enable row level security;

create policy saved_reports_select on public.saved_reports
  for select using (account_id = public.auth_account_id() and public.auth_is_manager_plus());
create policy saved_reports_write on public.saved_reports
  for all using (account_id = public.auth_account_id() and public.auth_is_manager_plus())
  with check (account_id = public.auth_account_id() and public.auth_is_manager_plus());

-- ai_insights: manager+ read + acknowledge (update). Inserts come from the
-- service-role Edge Function which bypasses RLS.
create policy ai_insights_select on public.ai_insights
  for select using (account_id = public.auth_account_id() and public.auth_is_manager_plus());
create policy ai_insights_update on public.ai_insights
  for update using (account_id = public.auth_account_id() and public.auth_is_manager_plus())
  with check (account_id = public.auth_account_id() and public.auth_is_manager_plus());

create policy ai_refresh_select on public.ai_insights_refresh_log
  for select using (account_id = public.auth_account_id() and public.auth_is_manager_plus());

-- audit_log: manager+ read only. Writes happen via SECURITY DEFINER triggers.
create policy audit_select on public.audit_log
  for select using (
    public.auth_is_manager_plus()
    and (
      -- only rows that belong to the caller's account, resolved per source table
      (table_name = 'work_orders'  and exists (select 1 from public.work_orders w  where w.id = row_id and w.location_id in (select id from public.locations where account_id = public.auth_account_id())))
      or (table_name = 'closeouts' and exists (select 1 from public.closeouts c    where c.id = row_id and c.location_id in (select id from public.locations where account_id = public.auth_account_id())))
      or (table_name = 'time_entries' and exists (select 1 from public.time_entries te where te.id = row_id and te.location_id in (select id from public.locations where account_id = public.auth_account_id())))
    )
  );
