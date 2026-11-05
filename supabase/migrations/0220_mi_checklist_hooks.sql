-- Maintenance Inventory: the checklist hooks. A checklist item can name an asset, a problem
-- on it opens a work order with that asset's BOM as suggested parts, and parts used on it
-- go to the ledger marked as coming from a checklist.
-- Also fixes mi_report_tool_issue, which couldn't take the id the app sends with every action.

drop function if exists public.mi_report_tool_issue(uuid, text, text, text);

create or replace function public.mi_report_tool_issue(
  p_tool uuid, p_condition text, p_notes text default null, p_source text default 'mobile', p_client_txn_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  prior jsonb;
  t public.mi_tools;
begin
  prior := public.mi__idem_start(acct, p_client_txn_id);
  if prior is not null then return prior; end if;
  t := public.mi__tool_for_update(p_tool);
  update public.mi_tools set condition = p_condition, status = case when p_condition = 'good' then status else 'in_repair' end
  where id = t.id returning * into t;
  perform public.mi__tool_event(t, 'report_issue', t.custodian_user_id, t.custodian_location_id, t.custodian_user_id, t.custodian_location_id, p_condition, null, p_notes, coalesce(p_source, 'mobile'), p_client_txn_id);
  return public.mi__idem_finish(acct, p_client_txn_id, jsonb_build_object('ok', true, 'tool_id', t.id, 'status', t.status));
end;
$$;

create or replace function public.mi_search_assets(p_q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  q text := nullif(trim(p_q), '');
begin
  if q is null then return '[]'::jsonb; end if;
  return (
    select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select jsonb_build_object('id', e.id, 'name', e.name, 'type', e.type, 'site_name', l.name) as x
      from public.equipment e join public.locations l on l.id = e.location_id
      where e.account_id = acct and e.location_id = any (public.auth_site_ids())
        and (e.name ilike '%' || q || '%' or e.type ilike '%' || q || '%')
      order by e.name limit 30) r);
end;
$$;

create or replace function public.mi_set_checklist_item_asset(p_item uuid, p_asset uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
begin
  perform public.mi__require_rank(2, 'link a checklist to an asset');
  if p_asset is not null and not exists (select 1 from public.equipment where id = p_asset and account_id = acct) then
    raise exception 'Asset not found.';
  end if;
  update public.checklist_items i set asset_id = p_asset
  from public.checklists c where c.id = i.checklist_id and i.id = p_item and c.account_id = acct;
  if not found then raise exception 'Checklist item not found.'; end if;
end;
$$;

-- One template can run at many sites, and the same machine has its own row at each. So
-- when the linked asset is at another site, use this site's asset of the same type.
create or replace function public.mi__checklist_asset(p_site uuid, p_linked uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select case when l.location_id = p_site then l.id
    else (select e.id from public.equipment e where e.location_id = p_site and e.type = l.type order by e.name limit 1) end
  from public.equipment l where l.id = p_linked;
$$;

-- For the "Parts used" control on a checklist run.
create or replace function public.mi_checklist_asset(p_instance uuid, p_item uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  site uuid;
  linked uuid;
begin
  select i.location_id into site from public.checklist_instances i join public.checklists c on c.id = i.checklist_id where i.id = p_instance and c.account_id = acct;
  select i.asset_id into linked from public.checklist_items i join public.checklists c on c.id = i.checklist_id
  where i.id = p_item and c.account_id = acct;
  if site is null or not site = any (public.auth_site_ids()) then raise exception 'Checklist not found.'; end if;
  return public.mi__checklist_asset(site, linked);
end;
$$;

create or replace function public.mi_work_order_from_checklist(p_instance uuid, p_item uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  inst public.checklist_instances;
  item public.checklist_items;
  here uuid;
  wo_title text;
  rec public.work_orders;
  parts_list jsonb;
begin
  select i.* into inst from public.checklist_instances i join public.checklists c on c.id = i.checklist_id where i.id = p_instance and c.account_id = acct;
  select i.* into item from public.checklist_items i join public.checklists c on c.id = i.checklist_id
  where i.id = p_item and c.account_id = acct;
  if inst.id is null or item.id is null then raise exception 'Checklist item not found.'; end if;
  wo_title := 'Checklist problem: ' || item.label;
  -- Going back and tapping it again shouldn't open a second one for the same problem.
  select * into rec from public.work_orders w
  where w.location_id = inst.location_id and w.title = wo_title and w.status = 'open'
    and w.created_at > now() - interval '1 day'
  order by w.created_at desc limit 1;
  if found then
    return jsonb_build_object('ok', true, 'work_order_id', rec.id, 'number', rec.number, 'asset_id', rec.equipment_id, 'already_open', true);
  end if;
  here := public.mi__checklist_asset(inst.location_id, item.asset_id);
  -- This site's asset may have no parts listed yet; the linked one's list still helps.
  select coalesce(jsonb_agg(jsonb_build_object('part_id', pa.part_id, 'qty', pa.qty_per)), '[]'::jsonb) into parts_list
  from public.part_assets pa
  where pa.asset_id = coalesce(
    (select x.asset_id from public.part_assets x where x.asset_id = here limit 1),
    item.asset_id);
  rec := public.mi_create_work_order(inst.location_id, wo_title, here, 'medium', p_note, parts_list);
  return jsonb_build_object('ok', true, 'work_order_id', rec.id, 'number', rec.number, 'asset_id', here, 'suggested_parts', jsonb_array_length(parts_list));
end;
$$;

revoke all on function public.mi__checklist_asset(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mi_report_tool_issue(uuid, text, text, text, text) from public, anon;
revoke all on function public.mi_search_assets(text) from public, anon;
revoke all on function public.mi_set_checklist_item_asset(uuid, uuid) from public, anon;
revoke all on function public.mi_checklist_asset(uuid, uuid) from public, anon;
revoke all on function public.mi_work_order_from_checklist(uuid, uuid, text) from public, anon;
grant execute on function public.mi_report_tool_issue(uuid, text, text, text, text) to authenticated;
grant execute on function public.mi_search_assets(text) to authenticated;
grant execute on function public.mi_set_checklist_item_asset(uuid, uuid) to authenticated;
grant execute on function public.mi_checklist_asset(uuid, uuid) to authenticated;
grant execute on function public.mi_work_order_from_checklist(uuid, uuid, text) to authenticated;
