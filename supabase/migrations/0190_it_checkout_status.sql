-- IT Inventory slice D (2026-10-30): check-out and check-in, status changes
-- with a note, moves and retiring, one item or many at a time.
--
-- The bulk functions run as the caller (security invoker), so RLS and the
-- existing triggers decide what's allowed exactly as for single edits. Each
-- item succeeds or fails on its own and the result says which and why, so one
-- broken tablet doesn't stop the other nine from being checked out.

-- ---- Activity log: notes, and photos on their asset's Timeline ----------------
-- A note set for the transaction (`it.note`, by the functions below) is kept on
-- the asset's log row. Attachment rows about an asset now carry its asset_id.

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

-- ---- Check-out rules: an area must be at the item's own site --------------------

create or replace function public.it_assignments_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a   public.it_assets%rowtype;
  st  public.it_status_labels%rowtype;
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
    select btrim(e.first_name || ' ' || coalesce(e.last_name, '')) into new.assigned_label
      from public.employees e join public.locations l on l.id = e.location_id
     where e.id = new.assigned_id and l.account_id = new.account_id;
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

-- ---- Bulk operations ------------------------------------------------------------------
-- Each returns [{ asset_id, ok, error }] in the order given.

-- Change status, with an optional note on the log. Retiring (an archived
-- status) checks the item in first, since a retired item can't be out.
create or replace function public.it_set_status(p_asset_ids uuid[], p_status_id uuid, p_note text default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  st      public.it_status_labels%rowtype;
  aid     uuid;
  n       integer;
  results jsonb := '[]'::jsonb;
begin
  select * into st from public.it_status_labels
   where id = p_status_id and account_id = auth_account_id() and deleted_at is null;
  if not found then
    raise exception 'Unknown status';
  end if;
  perform set_config('it.note', coalesce(p_note, ''), true);
  foreach aid in array p_asset_ids loop
    begin
      if st.type = 'archived' then
        update public.it_assignments set checked_in_at = now(), checkin_note = coalesce(nullif(btrim(p_note), ''), 'Retired')
         where asset_id = aid and checked_in_at is null;
      end if;
      update public.it_assets set status_label_id = p_status_id where id = aid and deleted_at is null;
      get diagnostics n = row_count;
      results := results || jsonb_build_object('asset_id', aid, 'ok', n = 1,
        'error', case when n = 0 then 'Not found, or not at a site you manage' end);
    exception when others then
      results := results || jsonb_build_object('asset_id', aid, 'ok', false, 'error', sqlerrm);
    end;
  end loop;
  return results;
end $$;

-- Check out to a site area, a person (employees.id), another device, or
-- another site. Items that aren't deployable or are already out fail alone.
create or replace function public.it_check_out(
  p_asset_ids uuid[], p_type text, p_target uuid,
  p_expected timestamptz default null, p_note text default null, p_signature text default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  aid     uuid;
  new_id  uuid;
  results jsonb := '[]'::jsonb;
begin
  foreach aid in array p_asset_ids loop
    begin
      insert into public.it_assignments
        (account_id, location_id, asset_id, assigned_type, assigned_id, expected_return_at, note, signature_path)
      select a.account_id, a.location_id, a.id, p_type, p_target, p_expected, nullif(btrim(p_note), ''), p_signature
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

-- Check in, optionally setting the status it comes back in (Spare, Broken...).
create or replace function public.it_check_in(p_asset_ids uuid[], p_status_id uuid default null, p_note text default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  aid     uuid;
  n       integer;
  results jsonb := '[]'::jsonb;
begin
  perform set_config('it.note', coalesce(p_note, ''), true);
  foreach aid in array p_asset_ids loop
    begin
      update public.it_assignments set checked_in_at = now(), checkin_note = nullif(btrim(p_note), '')
       where asset_id = aid and checked_in_at is null;
      get diagnostics n = row_count;
      if n = 0 then
        raise exception 'It isn''t checked out';
      end if;
      if p_status_id is not null then
        update public.it_assets set status_label_id = p_status_id where id = aid;
      end if;
      results := results || jsonb_build_object('asset_id', aid, 'ok', true);
    exception when others then
      results := results || jsonb_build_object('asset_id', aid, 'ok', false, 'error', sqlerrm);
    end;
  end loop;
  return results;
end $$;

-- Move to another site and/or area. Checked-out items stay put until they're
-- checked in, so a move never strands a check-out at the old site.
create or replace function public.it_move(p_asset_ids uuid[], p_location uuid, p_area uuid default null, p_note text default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  aid     uuid;
  n       integer;
  who     text;
  results jsonb := '[]'::jsonb;
begin
  perform set_config('it.note', coalesce(p_note, ''), true);
  foreach aid in array p_asset_ids loop
    begin
      select assigned_label into who from public.it_assignments where asset_id = aid and checked_in_at is null;
      if who is not null then
        raise exception 'Checked out to %. Check it in first.', who;
      end if;
      update public.it_assets set location_id = p_location, area_id = p_area where id = aid and deleted_at is null;
      get diagnostics n = row_count;
      if n = 0 then
        raise exception 'Not found, or not at a site you manage';
      end if;
      results := results || jsonb_build_object('asset_id', aid, 'ok', true);
    exception when others then
      results := results || jsonb_build_object('asset_id', aid, 'ok', false, 'error', sqlerrm);
    end;
    who := null;
  end loop;
  return results;
end $$;

revoke execute on function public.it_set_status(uuid[], uuid, text), public.it_check_out(uuid[], text, uuid, timestamptz, text, text),
  public.it_check_in(uuid[], uuid, text), public.it_move(uuid[], uuid, uuid, text) from public, anon;
grant execute on function public.it_set_status(uuid[], uuid, text), public.it_check_out(uuid[], text, uuid, timestamptz, text, text),
  public.it_check_in(uuid[], uuid, text), public.it_move(uuid[], uuid, uuid, text) to authenticated, service_role;
