-- Page grants (migration 0241) reach the data behind two pages whose database
-- rules named one person or role: Site Visits (kevan@washlyfe.com only) and the
-- Quarterly Goal Tracker (Admins only). Anyone the super admin grants the page on
-- the Team page can now use it. The Dashboard can't be granted or blocked (it's
-- where blocked pages send people).

alter table public.page_access add constraint page_access_not_dashboard check (page <> '/app/dashboard');

drop policy fleet_people_select on public.fleet_people;
create policy fleet_people_select on public.fleet_people
  for select using (
    account_id = auth_account_id()
    and (lower(coalesce(auth.jwt() ->> 'email', '')) = 'kevan@washlyfe.com' or public.auth_page_granted('/app/site-visits'))
  );
drop policy fleet_people_update on public.fleet_people;
create policy fleet_people_update on public.fleet_people
  for update using (
    account_id = auth_account_id()
    and (lower(coalesce(auth.jwt() ->> 'email', '')) = 'kevan@washlyfe.com' or public.auth_page_granted('/app/site-visits'))
  );
drop policy vehicle_site_visits_select on public.vehicle_site_visits;
create policy vehicle_site_visits_select on public.vehicle_site_visits
  for select using (
    account_id = auth_account_id()
    and (lower(coalesce(auth.jwt() ->> 'email', '')) = 'kevan@washlyfe.com' or public.auth_page_granted('/app/site-visits'))
  );

drop policy exec_goals_owner on public.exec_goals;
create policy exec_goals_owner on public.exec_goals
  for all using (account_id = auth_account_id() and (auth_role() = 'owner' or public.auth_page_granted('/app/goal-tracker')))
  with check (account_id = auth_account_id() and (auth_role() = 'owner' or public.auth_page_granted('/app/goal-tracker')));
drop policy exec_goal_milestones_owner on public.exec_goal_milestones;
create policy exec_goal_milestones_owner on public.exec_goal_milestones
  for all using (account_id = auth_account_id() and (auth_role() = 'owner' or public.auth_page_granted('/app/goal-tracker')))
  with check (account_id = auth_account_id() and (auth_role() = 'owner' or public.auth_page_granted('/app/goal-tracker')));
drop policy exec_goal_checkins_owner on public.exec_goal_checkins;
create policy exec_goal_checkins_owner on public.exec_goal_checkins
  for all using (account_id = auth_account_id() and (auth_role() = 'owner' or public.auth_page_granted('/app/goal-tracker')))
  with check (account_id = auth_account_id() and (auth_role() = 'owner' or public.auth_page_granted('/app/goal-tracker')));
