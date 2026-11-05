-- Maintenance Inventory: reorder suggestions and purchase orders.

-- Quantities still coming: every open PO line, drafts included, so a draft made from a
-- suggestion takes that suggestion off the board instead of ordering twice.
create or replace function public.mi__on_order(p_part uuid, p_location uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(greatest(l.qty_ordered - l.qty_received, 0)), 0)
  from public.mi_po_lines l join public.mi_purchase_orders o on o.id = l.po_id
  where l.part_id = p_part and o.ship_to_location_id = p_location
    and o.status in ('draft', 'submitted', 'approved', 'sent', 'partially_received')
$$;

-- The board: available + on order at or below the reorder point. Quantity is max minus
-- that, rounded up to the vendor's pack. Overstock elsewhere shows so a transfer gets a
-- look before a purchase.
create or replace function public.mi_reorder_suggestions(p_location uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  vis uuid[] := public.mi_visible_location_ids();
begin
  return (
    select coalesce(jsonb_agg(x order by x ->> 'vendor_name' nulls last, x ->> 'part_name'), '[]'::jsonb) from (
      select jsonb_build_object(
        'part_id', p.id, 'part_name', p.name, 'sku', p.sku, 'is_critical', p.is_critical, 'uom', p.uom,
        'location_id', l.id, 'location_name', l.name, 'site_name', site.name,
        'available', s.available, 'on_order', oo.qty, 'reorder_point', s.reorder_point, 'min_qty', s.min_qty, 'max_qty', s.max_qty,
        'vendor_id', pv.vendor_id, 'vendor_name', v.name, 'vendor_part_number', pv.vendor_part_number,
        'pack_qty', pack.qty, 'lead_time_days', coalesce(pv.lead_time_days, p.lead_time_days),
        'unit_cost', coalesce(pv.price, p.unit_cost, s.avg_cost),
        'suggested_qty', ceil(need.qty / pack.qty) * pack.qty,
        'overstock', (
          select coalesce(jsonb_agg(jsonb_build_object('location_id', ol.id, 'location_name', ol.name, 'site_name', os.name, 'excess', o.available - o.max_qty)), '[]'::jsonb)
          from public.mi_stock_levels o
          join public.mi_stock_locations ol on ol.id = o.location_id
          left join public.locations os on os.id = ol.site_id
          where o.part_id = p.id and o.location_id <> l.id and o.max_qty is not null and o.available > o.max_qty and o.location_id = any (vis))
      ) as x
      from public.mi_stock_levels s
      join public.parts p on p.id = s.part_id
      join public.mi_stock_locations l on l.id = s.location_id and l.active
      left join public.locations site on site.id = l.site_id
      left join public.mi_part_vendors pv on pv.part_id = p.id and pv.preferred
      left join public.vendors v on v.id = pv.vendor_id
      cross join lateral (select public.mi__on_order(p.id, l.id) as qty) oo
      cross join lateral (select greatest(coalesce(pv.pack_qty, p.pack_qty, 1), 0.001) as qty) pack
      cross join lateral (select greatest(coalesce(s.max_qty, s.reorder_point, 0) - (s.available + oo.qty), 0) as qty) need
      where s.account_id = acct and s.reorder_point is not null
        and s.location_id = any (vis)
        and (p_location is null or s.location_id = p_location)
        and s.available + oo.qty <= s.reorder_point
        and need.qty > 0
    ) q);
end;
$$;

-- One draft PO per vendor and ship-to. A part with no preferred vendor can't be grouped,
-- so it comes back in `skipped` for someone to pick a vendor.
create or replace function public.mi_create_draft_pos(p_lines jsonb, p_urgent boolean default false, p_client_txn_id text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  prior jsonb;
  g record;
  line jsonb;
  po uuid;
  n bigint;
  made jsonb := '[]'::jsonb;
  skipped jsonb := '[]'::jsonb;
  total numeric;
  lim numeric;
  r integer := public.mi_rank();
begin
  prior := public.mi__idem_start(acct, p_client_txn_id);
  if prior is not null then return prior; end if;
  if r < 2 then raise exception 'Your role can''t create purchase orders.' using errcode = '42501'; end if;
  select (po_limits ->> public.mi_role())::numeric into lim from public.mi_settings where account_id = acct;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into skipped from jsonb_array_elements(p_lines) x where nullif(x ->> 'vendor_id', '') is null;

  for g in
    select (x ->> 'vendor_id')::uuid as vendor_id, (x ->> 'location_id')::uuid as location_id, jsonb_agg(x) as lines
    from jsonb_array_elements(p_lines) x where nullif(x ->> 'vendor_id', '') is not null
    group by 1, 2
  loop
    perform public.mi__require_manage(g.location_id, 'create a purchase order');
    if not exists (select 1 from public.vendors where id = g.vendor_id and account_id = acct) then raise exception 'Vendor not found.'; end if;
    total := (select sum((l ->> 'qty')::numeric * coalesce((l ->> 'unit_cost')::numeric, 0)) from jsonb_array_elements(g.lines) l);
    if r < 4 and lim is not null and total > lim then
      raise exception 'A $% order is over your $% limit. Ask a regional manager or the director.', round(total, 2), round(lim, 2) using errcode = '42501';
    end if;
    n := public.mi__next_number(acct, 'po');
    insert into public.mi_purchase_orders (account_id, number, vendor_id, ship_to_location_id, urgent, created_by)
    values (acct, n, g.vendor_id, g.location_id, coalesce(p_urgent, false), auth.uid()) returning id into po;
    for line in select * from jsonb_array_elements(g.lines) loop
      if not exists (select 1 from public.parts where id = (line ->> 'part_id')::uuid and account_id = acct) then raise exception 'Part not found.'; end if;
      insert into public.mi_po_lines (po_id, part_id, qty_ordered, unit_cost, normal_unit_cost, vendor_part_number)
      select po, p.id, (line ->> 'qty')::numeric, coalesce((line ->> 'unit_cost')::numeric, pv.price, p.unit_cost, 0), coalesce(pv.price, p.unit_cost), pv.vendor_part_number
      from public.parts p left join public.mi_part_vendors pv on pv.part_id = p.id and pv.vendor_id = g.vendor_id
      where p.id = (line ->> 'part_id')::uuid
      on conflict (po_id, part_id) do update set qty_ordered = public.mi_po_lines.qty_ordered + excluded.qty_ordered;
    end loop;
    made := made || jsonb_build_object('po_id', po, 'number', n, 'vendor_id', g.vendor_id, 'lines', jsonb_array_length(g.lines));
  end loop;
  return public.mi__idem_finish(acct, p_client_txn_id, jsonb_build_object('ok', true, 'created', made, 'skipped', skipped));
end;
$$;

create or replace function public.mi__po_for_update(p_po uuid) returns public.mi_purchase_orders
language plpgsql security definer set search_path = public as $$
declare
  o public.mi_purchase_orders;
begin
  select * into o from public.mi_purchase_orders where id = p_po and account_id = public.mi__account() for update;
  if not found or not (public.mi_rank() >= 4 or o.ship_to_location_id = any (public.mi_visible_location_ids())) then
    raise exception 'Purchase order not found.';
  end if;
  return o;
end;
$$;

create or replace function public.mi_po_total(p_po uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(qty_ordered * unit_cost), 0) from public.mi_po_lines where po_id = p_po
$$;

-- Edit a draft's lines. Once submitted, the order is what got approved.
create or replace function public.mi_save_po_line(p_po uuid, p_part uuid, p_qty numeric, p_unit_cost numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.mi_purchase_orders := public.mi__po_for_update(p_po);
begin
  perform public.mi__require_manage(o.ship_to_location_id, 'edit a purchase order');
  if o.status <> 'draft' then raise exception 'Only a draft can be edited.'; end if;
  if not exists (select 1 from public.parts where id = p_part and account_id = o.account_id) then raise exception 'Part not found.'; end if;
  if coalesce(p_qty, 0) <= 0 then
    delete from public.mi_po_lines where po_id = p_po and part_id = p_part;
    return;
  end if;
  insert into public.mi_po_lines (po_id, part_id, qty_ordered, unit_cost, normal_unit_cost, vendor_part_number)
  select p_po, p.id, p_qty, coalesce(p_unit_cost, pv.price, p.unit_cost, 0), coalesce(pv.price, p.unit_cost), pv.vendor_part_number
  from public.parts p left join public.mi_part_vendors pv on pv.part_id = p.id and pv.vendor_id = o.vendor_id
  where p.id = p_part
  on conflict (po_id, part_id) do update set qty_ordered = excluded.qty_ordered, unit_cost = coalesce(p_unit_cost, public.mi_po_lines.unit_cost);
end;
$$;

create or replace function public.mi_create_po(p_vendor uuid, p_location uuid, p_urgent boolean default false, p_notes text default null) returns public.mi_purchase_orders
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  o public.mi_purchase_orders;
begin
  perform public.mi__require_manage(p_location, 'create a purchase order');
  if not exists (select 1 from public.vendors where id = p_vendor and account_id = acct) then raise exception 'Vendor not found.'; end if;
  insert into public.mi_purchase_orders (account_id, number, vendor_id, ship_to_location_id, urgent, notes, created_by)
  values (acct, public.mi__next_number(acct, 'po'), p_vendor, p_location, coalesce(p_urgent, false), p_notes, auth.uid()) returning * into o;
  return o;
end;
$$;

create or replace function public.mi_submit_po(p_po uuid) returns public.mi_purchase_orders
language plpgsql security definer set search_path = public as $$
declare
  o public.mi_purchase_orders := public.mi__po_for_update(p_po);
begin
  perform public.mi__require_manage(o.ship_to_location_id, 'submit a purchase order');
  if o.status <> 'draft' then raise exception 'Only a draft can be submitted.'; end if;
  if not exists (select 1 from public.mi_po_lines where po_id = o.id) then raise exception 'Add at least one line.'; end if;
  update public.mi_purchase_orders set status = 'submitted', submitted_by = auth.uid(), submitted_at = now() where id = o.id returning * into o;
  return o;
end;
$$;

-- Approval limits per role. The director and admins can approve anything.
create or replace function public.mi_approve_po(p_po uuid, p_approve boolean default true) returns public.mi_purchase_orders
language plpgsql security definer set search_path = public as $$
declare
  o public.mi_purchase_orders := public.mi__po_for_update(p_po);
  r integer := public.mi_rank();
  lim numeric;
  total numeric := public.mi_po_total(p_po);
begin
  if o.status <> 'submitted' then raise exception 'Only a submitted order can be approved.'; end if;
  if r < 2 then raise exception 'Your role can''t approve purchase orders.' using errcode = '42501'; end if;
  if r < 4 then
    perform public.mi__require_manage(o.ship_to_location_id, 'approve this purchase order');
    select (po_limits ->> public.mi_role())::numeric into lim from public.mi_settings where account_id = o.account_id;
    if lim is null or total > lim then
      raise exception 'This $% order is over your $% approval limit.', round(total, 2), round(coalesce(lim, 0), 2) using errcode = '42501';
    end if;
  end if;
  update public.mi_purchase_orders
  set status = case when p_approve then 'approved' else 'draft' end, approved_by = case when p_approve then auth.uid() end, approved_at = case when p_approve then now() end
  where id = o.id returning * into o;
  return o;
end;
$$;

-- Marked sent by the mi-po-send function once the email is out, or by hand when it was
-- phoned in or ordered on a website.
create or replace function public.mi_mark_po_sent(p_po uuid, p_sent_to text default null) returns public.mi_purchase_orders
language plpgsql security definer set search_path = public as $$
declare
  o public.mi_purchase_orders := public.mi__po_for_update(p_po);
begin
  perform public.mi__require_manage(o.ship_to_location_id, 'send a purchase order');
  if o.status <> 'approved' then raise exception 'Only an approved order can be sent.'; end if;
  update public.mi_purchase_orders set status = 'sent', sent_by = auth.uid(), sent_at = now(), sent_to = p_sent_to where id = o.id returning * into o;
  return o;
end;
$$;

create or replace function public.mi_cancel_po(p_po uuid) returns public.mi_purchase_orders
language plpgsql security definer set search_path = public as $$
declare
  o public.mi_purchase_orders := public.mi__po_for_update(p_po);
begin
  perform public.mi__require_manage(o.ship_to_location_id, 'cancel a purchase order');
  if o.status in ('partially_received', 'received', 'closed') then raise exception 'Stock has already been received against this order.'; end if;
  update public.mi_purchase_orders set status = 'cancelled' where id = o.id returning * into o;
  return o;
end;
$$;

create or replace function public.mi_close_po(p_po uuid) returns public.mi_purchase_orders
language plpgsql security definer set search_path = public as $$
declare
  o public.mi_purchase_orders := public.mi__po_for_update(p_po);
begin
  perform public.mi__require_manage(o.ship_to_location_id, 'close a purchase order');
  if o.status not in ('received', 'partially_received') then raise exception 'Only a received order can be closed.'; end if;
  update public.mi_purchase_orders set status = 'closed', closed_at = now() where id = o.id returning * into o;
  return o;
end;
$$;

-- Receiving: partial is fine. Stock and moving-average cost update here, and the PO's
-- status follows what's still open.
create or replace function public.mi_receive_po_line(
  p_line uuid, p_qty numeric default null, p_unit_cost numeric default null, p_bin uuid default null,
  p_packing_slip text default null, p_source text default 'mobile', p_client_txn_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  prior jsonb;
  l public.mi_po_lines;
  o public.mi_purchase_orders;
  qty numeric;
  cost numeric;
  rec public.mi_inventory_transactions;
  r uuid;
  s public.mi_stock_levels;
  open_left numeric;
begin
  prior := public.mi__idem_start(acct, p_client_txn_id);
  if prior is not null then return prior; end if;
  select * into l from public.mi_po_lines where id = p_line for update;
  if not found then raise exception 'PO line not found.'; end if;
  o := public.mi__po_for_update(l.po_id);
  perform public.mi__require_act(o.ship_to_location_id);
  if o.status not in ('approved', 'sent', 'partially_received') then raise exception 'This order isn''t open for receiving.'; end if;
  -- Defaults to whatever is still due.
  qty := coalesce(p_qty, l.qty_ordered - l.qty_received);
  if qty <= 0 then raise exception 'Enter a quantity above zero.'; end if;
  cost := coalesce(p_unit_cost, l.unit_cost);

  rec := public.mi__post(acct, l.part_id, o.ship_to_location_id, 'receive', qty, cost, null, null, l.id, null, null, null, null,
    coalesce(p_source, 'mobile'), p_client_txn_id, false, true);
  update public.mi_po_lines set qty_received = qty_received + qty where id = l.id;
  if p_bin is not null then
    update public.mi_stock_levels set bin_id = p_bin where part_id = l.part_id and location_id = o.ship_to_location_id;
  end if;

  insert into public.mi_receipts (account_id, po_id, location_id, packing_slip_path, received_by) values (acct, o.id, o.ship_to_location_id, p_packing_slip, auth.uid()) returning id into r;
  insert into public.mi_receipt_lines (receipt_id, po_line_id, part_id, qty, unit_cost, bin_id) values (r, l.id, l.part_id, qty, cost, p_bin);

  select coalesce(sum(greatest(x.qty_ordered - x.qty_received, 0)), 0) into open_left from public.mi_po_lines x where x.po_id = o.id;
  update public.mi_purchase_orders set status = case when open_left > 0 then 'partially_received' else 'received' end where id = o.id returning * into o;
  select * into s from public.mi_stock_levels where part_id = l.part_id and location_id = o.ship_to_location_id;
  return public.mi__idem_finish(acct, p_client_txn_id, jsonb_build_object('ok', true, 'po_status', o.status, 'on_hand', s.on_hand, 'avg_cost', s.avg_cost,
    'line_open', greatest(l.qty_ordered - l.qty_received - qty, 0)));
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
