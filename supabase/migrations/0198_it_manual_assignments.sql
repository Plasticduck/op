-- Allow inventory assets to be assigned to a typed person name as well as an
-- employee in the roster. The random UUID is an internal assignment key; the
-- user-entered name remains the display label.

create or replace function public.it_assignments_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a  public.it_assets%rowtype;
  st public.it_status_labels%rowtype;
begin
  if auth.uid() is not null and new.account_id is distinct from auth_account_id() then
    raise exception 'new row violates row-level security policy for table ''it_assignments''' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.checked_in_at is not null then
      raise exception 'This check-out is closed';
    end if;
    if new.asset_id <> old.asset_id or new.assigned_type <> old.assigned_type or new.assigned_id <> old.assigned_id then
      raise exception 'Check it in and out again to change who has it';
    end if;
    if new.checked_in_at is not null and new.checked_in_by is null then
      new.checked_in_by := auth.uid();
    end if;
    return new;
  end if;

  select * into a from public.it_assets where id = new.asset_id and account_id = new.account_id;
  if not found or a.deleted_at is not null then
    raise exception 'Unknown asset';
  end if;
  select * into st from public.it_status_labels where id = a.status_label_id;
  if st.type <> 'deployable' then
    raise exception 'This item is %, so it can''t be checked out. Change its status first.', st.name
      using errcode = 'P0001', hint = 'not_deployable';
  end if;
  new.location_id := a.location_id;
  new.checked_in_at := null;
  new.assigned_label := nullif(btrim(new.assigned_label), '');

  if new.assigned_type = 'site' then
    select name into new.assigned_label from public.locations where id = new.assigned_id and account_id = new.account_id;
  elsif new.assigned_type = 'area' then
    select name into new.assigned_label from public.it_site_areas
     where id = new.assigned_id and account_id = new.account_id and location_id = a.location_id and deleted_at is null;
    if new.assigned_label is null then
      raise exception 'That area isn''t at this item''s site';
    end if;
  elsif new.assigned_type = 'user' then
    if new.assigned_label is null then
      select btrim(e.first_name || ' ' || coalesce(e.last_name, '')) into new.assigned_label
        from public.employees e join public.locations l on l.id = e.location_id
       where e.id = new.assigned_id and l.account_id = new.account_id;
    end if;
  elsif new.assigned_type = 'asset' then
    if new.assigned_id = new.asset_id then
      raise exception 'An item can''t be checked out to itself';
    end if;
    select x.asset_tag || ' ' || x.name into new.assigned_label from public.it_assets x
     where x.id = new.assigned_id and x.account_id = new.account_id and x.deleted_at is null;
  end if;
  if new.assigned_label is null then
    raise exception 'Unknown check-out target';
  end if;
  return new;
end $$;

drop function if exists public.it_check_out(uuid[], text, uuid, timestamptz, text, text);

create or replace function public.it_check_out(
  p_asset_ids uuid[], p_type text, p_target uuid,
  p_expected timestamptz default null, p_note text default null, p_signature text default null,
  p_assigned_label text default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  aid     uuid;
  new_id  uuid;
  results jsonb := '[]'::jsonb;
begin
  foreach aid in array p_asset_ids loop
    begin
      insert into public.it_assignments
        (account_id, location_id, asset_id, assigned_type, assigned_id, assigned_label,
         expected_return_at, note, signature_path)
      select a.account_id, a.location_id, a.id, p_type, p_target, nullif(btrim(p_assigned_label), ''),
             p_expected, nullif(btrim(p_note), ''), p_signature
        from public.it_assets a where a.id = aid
      returning id into new_id;
      if new_id is null then
        raise exception 'Not found, or not at a site you manage';
      end if;
      results := results || jsonb_build_object('asset_id', aid, 'ok', true, 'assignment_id', new_id);
    exception
      when unique_violation then
        results := results || jsonb_build_object('asset_id', aid, 'ok', false, 'error', 'Already checked out. Check it in first.');
      when others then
        results := results || jsonb_build_object('asset_id', aid, 'ok', false, 'error', sqlerrm);
    end;
    new_id := null;
  end loop;
  return results;
end $$;
