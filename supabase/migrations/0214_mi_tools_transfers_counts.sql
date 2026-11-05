-- Maintenance Inventory: tool custody, stock transfers and cycle counts.

-- ---- Tools ----------------------------------------------------------------------
-- Who may touch a tool: whoever holds it, or anyone who can work its home or current
-- location.
create or replace function public.mi__tool_for_update(p_tool uuid) returns public.mi_tools
language plpgsql security definer set search_path = public as $$
declare
  t public.mi_tools;
begin
  select * into t from public.mi_tools where id = p_tool and account_id = public.mi__account() for update;
  if not found then raise exception 'Tool not found.'; end if;
  if not (t.custodian_user_id = auth.uid() or t.pending_to_user_id = auth.uid() or public.mi_can_act_at(t.home_location_id)
          or (t.custodian_location_id is not null and public.mi_can_act_at(t.custodian_location_id))) then
    raise exception 'That tool isn''t at one of your locations.' using errcode = '42501';
  end if;
  return t;
end;
$$;

create or replace function public.mi__tool_event(
  t public.mi_tools, p_action text, p_from_user uuid, p_from_loc uuid, p_to_user uuid, p_to_loc uuid,
  p_condition text default null, p_due timestamptz default null, p_notes text default null, p_source text default 'mobile', p_txn text default null
) returns void
language sql security definer set search_path = public as $$
  insert into public.mi_tool_checkouts (account_id, tool_id, action, from_user_id, from_location_id, to_user_id, to_location_id, condition, status, due_at, notes, performed_by, source, client_txn_id)
  values (t.account_id, t.id, p_action, p_from_user, p_from_loc, p_to_user, p_to_loc, p_condition, t.status, p_due, p_notes, auth.uid(), p_source, nullif(p_txn, ''))
$$;

create or replace function public.mi_save_tool(p jsonb) returns public.mi_tools
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  rec public.mi_tools;
  tid uuid := nullif(p ->> 'id', '')::uuid;
  home uuid := nullif(p ->> 'home_location_id', '')::uuid;
begin
  if coalesce(trim(p ->> 'name'), '') = '' then raise exception 'A tool needs a name.'; end if;
  if home is null then raise exception 'Pick the tool''s home location.'; end if;
  perform public.mi__require_manage(home, 'add or edit tools');
  if tid is null then
    insert into public.mi_tools (account_id, name, category, make, model, serial_number, cost, home_location_id, custodian_location_id, notes, created_by)
    values (acct, trim(p ->> 'name'), p ->> 'category', p ->> 'make', p ->> 'model', p ->> 'serial_number', nullif(p ->> 'cost', '')::numeric, home, home, p ->> 'notes', auth.uid())
    returning * into rec;
    perform public.mi__tool_event(rec, 'created', null, null, null, home, 'good', null, null, 'web');
  else
    update public.mi_tools set name = trim(p ->> 'name'), category = p ->> 'category', make = p ->> 'make', model = p ->> 'model',
      serial_number = p ->> 'serial_number', cost = nullif(p ->> 'cost', '')::numeric, home_location_id = home, notes = p ->> 'notes'
    where id = tid and account_id = acct returning * into rec;
    if not found then raise exception 'Tool not found.'; end if;
  end if;
  return rec;
end;
$$;

-- Custodian defaults to the caller. p_to_location checks it out to a truck or crib.
create or replace function public.mi_checkout_tool(
  p_tool uuid, p_to_user uuid default null, p_to_location uuid default null, p_due timestamptz default null,
  p_source text default 'mobile', p_client_txn_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  prior jsonb;
  t public.mi_tools;
  to_user uuid;
begin
  prior := public.mi__idem_start(acct, p_client_txn_id);
  if prior is not null then return prior; end if;
  t := public.mi__tool_for_update(p_tool);
  if t.status in ('lost', 'retired') then raise exception 'That tool is marked %.', t.status; end if;
  if t.status = 'in_repair' then raise exception 'That tool is in repair. Return it to service first.'; end if;
  if t.status = 'checked_out' and t.custodian_user_id is distinct from auth.uid() then
    raise exception 'That tool is already checked out. Ask for a transfer instead.';
  end if;
  to_user := case when p_to_location is null then coalesce(p_to_user, auth.uid()) end;
  if to_user is not null and not exists (select 1 from public.users where id = to_user and account_id = acct) then raise exception 'Person not found.'; end if;
  if p_to_location is not null and not exists (select 1 from public.mi_stock_locations where id = p_to_location and account_id = acct) then raise exception 'Location not found.'; end if;
  update public.mi_tools set status = 'checked_out', custodian_user_id = to_user, custodian_location_id = p_to_location, due_at = p_due, checked_out_at = now(),
    pending_to_user_id = null, pending_to_location_id = null, pending_from_user_id = null, pending_at = null
  where id = t.id returning * into t;
  perform public.mi__tool_event(t, 'check_out', null, t.home_location_id, to_user, p_to_location, t.condition, p_due, null, coalesce(p_source, 'mobile'), p_client_txn_id);
  return public.mi__idem_finish(acct, p_client_txn_id, jsonb_build_object('ok', true, 'status', t.status, 'custodian_user_id', t.custodian_user_id, 'custodian_location_id', t.custodian_location_id));
end;
$$;

create or replace function public.mi_return_tool(
  p_tool uuid, p_condition text default 'good', p_location uuid default null, p_notes text default null,
  p_source text default 'mobile', p_client_txn_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  prior jsonb;
  t public.mi_tools;
  from_user uuid;
  from_loc uuid;
  back_to uuid;
begin
  prior := public.mi__idem_start(acct, p_client_txn_id);
  if prior is not null then return prior; end if;
  t := public.mi__tool_for_update(p_tool);
  if p_condition not in ('good', 'needs_repair', 'damaged', 'missing_parts') then raise exception 'Pick the tool''s condition.'; end if;
  from_user := t.custodian_user_id;
  from_loc := t.custodian_location_id;
  back_to := coalesce(p_location, t.home_location_id);
  update public.mi_tools set
    status = case when p_condition = 'good' then 'available' else 'in_repair' end,
    condition = p_condition, custodian_user_id = null, custodian_location_id = back_to, due_at = null,
    pending_to_user_id = null, pending_to_location_id = null, pending_from_user_id = null, pending_at = null
  where id = t.id returning * into t;
  perform public.mi__tool_event(t, 'return', from_user, from_loc, null, back_to, p_condition, null, p_notes, coalesce(p_source, 'mobile'), p_client_txn_id);
  return public.mi__idem_finish(acct, p_client_txn_id, jsonb_build_object('ok', true, 'status', t.status, 'condition', t.condition));
end;
$$;

-- Two-sided: nothing moves until the receiver accepts.
create or replace function public.mi_start_tool_transfer(
  p_tool uuid, p_to_user uuid default null, p_to_location uuid default null, p_notes text default null,
  p_source text default 'mobile', p_client_txn_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  prior jsonb;
  t public.mi_tools;
  who text;
begin
  prior := public.mi__idem_start(acct, p_client_txn_id);
  if prior is not null then return prior; end if;
  t := public.mi__tool_for_update(p_tool);
  if (p_to_user is null) = (p_to_location is null) then raise exception 'Pick one person or one location to hand it to.'; end if;
  if p_to_user = t.custodian_user_id or p_to_location = t.custodian_location_id then raise exception 'They already have it.'; end if;
  if t.status in ('lost', 'retired') then raise exception 'That tool is marked %.', t.status; end if;
  update public.mi_tools set pending_to_user_id = p_to_user, pending_to_location_id = p_to_location, pending_from_user_id = auth.uid(), pending_at = now()
  where id = t.id returning * into t;
  perform public.mi__tool_event(t, 'transfer_start', t.custodian_user_id, t.custodian_location_id, p_to_user, p_to_location, null, null, p_notes, coalesce(p_source, 'mobile'), p_client_txn_id);
  if p_to_user is not null then
    select name into who from public.users where id = auth.uid();
    perform public.mi__raise_alert(acct, 'tool_transfer', 'tool_transfer:' || t.id || ':' || p_to_user,
      coalesce(who, 'Someone') || ' is handing you ' || t.name || '. Scan it to accept.', p_tool => t.id, p_target => p_to_user);
  end if;
  return public.mi__idem_finish(acct, p_client_txn_id, jsonb_build_object('ok', true, 'pending', true));
end;
$$;

create or replace function public.mi_accept_tool_transfer(p_tool uuid, p_source text default 'mobile', p_client_txn_id text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  prior jsonb;
  t public.mi_tools;
  from_user uuid;
  from_loc uuid;
begin
  prior := public.mi__idem_start(acct, p_client_txn_id);
  if prior is not null then return prior; end if;
  select * into t from public.mi_tools where id = p_tool and account_id = acct for update;
  if not found then raise exception 'Tool not found.'; end if;
  if t.pending_to_user_id is null and t.pending_to_location_id is null then raise exception 'No hand-off is waiting on this tool.'; end if;
  -- Only the receiver can accept: a person for themselves, a location for someone who works there.
  if not (t.pending_to_user_id = auth.uid() or (t.pending_to_location_id is not null and public.mi_can_act_at(t.pending_to_location_id))) then
    raise exception 'This hand-off is for someone else.' using errcode = '42501';
  end if;
  from_user := t.custodian_user_id;
  from_loc := t.custodian_location_id;
  update public.mi_tools set custodian_user_id = t.pending_to_user_id, custodian_location_id = t.pending_to_location_id,
    status = case when t.status = 'in_repair' then t.status else case when t.pending_to_user_id is not null then 'checked_out' else 'available' end end,
    checked_out_at = case when t.pending_to_user_id is not null then now() else checked_out_at end,
    pending_to_user_id = null, pending_to_location_id = null, pending_from_user_id = null, pending_at = null
  where id = t.id returning * into t;
  perform public.mi__tool_event(t, 'transfer_accept', from_user, from_loc, t.custodian_user_id, t.custodian_location_id, null, null, null, coalesce(p_source, 'mobile'), p_client_txn_id);
  return public.mi__idem_finish(acct, p_client_txn_id, jsonb_build_object('ok', true, 'status', t.status, 'custodian_user_id', t.custodian_user_id, 'custodian_location_id', t.custodian_location_id));
end;
$$;

create or replace function public.mi_cancel_tool_transfer(p_tool uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.mi_tools;
begin
  t := public.mi__tool_for_update(p_tool);
  if t.pending_to_user_id is null and t.pending_to_location_id is null then return; end if;
  perform public.mi__tool_event(t, 'transfer_cancel', t.custodian_user_id, t.custodian_location_id, t.pending_to_user_id, t.pending_to_location_id);
  update public.mi_tools set pending_to_user_id = null, pending_to_location_id = null, pending_from_user_id = null, pending_at = null where id = t.id;
end;
$$;

-- Report a problem, or a manager's status change (in repair, lost, retired, back in service).
create or replace function public.mi_report_tool_issue(p_tool uuid, p_condition text, p_notes text default null, p_source text default 'mobile')
returns public.mi_tools
language plpgsql security definer set search_path = public as $$
declare
  t public.mi_tools;
begin
  t := public.mi__tool_for_update(p_tool);
  update public.mi_tools set condition = p_condition, status = case when p_condition = 'good' then status else 'in_repair' end where id = t.id returning * into t;
  perform public.mi__tool_event(t, 'report_issue', t.custodian_user_id, t.custodian_location_id, t.custodian_user_id, t.custodian_location_id, p_condition, null, p_notes, coalesce(p_source, 'mobile'));
  return t;
end;
$$;

create or replace function public.mi_set_tool_status(p_tool uuid, p_status text, p_notes text default null) returns public.mi_tools
language plpgsql security definer set search_path = public as $$
declare
  t public.mi_tools;
begin
  t := public.mi__tool_for_update(p_tool);
  perform public.mi__require_manage(t.home_location_id, 'change a tool''s status');
  if p_status not in ('available', 'in_repair', 'lost', 'retired') then raise exception 'Pick a status.'; end if;
  update public.mi_tools set status = p_status,
    condition = case when p_status = 'available' then 'good' else condition end,
    custodian_user_id = case when p_status = 'available' then null else custodian_user_id end,
    custodian_location_id = case when p_status = 'available' then home_location_id else custodian_location_id end
  where id = t.id returning * into t;
  perform public.mi__tool_event(t, 'status', t.custodian_user_id, t.custodian_location_id, t.custodian_user_id, t.custodian_location_id, t.condition, null, p_notes, 'web');
  return t;
end;
$$;

-- Tool audits: list what should be at a truck or crib, scan what's there.
create or replace function public.mi_start_tool_audit(p_location uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  a uuid;
begin
  perform public.mi__require_act(p_location);
  insert into public.mi_tool_audits (account_id, location_id, created_by) values (acct, p_location, auth.uid()) returning id into a;
  insert into public.mi_tool_audit_lines (audit_id, tool_id)
  select a, t.id from public.mi_tools t
  where t.account_id = acct and t.custodian_location_id = p_location and t.status not in ('lost', 'retired');
  return a;
end;
$$;

create or replace function public.mi_tool_audit_scan(p_audit uuid, p_tool uuid, p_condition text default 'good') returns void
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  a public.mi_tool_audits;
begin
  select * into a from public.mi_tool_audits where id = p_audit and account_id = acct and status = 'open';
  if not found then raise exception 'That audit is closed.'; end if;
  perform public.mi__require_act(a.location_id);
  if not exists (select 1 from public.mi_tools where id = p_tool and account_id = acct) then raise exception 'Tool not found.'; end if;
  insert into public.mi_tool_audit_lines (audit_id, tool_id, found, condition, scanned_at) values (p_audit, p_tool, true, p_condition, now())
  on conflict (audit_id, tool_id) do update set found = true, condition = excluded.condition, scanned_at = now();
end;
$$;

-- Anything not scanned is marked lost, with a line in its history saying which audit.
create or replace function public.mi_finish_tool_audit(p_audit uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  a public.mi_tool_audits;
  t public.mi_tools;
  missing int := 0;
begin
  select * into a from public.mi_tool_audits where id = p_audit and account_id = acct and status = 'open' for update;
  if not found then raise exception 'That audit is closed.'; end if;
  perform public.mi__require_manage(a.location_id, 'finish a tool audit');
  for t in select tt.* from public.mi_tool_audit_lines l join public.mi_tools tt on tt.id = l.tool_id where l.audit_id = p_audit and l.found is not true loop
    update public.mi_tools set status = 'lost' where id = t.id returning * into t;
    perform public.mi__tool_event(t, 'audit', t.custodian_user_id, t.custodian_location_id, t.custodian_user_id, t.custodian_location_id, null, null, 'Not found in a tool audit.', 'web');
    missing := missing + 1;
  end loop;
  update public.mi_tool_audits set status = 'done', finished_at = now() where id = p_audit;
  return jsonb_build_object('ok', true, 'missing', missing);
end;
$$;

-- ---- Transfers ------------------------------------------------------------------
-- Same-site moves need a manager there. Between sites takes a regional manager who
-- covers both ends, or the director.
create or replace function public.mi__can_approve_transfer(p_from uuid, p_to uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  a public.mi_stock_locations;
  b public.mi_stock_locations;
  r integer := public.mi_rank();
begin
  if r >= 4 then return true; end if;
  select * into a from public.mi_stock_locations where id = p_from;
  select * into b from public.mi_stock_locations where id = p_to;
  if a.site_id is not null and a.site_id = b.site_id then return public.mi_can_manage_at(p_from); end if;
  return r = 3 and public.mi_can_act_at(p_from) and public.mi_can_act_at(p_to);
end;
$$;

create or replace function public.mi_start_transfer(
  p_from uuid, p_to uuid, p_lines jsonb, p_notes text default null, p_client_txn_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  prior jsonb;
  tid uuid;
  n bigint;
  line jsonb;
begin
  prior := public.mi__idem_start(acct, p_client_txn_id);
  if prior is not null then return prior; end if;
  -- Either end can ask: a site short on parts asks for them, a site with extra offers.
  if not (public.mi_can_act_at(p_from) or public.mi_can_act_at(p_to)) then
    raise exception 'One end of a transfer has to be one of your locations.' using errcode = '42501';
  end if;
  if p_from = p_to then raise exception 'Pick two different locations.'; end if;
  if not exists (select 1 from public.mi_stock_locations where id = p_from and account_id = acct)
     or not exists (select 1 from public.mi_stock_locations where id = p_to and account_id = acct) then
    raise exception 'Location not found.';
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'Add at least one part.'; end if;
  n := public.mi__next_number(acct, 'transfer');
  insert into public.mi_transfers (account_id, number, from_location_id, to_location_id, notes, requested_by)
  values (acct, n, p_from, p_to, p_notes, auth.uid()) returning id into tid;
  for line in select * from jsonb_array_elements(p_lines) loop
    if not exists (select 1 from public.parts where id = (line ->> 'part_id')::uuid and account_id = acct) then raise exception 'Part not found.'; end if;
    insert into public.mi_transfer_lines (transfer_id, part_id, qty_requested)
    values (tid, (line ->> 'part_id')::uuid, (line ->> 'qty')::numeric);
  end loop;
  return public.mi__idem_finish(acct, p_client_txn_id, jsonb_build_object('ok', true, 'transfer_id', tid, 'number', n));
end;
$$;

create or replace function public.mi_decide_transfer(p_transfer uuid, p_approve boolean) returns public.mi_transfers
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  t public.mi_transfers;
begin
  select * into t from public.mi_transfers where id = p_transfer and account_id = acct for update;
  if not found then raise exception 'Transfer not found.'; end if;
  if t.status <> 'requested' then raise exception 'That transfer has already been decided.'; end if;
  if not public.mi__can_approve_transfer(t.from_location_id, t.to_location_id) then
    raise exception 'Your role can''t approve this transfer.' using errcode = '42501';
  end if;
  update public.mi_transfers set status = case when p_approve then 'approved' else 'rejected' end, approved_by = auth.uid(), approved_at = now()
  where id = t.id returning * into t;
  return t;
end;
$$;

-- Ship: the stock leaves the source and is in neither location until it's received.
create or replace function public.mi_ship_transfer(p_transfer uuid, p_lines jsonb default null, p_source text default 'mobile', p_client_txn_id text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  prior jsonb;
  t public.mi_transfers;
  l public.mi_transfer_lines;
  qty numeric;
  rec public.mi_inventory_transactions;
  k integer := 0;
begin
  prior := public.mi__idem_start(acct, p_client_txn_id);
  if prior is not null then return prior; end if;
  select * into t from public.mi_transfers where id = p_transfer and account_id = acct for update;
  if not found then raise exception 'Transfer not found.'; end if;
  if t.status <> 'approved' then raise exception 'Only an approved transfer can ship.'; end if;
  perform public.mi__require_act(t.from_location_id);
  for l in select * from public.mi_transfer_lines where transfer_id = t.id loop
    qty := coalesce((select (x ->> 'qty')::numeric from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x where (x ->> 'line_id')::uuid = l.id), l.qty_requested);
    if qty > 0 then
      k := k + 1;
      rec := public.mi__post(acct, l.part_id, t.from_location_id, 'transfer_out', -qty, null, null, null, null, t.id, null, null, null,
        coalesce(p_source, 'mobile'), case when coalesce(p_client_txn_id, '') <> '' then p_client_txn_id || ':' || k end);
      update public.mi_transfer_lines set qty_shipped = qty, unit_cost = rec.unit_cost where id = l.id;
    end if;
  end loop;
  if k = 0 then raise exception 'Nothing to ship.'; end if;
  update public.mi_transfers set status = 'in_transit', shipped_by = auth.uid(), shipped_at = now() where id = t.id;
  return public.mi__idem_finish(acct, p_client_txn_id, jsonb_build_object('ok', true, 'status', 'in_transit'));
end;
$$;

-- Receive: what arrives goes on hand. Anything short is a recorded variance.
create or replace function public.mi_receive_transfer(p_transfer uuid, p_lines jsonb default null, p_notes text default null, p_source text default 'mobile', p_client_txn_id text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  prior jsonb;
  t public.mi_transfers;
  l public.mi_transfer_lines;
  qty numeric;
  k integer := 0;
  short numeric := 0;
  from_name text;
  to_name text;
begin
  prior := public.mi__idem_start(acct, p_client_txn_id);
  if prior is not null then return prior; end if;
  select * into t from public.mi_transfers where id = p_transfer and account_id = acct for update;
  if not found then raise exception 'Transfer not found.'; end if;
  if t.status <> 'in_transit' then raise exception 'That transfer isn''t in transit.'; end if;
  perform public.mi__require_act(t.to_location_id);
  for l in select * from public.mi_transfer_lines where transfer_id = t.id and qty_shipped > 0 loop
    qty := coalesce((select (x ->> 'qty')::numeric from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x where (x ->> 'line_id')::uuid = l.id), l.qty_shipped);
    if qty < 0 then raise exception 'Quantity can''t be negative.'; end if;
    if qty > 0 then
      k := k + 1;
      perform public.mi__post(acct, l.part_id, t.to_location_id, 'transfer_in', qty, l.unit_cost, null, null, null, t.id, null, null, null,
        coalesce(p_source, 'mobile'), case when coalesce(p_client_txn_id, '') <> '' then p_client_txn_id || ':' || k end, false, true);
    end if;
    update public.mi_transfer_lines set qty_received = qty,
      variance_qty = case when qty <> l.qty_shipped then qty - l.qty_shipped end,
      variance_notes = case when qty <> l.qty_shipped then p_notes end
    where id = l.id;
    short := short + abs(qty - l.qty_shipped);
  end loop;
  update public.mi_transfers set status = 'received', received_by = auth.uid(), received_at = now() where id = t.id;
  if short > 0 then
    select name into from_name from public.mi_stock_locations where id = t.from_location_id;
    select name into to_name from public.mi_stock_locations where id = t.to_location_id;
    perform public.mi__raise_alert(acct, 'transfer_variance', 'transfer_variance:' || t.id,
      'Transfer #' || t.number || ' from ' || from_name || ' to ' || to_name || ' arrived off by ' || trim_scale(short) || '.', p_location => t.to_location_id);
  end if;
  return public.mi__idem_finish(acct, p_client_txn_id, jsonb_build_object('ok', true, 'status', 'received', 'variance', short));
end;
$$;

create or replace function public.mi_cancel_transfer(p_transfer uuid) returns public.mi_transfers
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  t public.mi_transfers;
begin
  select * into t from public.mi_transfers where id = p_transfer and account_id = acct for update;
  if not found then raise exception 'Transfer not found.'; end if;
  if t.status not in ('requested', 'approved') then raise exception 'It has already shipped.'; end if;
  if not (t.requested_by = auth.uid() or public.mi__can_approve_transfer(t.from_location_id, t.to_location_id)) then
    raise exception 'Your role can''t cancel this transfer.' using errcode = '42501';
  end if;
  update public.mi_transfers set status = 'cancelled' where id = t.id returning * into t;
  return t;
end;
$$;

-- ---- Cycle counts ---------------------------------------------------------------
create or replace function public.mi__make_count(
  acct uuid, p_location uuid, p_scope_type text, p_scope_value text, p_blind boolean, p_due date, p_notes text, p_scheduled boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c uuid;
  n bigint;
  added integer;
begin
  n := public.mi__next_number(acct, 'count');
  insert into public.mi_cycle_counts (account_id, number, location_id, scope_type, scope_value, blind, due_date, notes, scheduled, created_by)
  values (acct, n, p_location, p_scope_type, p_scope_value, coalesce(p_blind, false), p_due, p_notes, p_scheduled, auth.uid()) returning id into c;
  insert into public.mi_cycle_count_lines (count_id, part_id, bin_id, expected_qty, unit_cost)
  select c, s.part_id, s.bin_id, s.on_hand, s.avg_cost
  from public.mi_stock_levels s join public.parts p on p.id = s.part_id
  where s.location_id = p_location and (
    p_scope_type = 'location'
    or (p_scope_type = 'critical' and p.is_critical)
    or (p_scope_type = 'abc' and p.abc_class = p_scope_value)
    or (p_scope_type = 'category' and p.category_id = nullif(p_scope_value, '')::uuid)
    or (p_scope_type = 'part' and p.id = nullif(p_scope_value, '')::uuid));
  get diagnostics added = row_count;
  if added = 0 then raise exception 'Nothing at this location matches that scope.'; end if;
  return jsonb_build_object('ok', true, 'count_id', c, 'number', n, 'lines', added);
end;
$$;

create or replace function public.mi_create_count(
  p_location uuid, p_scope_type text default 'location', p_scope_value text default null, p_blind boolean default false,
  p_due date default null, p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
begin
  perform public.mi__require_manage(p_location, 'create a count');
  return public.mi__make_count(acct, p_location, p_scope_type, p_scope_value, p_blind, p_due, p_notes, false);
end;
$$;

-- What the person counting sees. A blind count shows no expected quantity or variance
-- to anyone until it's turned in, and after that only to a manager reviewing it.
create or replace function public.mi_count_detail(p_count uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  c public.mi_cycle_counts;
  hide boolean;
begin
  select * into c from public.mi_cycle_counts where id = p_count and account_id = acct;
  if not found or not (c.location_id = any (public.mi_visible_location_ids())) then raise exception 'Count not found.'; end if;
  hide := c.blind and (c.status = 'open' or not public.mi_can_manage_at(c.location_id));
  return jsonb_build_object(
    'count', to_jsonb(c) || jsonb_build_object('location_name', (select name from public.mi_stock_locations where id = c.location_id)),
    'threshold', (select count_variance_threshold from public.mi_settings where account_id = acct),
    'lines', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'part_id', l.part_id, 'part_name', p.name, 'sku', p.sku, 'uom', p.uom, 'bin_id', l.bin_id, 'bin_name', b.name,
        'expected_qty', case when hide then null else l.expected_qty end,
        'variance_qty', case when hide then null else l.variance_qty end,
        'variance_value', case when hide then null else round(coalesce(l.variance_qty, 0) * l.unit_cost, 2) end,
        'unit_cost', case when hide then null else l.unit_cost end,
        'counted_qty', l.counted_qty, 'counted_at', l.counted_at, 'reason_code', l.reason_code, 'posted', l.posted
      ) order by b.name nulls last, p.name), '[]'::jsonb)
      from public.mi_cycle_count_lines l join public.parts p on p.id = l.part_id left join public.mi_bins b on b.id = l.bin_id
      where l.count_id = c.id));
end;
$$;

create or replace function public.mi_enter_count(p_line uuid, p_qty numeric, p_source text default 'mobile', p_client_txn_id text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  prior jsonb;
  c public.mi_cycle_counts;
begin
  prior := public.mi__idem_start(acct, p_client_txn_id);
  if prior is not null then return prior; end if;
  select cc.* into c from public.mi_cycle_count_lines l join public.mi_cycle_counts cc on cc.id = l.count_id
  where l.id = p_line and cc.account_id = acct;
  if not found then raise exception 'Count line not found.'; end if;
  if c.status <> 'open' then raise exception 'This count has been turned in.'; end if;
  perform public.mi__require_act(c.location_id);
  if coalesce(p_qty, -1) < 0 then raise exception 'Enter what you counted.'; end if;
  update public.mi_cycle_count_lines set counted_qty = p_qty, counted_by = auth.uid(), counted_at = now() where id = p_line;
  return public.mi__idem_finish(acct, p_client_txn_id, jsonb_build_object('ok', true));
end;
$$;

-- Turning a count in. Large variances raise an alert for the manager; the expected
-- quantities stay out of this result so a blind count stays blind for the tech.
create or replace function public.mi_submit_count(p_count uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  c public.mi_cycle_counts;
  threshold numeric;
  big integer;
  value numeric;
  loc text;
begin
  select * into c from public.mi_cycle_counts where id = p_count and account_id = acct for update;
  if not found then raise exception 'Count not found.'; end if;
  if c.status <> 'open' then raise exception 'This count has already been turned in.'; end if;
  perform public.mi__require_act(c.location_id);
  if exists (select 1 from public.mi_cycle_count_lines where count_id = c.id and counted_qty is null) then
    raise exception 'Some lines haven''t been counted.';
  end if;
  update public.mi_cycle_counts set status = 'in_review', submitted_by = auth.uid(), submitted_at = now() where id = c.id;
  select count_variance_threshold into threshold from public.mi_settings where account_id = acct;
  select count(*), coalesce(sum(abs(l.variance_qty * l.unit_cost)), 0) into big, value
  from public.mi_cycle_count_lines l where l.count_id = c.id and abs(coalesce(l.variance_qty, 0) * l.unit_cost) > coalesce(threshold, 0);
  if big > 0 then
    select name into loc from public.mi_stock_locations where id = c.location_id;
    perform public.mi__raise_alert(acct, 'count_variance', 'count_variance:' || c.id,
      'Count #' || c.number || ' at ' || loc || ' needs review: ' || big || ' line(s) off by $' || round(value, 2) || ' or more.', p_location => c.location_id, p_count => c.id);
  end if;
  return jsonb_build_object('ok', true, 'status', 'in_review', 'needs_review', big > 0);
end;
$$;

-- Post variances to stock. Lines over the $ threshold need a manager and a reason.
-- A tech can post a count that's within the threshold. Anything left stays in review.
create or replace function public.mi_post_count(p_count uuid, p_decisions jsonb default '[]'::jsonb, p_client_txn_id text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  prior jsonb;
  c public.mi_cycle_counts;
  threshold numeric;
  can_approve boolean;
  l public.mi_cycle_count_lines;
  reason text;
  val numeric;
  n_posted integer := 0;
  n_held integer := 0;
  k integer := 0;
begin
  prior := public.mi__idem_start(acct, p_client_txn_id);
  if prior is not null then return prior; end if;
  select * into c from public.mi_cycle_counts where id = p_count and account_id = acct for update;
  if not found then raise exception 'Count not found.'; end if;
  if c.status <> 'in_review' then raise exception 'Turn the count in first.'; end if;
  perform public.mi__require_act(c.location_id);
  can_approve := public.mi_can_manage_at(c.location_id);
  select count_variance_threshold into threshold from public.mi_settings where account_id = acct;

  for l in select * from public.mi_cycle_count_lines where count_id = c.id and not posted for update loop
    reason := (select x ->> 'reason_code' from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) x where (x ->> 'line_id')::uuid = l.id);
    val := abs(coalesce(l.variance_qty, 0) * l.unit_cost);
    if coalesce(l.variance_qty, 0) = 0 then
      update public.mi_cycle_count_lines set posted = true, approved_by = auth.uid() where id = l.id;
      update public.mi_stock_levels set last_counted_at = now() where part_id = l.part_id and location_id = c.location_id;
      n_posted := n_posted + 1;
      continue;
    end if;
    if val > coalesce(threshold, 0) and (not can_approve or coalesce(reason, '') = '') then
      n_held := n_held + 1;
      continue;
    end if;
    k := k + 1;
    -- Applied as a change, so anything issued since the count isn't undone.
    perform public.mi__post(acct, l.part_id, c.location_id, 'count_adjust', l.variance_qty, null, null, null, null, null, c.id, coalesce(reason, 'unknown'), null,
      'web', case when coalesce(p_client_txn_id, '') <> '' then p_client_txn_id || ':' || k end, true);
    update public.mi_cycle_count_lines set posted = true, reason_code = coalesce(reason, 'unknown'), approved_by = auth.uid() where id = l.id;
    n_posted := n_posted + 1;
  end loop;

  if n_held = 0 then
    update public.mi_cycle_counts set status = 'posted', posted_by = auth.uid(), posted_at = now() where id = c.id;
  end if;
  return public.mi__idem_finish(acct, p_client_txn_id, jsonb_build_object('ok', true, 'posted', n_posted, 'held', n_held, 'status', case when n_held = 0 then 'posted' else 'in_review' end));
end;
$$;

create or replace function public.mi_cancel_count(p_count uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  c public.mi_cycle_counts;
begin
  select * into c from public.mi_cycle_counts where id = p_count and account_id = acct for update;
  if not found then raise exception 'Count not found.'; end if;
  perform public.mi__require_manage(c.location_id, 'cancel a count');
  if c.status not in ('open', 'in_review') then raise exception 'That count is finished.'; end if;
  update public.mi_cycle_counts set status = 'cancelled' where id = c.id;
end;
$$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'mi\_%'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname like 'mi\_\_%' then
      execute format('revoke all on function %s from authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
