-- IT Inventory: equipment can be assigned to a typed name as well as someone on
-- the site roster. A typed name gets a random assigned_id (the column is required
-- and nothing looks a person up by it); assigned_label is what everyone sees.

create or replace function public.it_assignments_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a         public.it_assets%rowtype;
  st        public.it_status_labels%rowtype;
  on_roster text;
begin
  if auth.uid() is not null and new.account_id is distinct from auth_account_id() then
    raise exception 'new row violates row-level security policy for table "it_assignments"' using errcode = '42501';
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

  if new.assigned_type = 'site' then
    select name into new.assigned_label from public.locations where id = new.assigned_id and account_id = new.account_id;
  elsif new.assigned_type = 'area' then
    select name into new.assigned_label from public.it_site_areas
     where id = new.assigned_id and account_id = new.account_id and deleted_at is null
       and location_id = a.location_id;
    if new.assigned_label is null then
      raise exception 'That area isn''t at this item''s site';
    end if;
  elsif new.assigned_type = 'user' then
    -- Someone on the roster always shows their roster name. Anyone else shows
    -- the name as typed.
    select btrim(e.first_name || ' ' || coalesce(e.last_name, '')) into on_roster
      from public.employees e join public.locations l on l.id = e.location_id
     where e.id = new.assigned_id and l.account_id = new.account_id;
    new.assigned_label := coalesce(on_roster, left(nullif(btrim(new.assigned_label), ''), 200));
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
      select a.account_id, a.location_id, a.id, p_type, p_target, p_assigned_label,
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

-- A recreated function starts out open to everyone, so this has to be restated.
revoke execute on function public.it_check_out(uuid[], text, uuid, timestamptz, text, text, text) from public, anon;
grant execute on function public.it_check_out(uuid[], text, uuid, timestamptz, text, text, text) to authenticated, service_role;

-- The Timeline says who a check-out went to from the log row, but the row's name
-- was being skipped along with the asset's assigned_* columns (those change on
-- every check-out and would be noise), so every entry read "to someone".
create or replace function public.it_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ent     text := tg_argv[0];
  r_new   jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r_old   jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  rec     jsonb;
  skip    text[] := array['updated_at', 'created_at', 'created_by', 'last_seen_at', 'warranty_end_manual',
                          'assigned_type', 'assigned_id', 'assigned_label', 'printed_count', 'last_printed_at'];
  b       jsonb := '{}'::jsonb;
  a       jsonb := '{}'::jsonb;
  k       text;
  act     text;
  forced  text := nullif(current_setting('it.action', true), '');
  v_note  text := nullif(current_setting('it.note', true), '');
  uid     uuid := auth.uid();
  nm      text;
  v_asset uuid;
begin
  rec := coalesce(r_new, r_old);
  if rec ->> 'account_id' is null then
    return null; -- system rows (shared label templates) belong to no account
  end if;

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(r_new) loop
      if not (k = any (skip)) and (r_new -> k) is distinct from (r_old -> k) then
        b := b || jsonb_build_object(k, r_old -> k);
        a := a || jsonb_build_object(k, r_new -> k);
      end if;
    end loop;
    if a = '{}'::jsonb then
      return null;
    end if;
  end if;

  if ent = 'tag' then
    -- Only tag status moves are history; the asset row covers the rest.
    if tg_op <> 'UPDATE' or not (a ? 'status') then
      return null;
    end if;
    act := case r_new ->> 'status' when 'applied' then 'tag_applied' when 'retired' then 'tag_retired' else 'updated' end;
  elsif tg_op = 'INSERT' then
    act := case ent
      when 'assignment' then 'checked_out'
      when 'maintenance' then 'maintenance_logged'
      else coalesce(forced, 'created') end;
    a := jsonb_strip_nulls(r_new) - skip;
    if ent = 'assignment' then
      a := a || jsonb_build_object('assigned_label', r_new -> 'assigned_label');
    end if;
    b := null;
  elsif tg_op = 'DELETE' then
    act := 'deleted';
    b := jsonb_strip_nulls(r_old) - skip;
    a := null;
  elsif ent = 'assignment' and (r_old ->> 'checked_in_at') is null and (r_new ->> 'checked_in_at') is not null then
    act := 'checked_in';
  elsif (r_old ->> 'deleted_at') is null and (r_new ->> 'deleted_at') is not null then
    act := 'deleted';
  elsif ent = 'asset' and a ? 'status_label_id' then
    act := 'status_changed';
  elsif ent = 'asset' and a ? 'health_state' then
    act := 'health_changed';
  else
    act := coalesce(forced, 'updated');
  end if;

  if v_note is not null and ent = 'asset' and a is not null then
    a := a || jsonb_build_object('note', v_note);
  end if;

  v_asset := case
    when ent = 'asset' then (rec ->> 'id')::uuid
    when ent = 'attachment' and rec ->> 'entity_type' = 'asset' then (rec ->> 'entity_id')::uuid
    else (rec ->> 'asset_id')::uuid
  end;
  if uid is not null then
    select name into nm from public.users where id = uid;
  end if;

  insert into public.it_activity_log
    (account_id, location_id, asset_id, entity_type, entity_id, action, actor_user_id, actor_name, actor_system, before, after)
  values
    ((rec ->> 'account_id')::uuid, (rec ->> 'location_id')::uuid, v_asset, ent, (rec ->> 'id')::uuid, act,
     uid, nm, case when uid is null then coalesce(nullif(current_setting('it.actor_system', true), ''), 'system') end,
     b, a);
  return null;
end $$;
