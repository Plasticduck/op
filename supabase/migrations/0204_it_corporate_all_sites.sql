-- IT Inventory: equipment can belong to "Corporate" or "All Sites" as well as a
-- car wash. Everything in the module hangs off a required location_id (assets,
-- assignments, repairs, audits, moves), so these are two real locations rows,
-- one pair per account, tagged it_scope and always archived. Archived keeps them
-- out of billing and of every site list in the rest of the app; IT Inventory adds
-- them back through useItSites.

alter table public.locations
  add column if not exists it_scope text check (it_scope in ('corporate', 'all_sites'));
alter table public.locations
  add constraint locations_it_scope_hidden check (it_scope is null or archived);
create unique index if not exists locations_it_scope_unq
  on public.locations (account_id, it_scope) where it_scope is not null;

-- A location normally gets a Messages channel when it's created. These don't.
drop trigger if exists locations_create_site_chat on public.locations;
create trigger locations_create_site_chat after insert on public.locations
  for each row when (new.it_scope is null)
  execute function public.create_site_chat_for_location();

-- Staff can see these two. Managers otherwise only see the sites they're on.
create policy locations_select_it_shared on public.locations for select
  using (it_scope is not null and account_id = auth_account_id()
         and auth_role() in ('owner', 'manager', 'technician'));

create or replace function public.it_is_shared_site(loc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.locations l
     where l.id = loc and l.account_id = auth_account_id() and l.it_scope is not null
  )
$$;

-- They belong to no one site, so no manager has them in location_ids: any staff
-- can work with their equipment. Crew stay limited to their own sites.
create or replace function public.it_can_read(loc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth_account_id() is not null and (
    loc is null or auth_has_location(loc)
    or (auth_role() in ('owner', 'manager', 'technician') and it_is_shared_site(loc))
  )
$$;

create or replace function public.it_can_write(loc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(case
    when loc is null then auth_role() = 'owner'
    else auth_role() in ('owner', 'manager', 'technician') and (auth_has_location(loc) or it_is_shared_site(loc))
  end, false)
$$;

-- A spreadsheet import can name them too.
create or replace function public.it_find_site(p_name text)
returns uuid language plpgsql stable security invoker set search_path = public as $$
declare
  v_id uuid;
  n    integer;
begin
  if nullif(btrim(p_name), '') is null then return null; end if;
  select id into v_id from public.locations
   where account_id = auth_account_id() and (not coalesce(archived, false) or it_scope is not null)
     and lower(name) = lower(btrim(p_name));
  if v_id is not null then return v_id; end if;
  select count(*), min(id::text)::uuid into n, v_id from public.locations
   where account_id = auth_account_id() and (not coalesce(archived, false) or it_scope is not null)
     and lower(name) like lower(btrim(p_name)) || '%';
  return case when n = 1 then v_id end;
end $$;

-- Every account with IT Inventory has the pair, from the moment it's set up.
create or replace function public.it_add_shared_sites()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.locations (account_id, name, archived, it_scope)
  values (new.account_id, 'Corporate', true, 'corporate'), (new.account_id, 'All Sites', true, 'all_sites')
  on conflict (account_id, it_scope) where it_scope is not null do nothing;
  return new;
end $$;
create trigger it_settings_add_shared_sites after insert on public.it_settings
  for each row execute function public.it_add_shared_sites();

insert into public.locations (account_id, name, archived, it_scope)
select s.account_id, v.name, true, v.scope
  from public.it_settings s
 cross join (values ('Corporate', 'corporate'), ('All Sites', 'all_sites')) as v(name, scope)
on conflict (account_id, it_scope) where it_scope is not null do nothing;
