-- Signage orders can target a specific site or ALL SITES (location_id null).
-- A null-location order is visible on every site's page. Also allow ordering for
-- any site in the account, not only the caller's own locations.
alter table public.signage_requests alter column location_id drop not null;

drop policy if exists signage_requests_select on public.signage_requests;
create policy signage_requests_select on public.signage_requests
  for select using (
    account_id = auth_account_id()
    and (location_id is null or auth_has_location(location_id))
  );

drop policy if exists signage_requests_insert on public.signage_requests;
create policy signage_requests_insert on public.signage_requests
  for insert with check (account_id = auth_account_id());
