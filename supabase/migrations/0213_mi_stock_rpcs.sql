-- Maintenance Inventory: the stock functions. Every change to stock goes through
-- here: each one checks the caller's role, locks the stock row, writes the ledger and
-- updates stock in one transaction. Names starting mi__ are internal and can't be
-- called from the app.

create or replace function public.mi__account() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare a uuid;
begin
  select m.account_id into a from public.mi_members m where m.user_id = auth.uid();
  if a is null then raise exception 'You don''t have access to Maintenance Inventory.' using errcode = '42501'; end if;
  return a;
end;
$$;

create or replace function public.mi__require_rank(p_rank integer, p_what text default 'do that') returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if public.mi_rank() < p_rank then
    raise exception 'Your role can''t %.', p_what using errcode = '42501';
  end if;
end;
$$;

create or replace function public.mi__require_act(p_location uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.mi_can_act_at(p_location) then
    raise exception 'That location isn''t one of yours.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.mi__require_manage(p_location uuid, p_what text default 'do that') returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.mi_can_manage_at(p_location) then
    raise exception 'Your role can''t % here.', p_what using errcode = '42501';
  end if;
end;
$$;

-- Returns the earlier result when this action has already run, otherwise null. The
-- insert waits on a concurrent first attempt, so the same action can't run twice.
create or replace function public.mi__idem_start(p_account uuid, p_txn text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_txn, '') = '' then return null; end if;
  insert into public.mi_idempotency (account_id, client_txn_id, created_by)
  values (p_account, p_txn, auth.uid()) on conflict do nothing;
  if found then return null; end if;
  return coalesce((select i.result from public.mi_idempotency i where i.account_id = p_account and i.client_txn_id = p_txn), '{"ok": true}'::jsonb)
    || '{"deduped": true}'::jsonb;
end;
$$;

create or replace function public.mi__idem_finish(p_account uuid, p_txn text, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_txn, '') <> '' then
    update public.mi_idempotency set result = p_result where account_id = p_account and client_txn_id = p_txn;
  end if;
  return p_result;
end;
$$;

create or replace function public.mi__next_number(p_account uuid, p_kind text) returns bigint
language sql security definer set search_path = public as $$
  insert into public.it_tag_counters as c (account_id, prefix, last_value)
  values (p_account, 'MI-' || p_kind, 1)
  on conflict (account_id, prefix) do update set last_value = c.last_value + 1
  returning last_value
$$;

-- ---- Alerts ---------------------------------------------------------------------
create or replace function public.mi__raise_alert(
  p_account uuid, p_kind text, p_key text, p_message text, p_part uuid default null, p_location uuid default null,
  p_tool uuid default null, p_count uuid default null, p_target uuid default null, p_bypass boolean default false, p_detail jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- One alert per thing per day, however many times it happens.
  if exists (select 1 from public.mi_alerts a where a.account_id = p_account and a.dedupe_key = p_key and a.created_at > now() - interval '24 hours') then
    return;
  end if;
  insert into public.mi_alerts (account_id, kind, dedupe_key, message, part_id, location_id, tool_id, count_id, target_user_id, bypass_quiet, detail, status)
  values (p_account, p_kind, p_key, p_message, p_part, p_location, p_tool, p_count, p_target, p_bypass, p_detail,
          case when p_kind = 'low_stock' then 'digest' else 'pending' end);
end;
$$;

create or replace function public.mi__eval_stock(p_part uuid, p_location uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.mi_stock_levels;
  p public.parts;
  l public.mi_stock_locations;
  site text;
  where_at text;
begin
  select * into s from public.mi_stock_levels where part_id = p_part and location_id = p_location;
  if not found then return; end if;
  select * into p from public.parts where id = p_part;
  select * into l from public.mi_stock_locations where id = p_location;
  select name into site from public.locations where id = l.site_id;
  where_at := l.name || coalesce(' (' || site || ')', '');
  if p.is_critical then
    if s.on_hand <= 0 then
      perform public.mi__raise_alert(s.account_id, 'critical_zero', 'critical_zero:' || p_part || ':' || p_location,
        'OUT OF STOCK: ' || p.name || ' at ' || where_at || '. Critical spare.', p_part, p_location, p_bypass => true);
    elsif s.min_qty is not null and s.on_hand < s.min_qty then
      perform public.mi__raise_alert(s.account_id, 'critical_below_min', 'critical_below_min:' || p_part || ':' || p_location,
        'Low critical spare: ' || p.name || ' at ' || where_at || '. ' || trim_scale(s.on_hand) || ' on hand, min ' || trim_scale(s.min_qty) || '.', p_part, p_location);
    end if;
  elsif s.reorder_point is not null and s.available <= s.reorder_point then
    perform public.mi__raise_alert(s.account_id, 'low_stock', 'low_stock:' || p_part || ':' || p_location,
      p.name || ' at ' || where_at || ': ' || trim_scale(s.available) || ' available, reorder at ' || trim_scale(s.reorder_point) || '.', p_part, p_location);
  end if;
end;
$$;

-- ---- The one place stock changes ------------------------------------------------
-- Locks the row, checks the balance, writes the ledger. p_qty is the signed change to
-- on_hand. p_blend_cost folds incoming stock into the moving average.
create or replace function public.mi__post(
  p_account uuid, p_part uuid, p_location uuid, p_type text, p_qty numeric,
  p_unit_cost numeric default null, p_wo uuid default null, p_asset uuid default null, p_po_line uuid default null,
  p_transfer uuid default null, p_count uuid default null, p_reason text default null, p_notes text default null,
  p_source text default 'web', p_txn text default null, p_allow_negative boolean default false, p_blend_cost boolean default false,
  p_sample boolean default false
) returns public.mi_inventory_transactions
language plpgsql security definer set search_path = public as $$
declare
  s public.mi_stock_levels;
  after_qty numeric;
  cost numeric;
  avg_new numeric;
  rec public.mi_inventory_transactions;
begin
  insert into public.mi_stock_levels (account_id, part_id, location_id, is_sample)
  values (p_account, p_part, p_location, p_sample) on conflict (part_id, location_id) do nothing;
  select * into s from public.mi_stock_levels where part_id = p_part and location_id = p_location for update;

  after_qty := s.on_hand + p_qty;
  if after_qty < 0 and not p_allow_negative then
    raise exception 'Only % on hand.', trim_scale(s.on_hand) using errcode = 'P0001';
  end if;

  cost := coalesce(p_unit_cost, s.avg_cost);
  avg_new := s.avg_cost;
  if p_blend_cost and p_qty > 0 then
    avg_new := (greatest(s.on_hand, 0) * s.avg_cost + p_qty * cost) / (greatest(s.on_hand, 0) + p_qty);
  end if;

  update public.mi_stock_levels
  set on_hand = after_qty, avg_cost = round(avg_new, 4), last_moved_at = now(),
      last_counted_at = case when p_type = 'count_adjust' then now() else last_counted_at end
  where id = s.id;

  insert into public.mi_inventory_transactions (account_id, part_id, location_id, type, qty, qty_before, qty_after, unit_cost,
    work_order_id, asset_id, po_line_id, transfer_id, count_id, reason_code, notes, performed_by, source, client_txn_id, is_sample)
  values (p_account, p_part, p_location, p_type, p_qty, s.on_hand, after_qty, cost,
    p_wo, p_asset, p_po_line, p_transfer, p_count, p_reason, p_notes, auth.uid(), p_source, nullif(p_txn, ''), p_sample)
  returning * into rec;

  if p_qty < 0 then perform public.mi__eval_stock(p_part, p_location); end if;
  return rec;
end;
$$;

-- A reservation moves `reserved` only; on_hand stays, so qty_before = qty_after.
create or replace function public.mi__reserve(
  p_account uuid, p_part uuid, p_location uuid, p_delta numeric, p_wo uuid, p_source text, p_txn text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.mi_stock_levels;
begin
  insert into public.mi_stock_levels (account_id, part_id, location_id)
  values (p_account, p_part, p_location) on conflict (part_id, location_id) do nothing;
  select * into s from public.mi_stock_levels where part_id = p_part and location_id = p_location for update;
  update public.mi_stock_levels set reserved = greatest(0, reserved + p_delta) where id = s.id;
  insert into public.mi_inventory_transactions (account_id, part_id, location_id, type, qty, qty_before, qty_after, unit_cost, work_order_id, performed_by, source, client_txn_id)
  values (p_account, p_part, p_location, case when p_delta > 0 then 'reserve' else 'unreserve' end, p_delta, s.on_hand, s.on_hand, s.avg_cost, p_wo, auth.uid(), p_source, nullif(p_txn, ''));
  if p_delta > 0 then perform public.mi__eval_stock(p_part, p_location); end if;
end;
$$;

-- work_order_parts keeps the legacy `quantity` equal to net issued, so the existing
-- work-order screens show the same parts and cost.
create or replace function public.mi__wo_part(p_wo uuid, p_part uuid, p_location uuid) returns public.work_order_parts
language plpgsql security definer set search_path = public as $$
declare
  w public.work_order_parts;
begin
  select * into w from public.work_order_parts where work_order_id = p_wo and catalog_part_id = p_part for update;
  if not found then
    insert into public.work_order_parts (work_order_id, catalog_part_id, part_name, quantity, unit_cost, mi_location_id)
    select p_wo, p_part, p.name, 0, 0, p_location from public.parts p where p.id = p_part
    returning * into w;
  end if;
  return w;
end;
$$;

create or replace function public.mi__force_count(p_account uuid, p_part uuid, p_location uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c uuid;
  s public.mi_stock_levels;
begin
  if exists (select 1 from public.mi_cycle_counts cc join public.mi_cycle_count_lines cl on cl.count_id = cc.id
             where cc.location_id = p_location and cc.status = 'open' and cc.forced and cl.part_id = p_part) then
    return;
  end if;
  select * into s from public.mi_stock_levels where part_id = p_part and location_id = p_location;
  insert into public.mi_cycle_counts (account_id, number, location_id, scope_type, status, forced, due_date, notes)
  values (p_account, public.mi__next_number(p_account, 'count'), p_location, 'part', 'open', true, current_date,
          'Stock went below zero: count it to reconcile.')
  returning id into c;
  insert into public.mi_cycle_count_lines (count_id, part_id, bin_id, expected_qty, unit_cost)
  values (c, p_part, s.bin_id, s.on_hand, s.avg_cost);
end;
$$;

-- ---- Consume --------------------------------------------------------------------
create or replace function public.mi_issue_part(
  p_part uuid, p_location uuid, p_qty numeric, p_work_order uuid default null, p_asset uuid default null,
  p_source text default 'mobile', p_client_txn_id text default null, p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  prior jsonb;
  wo public.work_orders;
  wop public.work_order_parts;
  site uuid;
  allow_neg boolean := false;
  rec public.mi_inventory_transactions;
  s public.mi_stock_levels;
  to_unreserve numeric := 0;
  new_issued numeric;
  new_cost numeric;
begin
  prior := public.mi__idem_start(acct, p_client_txn_id);
  if prior is not null then return prior; end if;
  perform public.mi__require_act(p_location);
  if coalesce(p_qty, 0) <= 0 then raise exception 'Enter a quantity above zero.'; end if;

  select site_id into site from public.mi_stock_locations where id = p_location and account_id = acct;
  if not exists (select 1 from public.parts where id = p_part and account_id = acct) then raise exception 'Part not found.'; end if;
  if p_work_order is not null then
    select * into wo from public.work_orders where id = p_work_order and account_id = acct;
    if not found then raise exception 'Work order not found.'; end if;
    if wo.status in ('done', 'skipped') then raise exception 'Work order #% is closed.', wo.number; end if;
  end if;
  if p_asset is not null and not exists (select 1 from public.equipment where id = p_asset and account_id = acct) then
    raise exception 'Asset not found.';
  end if;

  select coalesce(ss.allow_negative, false) into allow_neg from public.mi_site_settings ss where ss.site_id = site;
  allow_neg := coalesce(allow_neg, false);

  -- This issue uses up what the work order had set aside here.
  if p_work_order is not null then
    wop := public.mi__wo_part(p_work_order, p_part, p_location);
    to_unreserve := least(greatest(wop.qty_planned - wop.qty_issued + wop.qty_returned, 0), p_qty);
    if to_unreserve > 0 and exists (select 1 from public.mi_stock_levels where part_id = p_part and location_id = p_location and reserved > 0) then
      perform public.mi__reserve(acct, p_part, p_location, -to_unreserve, p_work_order, coalesce(p_source, 'mobile'));
    end if;
  end if;

  rec := public.mi__post(acct, p_part, p_location, 'issue', -p_qty, null, p_work_order, coalesce(p_asset, wo.equipment_id), null, null, null, null,
    p_notes, coalesce(p_source, 'mobile'), p_client_txn_id, allow_neg);

  if p_work_order is not null then
    new_issued := wop.qty_issued + p_qty;
    new_cost := case when (new_issued - wop.qty_returned) > 0
      then round(((wop.qty_issued - wop.qty_returned) * coalesce(wop.unit_cost, 0) + p_qty * rec.unit_cost) / (new_issued - wop.qty_returned), 4)
      else rec.unit_cost end;
    update public.work_order_parts
    set qty_issued = new_issued, quantity = new_issued - qty_returned, unit_cost = new_cost, mi_location_id = coalesce(mi_location_id, p_location)
    where id = wop.id;
  end if;

  if rec.qty_after < 0 then perform public.mi__force_count(acct, p_part, p_location); end if;

  select * into s from public.mi_stock_levels where part_id = p_part and location_id = p_location;
  return public.mi__idem_finish(acct, p_client_txn_id, jsonb_build_object('ok', true, 'ledger_id', rec.id, 'on_hand', s.on_hand, 'available', s.available,
    'unit_cost', rec.unit_cost, 'line_cost', round(p_qty * rec.unit_cost, 2), 'work_order_id', p_work_order, 'asset_id', rec.asset_id, 'negative', rec.qty_after < 0));
end;
$$;

create or replace function public.mi_return_part(
  p_part uuid, p_location uuid, p_qty numeric, p_work_order uuid default null, p_asset uuid default null,
  p_source text default 'mobile', p_client_txn_id text default null, p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  prior jsonb;
  wop public.work_order_parts;
  cost numeric;
  rec public.mi_inventory_transactions;
  s public.mi_stock_levels;
begin
  prior := public.mi__idem_start(acct, p_client_txn_id);
  if prior is not null then return prior; end if;
  perform public.mi__require_act(p_location);
  if coalesce(p_qty, 0) <= 0 then raise exception 'Enter a quantity above zero.'; end if;

  if p_work_order is not null then
    if not exists (select 1 from public.work_orders where id = p_work_order and account_id = acct) then raise exception 'Work order not found.'; end if;
    select * into wop from public.work_order_parts where work_order_id = p_work_order and catalog_part_id = p_part for update;
    if not found or (wop.qty_issued - wop.qty_returned) < p_qty then
      raise exception 'Only % issued on this work order.', trim_scale(coalesce(wop.qty_issued - wop.qty_returned, 0));
    end if;
    cost := wop.unit_cost;
    update public.work_order_parts set qty_returned = qty_returned + p_qty, quantity = quantity - p_qty where id = wop.id;
  end if;

  rec := public.mi__post(acct, p_part, p_location, 'return', p_qty, cost, p_work_order, p_asset, null, null, null, null,
    p_notes, coalesce(p_source, 'mobile'), p_client_txn_id, false, true);
  select * into s from public.mi_stock_levels where part_id = p_part and location_id = p_location;
  return public.mi__idem_finish(acct, p_client_txn_id, jsonb_build_object('ok', true, 'ledger_id', rec.id, 'on_hand', s.on_hand, 'available', s.available));
end;
$$;

-- Plan parts on a work order: sets them aside so another job can't take them.
create or replace function public.mi_reserve_parts(
  p_work_order uuid, p_part uuid, p_location uuid, p_qty numeric, p_client_txn_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  prior jsonb;
  wop public.work_order_parts;
  s public.mi_stock_levels;
begin
  prior := public.mi__idem_start(acct, p_client_txn_id);
  if prior is not null then return prior; end if;
  perform public.mi__require_act(p_location);
  if not exists (select 1 from public.work_orders where id = p_work_order and account_id = acct) then raise exception 'Work order not found.'; end if;
  if not exists (select 1 from public.parts where id = p_part and account_id = acct) then raise exception 'Part not found.'; end if;
  if coalesce(p_qty, 0) = 0 then raise exception 'Enter a quantity.'; end if;

  wop := public.mi__wo_part(p_work_order, p_part, p_location);
  if wop.qty_planned + p_qty < 0 then raise exception 'Only % planned.', trim_scale(wop.qty_planned); end if;
  select * into s from public.mi_stock_levels where part_id = p_part and location_id = p_location;
  if p_qty > 0 and coalesce(s.available, 0) < p_qty then
    raise exception 'Only % available here. Request a transfer or order more.', trim_scale(coalesce(s.available, 0));
  end if;

  update public.work_order_parts set qty_planned = qty_planned + p_qty, mi_location_id = p_location where id = wop.id;
  perform public.mi__reserve(acct, p_part, p_location, p_qty, p_work_order, 'web', p_client_txn_id);
  select * into s from public.mi_stock_levels where part_id = p_part and location_id = p_location;
  return public.mi__idem_finish(acct, p_client_txn_id, jsonb_build_object('ok', true, 'reserved', s.reserved, 'available', s.available));
end;
$$;

-- Corrections and first stock-in. Managers only: techs count instead.
create or replace function public.mi_adjust_stock(
  p_part uuid, p_location uuid, p_delta numeric, p_reason text, p_unit_cost numeric default null,
  p_notes text default null, p_source text default 'web', p_client_txn_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  prior jsonb;
  rec public.mi_inventory_transactions;
  s public.mi_stock_levels;
begin
  prior := public.mi__idem_start(acct, p_client_txn_id);
  if prior is not null then return prior; end if;
  perform public.mi__require_manage(p_location, 'adjust stock');
  if coalesce(p_delta, 0) = 0 then raise exception 'Enter a change other than zero.'; end if;
  if coalesce(p_reason, '') = '' then raise exception 'Give a reason.'; end if;
  if not exists (select 1 from public.parts where id = p_part and account_id = acct) then raise exception 'Part not found.'; end if;
  rec := public.mi__post(acct, p_part, p_location, 'adjust', p_delta, p_unit_cost, null, null, null, null, null, p_reason,
    p_notes, coalesce(p_source, 'web'), p_client_txn_id, false, p_unit_cost is not null);
  select * into s from public.mi_stock_levels where part_id = p_part and location_id = p_location;
  return public.mi__idem_finish(acct, p_client_txn_id, jsonb_build_object('ok', true, 'on_hand', s.on_hand, 'avg_cost', s.avg_cost));
end;
$$;

-- Receiving without a purchase order (found stock, a local buy with a receipt).
create or replace function public.mi_receive_stock(
  p_part uuid, p_location uuid, p_qty numeric, p_unit_cost numeric, p_bin uuid default null,
  p_notes text default null, p_source text default 'mobile', p_client_txn_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  prior jsonb;
  rec public.mi_inventory_transactions;
  s public.mi_stock_levels;
begin
  prior := public.mi__idem_start(acct, p_client_txn_id);
  if prior is not null then return prior; end if;
  perform public.mi__require_act(p_location);
  if coalesce(p_qty, 0) <= 0 then raise exception 'Enter a quantity above zero.'; end if;
  if not exists (select 1 from public.parts where id = p_part and account_id = acct) then raise exception 'Part not found.'; end if;
  rec := public.mi__post(acct, p_part, p_location, 'receive', p_qty, p_unit_cost, null, null, null, null, null, null,
    p_notes, coalesce(p_source, 'mobile'), p_client_txn_id, false, true);
  if p_bin is not null then
    update public.mi_stock_levels set bin_id = p_bin where part_id = p_part and location_id = p_location;
  end if;
  select * into s from public.mi_stock_levels where part_id = p_part and location_id = p_location;
  return public.mi__idem_finish(acct, p_client_txn_id, jsonb_build_object('ok', true, 'on_hand', s.on_hand, 'avg_cost', s.avg_cost));
end;
$$;

-- Min, max, reorder point and bin for a part at a location. Doesn't touch quantities.
create or replace function public.mi_set_stock_params(
  p_part uuid, p_location uuid, p_bin uuid default null, p_min numeric default null, p_max numeric default null, p_reorder numeric default null
) returns public.mi_stock_levels
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  s public.mi_stock_levels;
begin
  perform public.mi__require_manage(p_location, 'edit min and max');
  if not exists (select 1 from public.parts where id = p_part and account_id = acct) then raise exception 'Part not found.'; end if;
  if p_min is not null and p_max is not null and p_max < p_min then raise exception 'Max can''t be below min.'; end if;
  insert into public.mi_stock_levels (account_id, part_id, location_id, bin_id, min_qty, max_qty, reorder_point)
  values (acct, p_part, p_location, p_bin, p_min, p_max, coalesce(p_reorder, p_min))
  on conflict (part_id, location_id) do update
    set bin_id = excluded.bin_id, min_qty = excluded.min_qty, max_qty = excluded.max_qty, reorder_point = excluded.reorder_point
  returning * into s;
  perform public.mi__eval_stock(p_part, p_location);
  return s;
end;
$$;

-- ---- Catalog --------------------------------------------------------------------
-- Exact matches block a save; similar names only warn.
create or replace function public.mi_check_part_duplicates(
  p_name text, p_manufacturer text default null, p_mpn text default null, p_barcode text default null, p_exclude uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  acct uuid := public.mi__account();
  exact jsonb;
  similar_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'sku', p.sku, 'match', m.match)), '[]'::jsonb) into exact
  from public.parts p,
  lateral (select case
    when coalesce(p_barcode, '') <> '' and p.barcode = p_barcode then 'barcode'
    when coalesce(p_mpn, '') <> '' and coalesce(p_manufacturer, '') <> '' and lower(p.manufacturer) = lower(p_manufacturer) and lower(p.mfr_part_number) = lower(p_mpn) then 'manufacturer part number'
  end as match) m
  where p.account_id = acct and m.match is not null and (p_exclude is null or p.id <> p_exclude);

  select coalesce(jsonb_agg(x), '[]'::jsonb) into similar_rows from (
    select jsonb_build_object('id', p.id, 'name', p.name, 'sku', p.sku, 'score', round(similarity(p.name, p_name)::numeric, 2)) as x
    from public.parts p
    where p.account_id = acct and coalesce(p_name, '') <> '' and p.name % p_name
      and (p_exclude is null or p.id <> p_exclude)
    order by similarity(p.name, p_name) desc limit 5
  ) q;

  return jsonb_build_object('exact', exact, 'similar', similar_rows);
end;
$$;

create or replace function public.mi_save_part(p jsonb) returns public.parts
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  rec public.parts;
  dup jsonb;
  pid uuid := nullif(p ->> 'id', '')::uuid;
begin
  perform public.mi__require_rank(4, 'edit the parts catalog');
  if coalesce(trim(p ->> 'name'), '') = '' then raise exception 'A part needs a name.'; end if;
  dup := public.mi_check_part_duplicates(p ->> 'name', p ->> 'manufacturer', p ->> 'mfr_part_number', p ->> 'barcode', pid);
  if jsonb_array_length(dup -> 'exact') > 0 then
    raise exception 'That % is already on "%".', dup -> 'exact' -> 0 ->> 'match', dup -> 'exact' -> 0 ->> 'name' using errcode = '23505';
  end if;
  if pid is null then
    insert into public.parts (account_id, name, description, sku, ordering_part_number, uom, lead_time_days, unit_cost, manufacturer, vendor_id, link_url,
      mfr_part_number, barcode, pack_qty, is_critical, abc_class, photo_path, spec, stale_days, category_id)
    values (acct, trim(p ->> 'name'), p ->> 'description', nullif(trim(p ->> 'sku'), ''), p ->> 'ordering_part_number', coalesce(nullif(p ->> 'uom', ''), 'ea'),
      nullif(p ->> 'lead_time_days', '')::int, nullif(p ->> 'unit_cost', '')::numeric, nullif(trim(p ->> 'manufacturer'), ''), nullif(p ->> 'vendor_id', '')::uuid, p ->> 'link_url',
      nullif(trim(p ->> 'mfr_part_number'), ''), nullif(trim(p ->> 'barcode'), ''), coalesce(nullif(p ->> 'pack_qty', '')::numeric, 1), coalesce((p ->> 'is_critical')::boolean, false),
      nullif(p ->> 'abc_class', ''), p ->> 'photo_path', coalesce(p -> 'spec', '{}'::jsonb), nullif(p ->> 'stale_days', '')::int, nullif(p ->> 'category_id', '')::uuid)
    returning * into rec;
  else
    update public.parts set
      name = trim(p ->> 'name'), description = p ->> 'description', sku = nullif(trim(p ->> 'sku'), ''), uom = coalesce(nullif(p ->> 'uom', ''), 'ea'),
      lead_time_days = nullif(p ->> 'lead_time_days', '')::int, unit_cost = nullif(p ->> 'unit_cost', '')::numeric, manufacturer = nullif(trim(p ->> 'manufacturer'), ''),
      mfr_part_number = nullif(trim(p ->> 'mfr_part_number'), ''), barcode = nullif(trim(p ->> 'barcode'), ''), pack_qty = coalesce(nullif(p ->> 'pack_qty', '')::numeric, 1),
      is_critical = coalesce((p ->> 'is_critical')::boolean, false), abc_class = nullif(p ->> 'abc_class', ''), photo_path = coalesce(p ->> 'photo_path', photo_path),
      spec = coalesce(p -> 'spec', spec), stale_days = nullif(p ->> 'stale_days', '')::int, category_id = nullif(p ->> 'category_id', '')::uuid
    where id = pid and account_id = acct
    returning * into rec;
    if not found then raise exception 'Part not found.'; end if;
  end if;
  return rec;
end;
$$;

-- Anyone in the module can propose a part; the director turns it into a real one.
create or replace function public.mi_request_part(p_name text, p_manufacturer text default null, p_mpn text default null, p_barcode text default null, p_notes text default null)
returns public.mi_part_requests
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  rec public.mi_part_requests;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'What is the part called?'; end if;
  insert into public.mi_part_requests (account_id, name, manufacturer, mfr_part_number, barcode, notes, requested_by)
  values (acct, trim(p_name), p_manufacturer, p_mpn, p_barcode, p_notes, auth.uid()) returning * into rec;
  return rec;
end;
$$;

create or replace function public.mi_decide_part_request(p_request uuid, p_approve boolean, p_part jsonb default null)
returns public.mi_part_requests
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  rec public.mi_part_requests;
  created public.parts;
begin
  perform public.mi__require_rank(4, 'approve part requests');
  select * into rec from public.mi_part_requests where id = p_request and account_id = acct and status = 'pending' for update;
  if not found then raise exception 'That request isn''t pending.'; end if;
  if p_approve then
    created := public.mi_save_part(coalesce(p_part, '{}'::jsonb) || jsonb_build_object(
      'name', coalesce(p_part ->> 'name', rec.name), 'manufacturer', coalesce(p_part ->> 'manufacturer', rec.manufacturer),
      'mfr_part_number', coalesce(p_part ->> 'mfr_part_number', rec.mfr_part_number), 'barcode', coalesce(p_part ->> 'barcode', rec.barcode)));
  end if;
  update public.mi_part_requests
  set status = case when p_approve then 'approved' else 'rejected' end, created_part_id = created.id, decided_by = auth.uid(), decided_at = now()
  where id = rec.id returning * into rec;
  return rec;
end;
$$;

-- BOM: what an asset takes, and how many.
create or replace function public.mi_set_bom_line(p_asset uuid, p_part uuid, p_qty numeric, p_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
begin
  perform public.mi__require_rank(2, 'edit a bill of materials');
  if not exists (select 1 from public.equipment e where e.id = p_asset and e.account_id = acct and e.location_id = any (public.auth_site_ids())) then
    raise exception 'Asset not found.';
  end if;
  if not exists (select 1 from public.parts where id = p_part and account_id = acct) then raise exception 'Part not found.'; end if;
  if coalesce(p_qty, 0) <= 0 then
    delete from public.part_assets where asset_id = p_asset and part_id = p_part;
  else
    insert into public.part_assets (part_id, asset_id, qty_per, notes) values (p_part, p_asset, p_qty, p_notes)
    on conflict (part_id, asset_id) do update set qty_per = excluded.qty_per, notes = excluded.notes;
  end if;
end;
$$;

create or replace function public.mi_update_asset(p_asset uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
begin
  perform public.mi__require_rank(2, 'edit assets');
  update public.equipment set
    area_id = case when p ? 'area_id' then nullif(p ->> 'area_id', '')::uuid else area_id end,
    vendor_id = case when p ? 'vendor_id' then nullif(p ->> 'vendor_id', '')::uuid else vendor_id end,
    install_date = case when p ? 'install_date' then nullif(p ->> 'install_date', '')::date else install_date end,
    warranty_expiry = case when p ? 'warranty_expiry' then nullif(p ->> 'warranty_expiry', '')::date else warranty_expiry end,
    crit_class = case when p ? 'crit_class' then nullif(p ->> 'crit_class', '') else crit_class end,
    manufacturer = case when p ? 'manufacturer' then p ->> 'manufacturer' else manufacturer end,
    model = case when p ? 'model' then p ->> 'model' else model end,
    serial_number = case when p ? 'serial_number' then p ->> 'serial_number' else serial_number end,
    status = case when p ? 'status' then p ->> 'status' else status end
  where id = p_asset and account_id = acct and location_id = any (public.auth_site_ids());
  if not found then raise exception 'Asset not found.'; end if;
end;
$$;

-- ---- Work orders ----------------------------------------------------------------
create or replace function public.mi_create_work_order(
  p_site uuid, p_title text, p_asset uuid default null, p_priority text default 'medium', p_description text default null, p_parts jsonb default null
) returns public.work_orders
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  who text;
  rec public.work_orders;
  line jsonb;
begin
  if not p_site = any (public.auth_site_ids()) then raise exception 'That site isn''t one of yours.' using errcode = '42501'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Give the work order a title.'; end if;
  select name into who from public.users where id = auth.uid();
  insert into public.work_orders (account_id, location_id, title, description, status, priority, work_type, equipment_id, created_by, created_by_name, requested_by, requested_by_name)
  values (acct, p_site, trim(p_title), p_description, 'open', coalesce(p_priority, 'medium'), 'reactive', p_asset, auth.uid(), who, auth.uid(), who)
  returning * into rec;
  -- Suggested parts go on as planned at zero reserved: someone still picks the location.
  for line in select * from jsonb_array_elements(coalesce(p_parts, '[]'::jsonb)) loop
    insert into public.work_order_parts (work_order_id, catalog_part_id, part_name, quantity, unit_cost, qty_planned)
    select rec.id, p.id, p.name, 0, p.unit_cost, 0 from public.parts p where p.id = (line ->> 'part_id')::uuid and p.account_id = acct;
  end loop;
  return rec;
end;
$$;

-- A failed checklist item opens a work order on its asset, with the BOM as suggestions.
create or replace function public.mi_work_order_from_checklist(p_instance uuid, p_item uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  inst public.checklist_instances;
  item public.checklist_items;
  rec public.work_orders;
  parts_list jsonb;
begin
  select * into inst from public.checklist_instances where id = p_instance;
  select * into item from public.checklist_items where id = p_item;
  if inst.id is null or item.id is null then raise exception 'Checklist item not found.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('part_id', pa.part_id, 'qty', pa.qty_per)), '[]'::jsonb) into parts_list
  from public.part_assets pa where pa.asset_id = item.asset_id;
  rec := public.mi_create_work_order(inst.location_id, 'Checklist failed: ' || item.label, item.asset_id, 'medium', p_note, parts_list);
  return jsonb_build_object('ok', true, 'work_order_id', rec.id, 'number', rec.number, 'suggested_parts', jsonb_array_length(parts_list));
end;
$$;

-- ---- Members and settings -------------------------------------------------------
create or replace function public.mi_set_member(p_user uuid, p_role text, p_site_ids uuid[] default '{}', p_region_names text[] default '{}')
returns public.mi_members
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  rec public.mi_members;
begin
  perform public.mi__require_rank(5, 'manage roles');
  if not exists (select 1 from public.users where id = p_user and account_id = acct) then raise exception 'User not found.'; end if;
  insert into public.mi_members (user_id, account_id, role, site_ids, region_names, created_by)
  values (p_user, acct, p_role, coalesce(p_site_ids, '{}'), coalesce(p_region_names, '{}'), auth.uid())
  on conflict (user_id) do update set role = excluded.role, site_ids = excluded.site_ids, region_names = excluded.region_names
  returning * into rec;
  return rec;
end;
$$;

create or replace function public.mi_remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
begin
  perform public.mi__require_rank(5, 'manage roles');
  if p_user = auth.uid() then raise exception 'You can''t remove yourself.'; end if;
  delete from public.mi_members where user_id = p_user and account_id = acct;
end;
$$;

-- Everyone's names, so a member can pick a tech without reading the users table's rules.
create or replace function public.mi_people()
returns table (id uuid, name text, email text, role text, site_ids uuid[], region_names text[], has_phone boolean)
language sql stable security definer set search_path = public as $$
  select u.id, u.name, case when public.mi_rank() >= 5 then u.email end, m.role, m.site_ids, m.region_names,
         (coalesce(u.phone, '') <> '' and coalesce(u.sms_opt_in, false))
  from public.mi_members m join public.users u on u.id = m.user_id
  where m.account_id = public.mi__account()
  order by u.name
$$;

-- Everyone on the account, so an admin can add a member.
create or replace function public.mi_account_users()
returns table (id uuid, name text, email text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.mi__require_rank(5, 'manage roles');
  return query select u.id, u.name, u.email from public.users u where u.account_id = public.mi__account() order by u.name;
end;
$$;

create or replace function public.mi_update_settings(p jsonb) returns public.mi_settings
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  rec public.mi_settings;
begin
  perform public.mi__require_rank(5, 'change settings');
  insert into public.mi_settings (account_id) values (acct) on conflict do nothing;
  update public.mi_settings set
    sms_enabled = coalesce((p ->> 'sms_enabled')::boolean, sms_enabled),
    quiet_start_hour = coalesce((p ->> 'quiet_start_hour')::int, quiet_start_hour),
    quiet_end_hour = coalesce((p ->> 'quiet_end_hour')::int, quiet_end_hour),
    count_variance_threshold = coalesce((p ->> 'count_variance_threshold')::numeric, count_variance_threshold),
    count_tolerance_pct = coalesce((p ->> 'count_tolerance_pct')::numeric, count_tolerance_pct),
    po_limits = coalesce(p -> 'po_limits', po_limits),
    stale_days = coalesce((p ->> 'stale_days')::int, stale_days),
    carrying_rate = coalesce((p ->> 'carrying_rate')::numeric, carrying_rate),
    auto_counts_enabled = coalesce((p ->> 'auto_counts_enabled')::boolean, auto_counts_enabled),
    count_schedule = coalesce(p -> 'count_schedule', count_schedule),
    high_value_photo_cost = case when p ? 'high_value_photo_cost' then nullif(p ->> 'high_value_photo_cost', '')::numeric else high_value_photo_cost end,
    updated_at = now()
  where account_id = acct returning * into rec;
  return rec;
end;
$$;

create or replace function public.mi_set_site_setting(p_site uuid, p_allow_negative boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
begin
  perform public.mi__require_rank(3, 'change site settings');
  if not p_site = any (public.auth_site_ids()) then raise exception 'That site isn''t one of yours.' using errcode = '42501'; end if;
  insert into public.mi_site_settings (site_id, account_id, allow_negative) values (p_site, acct, p_allow_negative)
  on conflict (site_id) do update set allow_negative = excluded.allow_negative;
end;
$$;

-- ---- Who am I -------------------------------------------------------------------
create or replace function public.mi_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m public.mi_members;
  st public.mi_settings;
begin
  select * into m from public.mi_members where user_id = auth.uid();
  if not found then return jsonb_build_object('member', false); end if;
  select * into st from public.mi_settings where account_id = m.account_id;
  return jsonb_build_object(
    'member', true, 'role', m.role, 'rank', public.mi_rank(), 'site_ids', public.auth_site_ids(), 'region_names', m.region_names,
    'my_regions', public.mi_my_regions(), 'settings', to_jsonb(st),
    'has_sample_data', exists (select 1 from public.mi_stock_locations l where l.account_id = m.account_id and l.is_sample));
end;
$$;

-- ---- Tags and scanning ----------------------------------------------------------
-- A tag's code, made the first time it's asked for. MF-B- bins, MF-T- tools, MF-A-
-- assets, MF-L- locations and trucks: same shape as IT tags, so the same stickers and
-- scanner read them.
create or replace function public.mi_ensure_tag(p_type text, p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  code text;
  prefix text;
  ok boolean;
begin
  select t.code into code from public.mi_tags t where t.entity_type = p_type and t.entity_id = p_id and t.account_id = acct;
  if code is not null then return code; end if;
  ok := case p_type
    when 'bin' then exists (select 1 from public.mi_bins where id = p_id and account_id = acct)
    when 'tool' then exists (select 1 from public.mi_tools where id = p_id and account_id = acct)
    when 'asset' then exists (select 1 from public.equipment where id = p_id and account_id = acct)
    when 'location' then exists (select 1 from public.mi_stock_locations where id = p_id and account_id = acct)
    else false end;
  if not ok then raise exception 'Nothing to tag.'; end if;
  prefix := case p_type when 'bin' then 'MF-B-' when 'tool' then 'MF-T-' when 'asset' then 'MF-A-' else 'MF-L-' end;
  code := prefix || lpad(public.mi__next_number(acct, prefix)::text, 5, '0');
  insert into public.mi_tags (account_id, code, entity_type, entity_id) values (acct, code, p_type, p_id);
  return code;
end;
$$;

create or replace function public.mi_mark_printed(p_codes text[]) returns void
language sql security definer set search_path = public as $$
  update public.mi_tags set printed_count = printed_count + 1, last_printed_at = now()
  where account_id = public.mi__account() and code = any (p_codes)
$$;

-- What's needed to print: the same label templates, short code and logo IT uses.
create or replace function public.mi_label_setup() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
begin
  return jsonb_build_object(
    'settings', (select jsonb_build_object('short_code', s.short_code, 'support_phone', s.support_phone, 'label_logo_path', s.label_logo_path, 'label_show_logo', s.label_show_logo)
                 from public.it_settings s where s.account_id = acct),
    'templates', (select coalesce(jsonb_agg(to_jsonb(t) order by t.is_default desc, t.sort_order), '[]'::jsonb)
                  from public.it_label_templates t where (t.account_id is null or t.account_id = acct) and t.deleted_at is null));
end;
$$;

-- Everything the action sheet needs for one scan, in one round trip. Tags first, then
-- what's printed on the part itself, then PO numbers.
create or replace function public.mi_resolve_scan(p_raw text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  v_code text := upper(trim(p_raw));
  tag public.mi_tags;
  part_id uuid;
  asset_id uuid;
  po uuid;
begin
  if v_code = '' then return jsonb_build_object('kind', 'unknown', 'raw', p_raw); end if;
  select * into tag from public.mi_tags t where t.account_id = acct and t.code = v_code;
  if found then
    if tag.entity_type = 'bin' then return public.mi__scan_bin(tag.entity_id, v_code); end if;
    if tag.entity_type = 'tool' then return jsonb_build_object('kind', 'tool', 'code', v_code, 'id', tag.entity_id); end if;
    if tag.entity_type = 'asset' then return jsonb_build_object('kind', 'asset', 'code', v_code, 'id', tag.entity_id); end if;
    return jsonb_build_object('kind', 'location', 'code', v_code, 'id', tag.entity_id);
  end if;

  select p.id into part_id from public.parts p
  where p.account_id = acct and (p.barcode = trim(p_raw) or upper(p.qr_code) = v_code or upper(p.mfr_part_number) = v_code or upper(p.sku) = v_code)
  order by p.barcode = trim(p_raw) desc nulls last limit 1;
  if part_id is null then
    select pv.part_id into part_id from public.mi_part_vendors pv where pv.account_id = acct and upper(pv.vendor_part_number) = v_code limit 1;
  end if;
  if part_id is not null then return public.mi__scan_part(part_id, v_code); end if;

  select e.id into asset_id from public.equipment e where e.account_id = acct and upper(e.qr_code) = v_code limit 1;
  if asset_id is not null then return jsonb_build_object('kind', 'asset', 'code', v_code, 'id', asset_id); end if;

  select o.id into po from public.mi_purchase_orders o
  where o.account_id = acct and v_code ~ '^PO-?[0-9]+$' and o.number = regexp_replace(v_code, '[^0-9]', '', 'g')::int;
  if po is not null then return jsonb_build_object('kind', 'po', 'code', v_code, 'id', po); end if;

  return jsonb_build_object('kind', 'unknown', 'raw', p_raw);
end;
$$;

create or replace function public.mi__stock_row(s public.mi_stock_levels) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'part_id', p.id, 'part_name', p.name, 'sku', p.sku, 'uom', p.uom, 'is_critical', p.is_critical, 'photo_path', p.photo_path,
    'location_id', s.location_id, 'location_name', l.name, 'site_id', l.site_id, 'site_name', loc.name, 'bin_id', s.bin_id, 'bin_name', b.name,
    'on_hand', s.on_hand, 'reserved', s.reserved, 'available', s.available, 'min_qty', s.min_qty, 'max_qty', s.max_qty, 'avg_cost', s.avg_cost,
    'can_act', public.mi_can_act_at(s.location_id))
  from public.parts p
  join public.mi_stock_locations l on l.id = s.location_id
  left join public.locations loc on loc.id = l.site_id
  left join public.mi_bins b on b.id = s.bin_id
  where p.id = s.part_id
$$;

create or replace function public.mi__scan_bin(p_bin uuid, p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  b public.mi_bins;
  l public.mi_stock_locations;
begin
  select * into b from public.mi_bins where id = p_bin;
  select * into l from public.mi_stock_locations where id = b.location_id;
  if not (l.id = any (public.mi_visible_location_ids())) then
    return jsonb_build_object('kind', 'other_site', 'code', p_code, 'message', 'That bin is at a location you can''t see.');
  end if;
  return jsonb_build_object('kind', 'bin', 'code', p_code, 'id', b.id, 'name', b.name, 'location_id', l.id, 'location_name', l.name,
    'site_id', l.site_id, 'can_act', public.mi_can_act_at(l.id),
    'stock', (select coalesce(jsonb_agg(public.mi__stock_row(s)), '[]'::jsonb) from public.mi_stock_levels s where s.bin_id = b.id));
end;
$$;

create or replace function public.mi__scan_part(p_part uuid, p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('kind', 'part', 'code', p_code, 'id', p.id, 'name', p.name,
    'stock', (select coalesce(jsonb_agg(public.mi__stock_row(s)), '[]'::jsonb) from public.mi_stock_levels s
              where s.part_id = p.id and s.location_id = any (public.mi_visible_location_ids())))
  from public.parts p where p.id = p_part
$$;

-- What to charge a consumption to: open work orders at this location's site, best
-- guess first (the asset that was scanned, then assets whose BOM has this part).
create or replace function public.mi_consume_context(p_part uuid, p_location uuid, p_asset uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  site uuid;
begin
  select site_id into site from public.mi_stock_locations where id = p_location and account_id = acct;
  return jsonb_build_object(
    'work_orders', (
      select coalesce(jsonb_agg(x order by x ->> 'rank', x ->> 'number'), '[]'::jsonb) from (
        select jsonb_build_object('id', w.id, 'number', w.number, 'title', w.title, 'equipment_id', w.equipment_id, 'asset_name', e.name,
          'rank', case when p_asset is not null and w.equipment_id = p_asset then 0
                       when exists (select 1 from public.work_order_parts wp where wp.work_order_id = w.id and wp.catalog_part_id = p_part and wp.qty_planned > wp.qty_issued) then 1
                       when exists (select 1 from public.part_assets pa where pa.asset_id = w.equipment_id and pa.part_id = p_part) then 2
                       else 3 end) as x
        from public.work_orders w left join public.equipment e on e.id = w.equipment_id
        where w.account_id = acct and w.location_id = site and w.status in ('open', 'in_progress', 'on_hold')
        order by w.created_at desc limit 40
      ) q),
    'assets', (
      select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'qty_per', pa.qty_per)), '[]'::jsonb)
      from public.part_assets pa join public.equipment e on e.id = pa.asset_id
      where pa.part_id = p_part and e.location_id = site),
    'elsewhere', public.mi_stock_elsewhere(p_part, p_location));
end;
$$;

-- Stock of a part at other locations, by quantity only, in the caller's regions: what a
-- tech needs to ask for a transfer without opening up other regions' stock.
create or replace function public.mi_stock_elsewhere(p_part uuid, p_exclude uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  sites uuid[];
begin
  if public.mi_rank() < 4 then
    sites := public.mi__region_sites(acct, public.mi_my_regions());
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('location_id', l.id, 'location_name', l.name, 'site_name', loc.name, 'type', l.type,
      'available', s.available, 'max_qty', s.max_qty) order by s.available desc), '[]'::jsonb)
    from public.mi_stock_levels s
    join public.mi_stock_locations l on l.id = s.location_id
    left join public.locations loc on loc.id = l.site_id
    where s.account_id = acct and s.part_id = p_part and s.available > 0 and l.active
      and (p_exclude is null or s.location_id <> p_exclude)
      and (public.mi_rank() >= 4 or l.site_id = any (sites) or (l.site_id is null and l.region_name = any (public.mi_my_regions()))));
end;
$$;

-- A note that a part is needed goes on the work order's description, where people look.
create or replace function public.mi_note_part_needed(p_work_order uuid, p_part uuid, p_qty numeric) returns void
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  pname text;
begin
  select name into pname from public.parts where id = p_part and account_id = acct;
  if pname is null then raise exception 'Part not found.'; end if;
  update public.work_orders
  set description = trim(both from coalesce(description, '') || E'\nPart needed: ' || pname || ' x' || trim_scale(p_qty))
  where id = p_work_order and account_id = acct and location_id = any (public.auth_site_ids());
  if not found then raise exception 'Work order not found.'; end if;
end;
$$;

-- ---- Grants: mi__ is internal, mi_ is for signed-in members (each checks its caller) ---
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'mi\_%' or p.proname = 'auth_site_ids')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname like 'mi\_\_%' then
      execute format('revoke all on function %s from authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
