-- Maintenance Inventory: tunnel diagrams (docs/maintenance-inventory/TUNNEL.md).
--
-- A top-down drawing of a site's tunnel. Each shape on it can be linked to a real
-- machine, so the drawing shows what's running, what's down and how hard each machine
-- has worked. A template is a drawing with no site; applying it to a site copies it and
-- links each shape to that site's machine of the same type (MaintainX gave every site
-- the same types: Top Brush 1, Wheel Boss DS...). Each site's copy can then be moved,
-- added to or trimmed, since no two tunnels are quite the same.
--
-- Coordinates are feet. x runs along the tunnel from the entrance (prep is negative);
-- y is across it from the centerline, driver's side negative. x and y are a shape's
-- center; w runs along x, h along y.

create table public.mi_tunnel_layouts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  tunnel_no integer not null default 1 check (tunnel_no between 1 and 9),
  name text not null check (length(trim(name)) between 1 and 80),
  is_template boolean not null default false,
  length_ft numeric(6,1) not null default 140 check (length_ft between 20 and 400),
  width_ft numeric(6,1) not null default 16 check (width_ft between 8 and 60),
  -- Bands along the tunnel: [{name, x_from, x_to}]. Their names become the site's zones.
  zones jsonb not null default '[]'::jsonb check (jsonb_typeof(zones) = 'array'),
  based_on uuid references public.mi_tunnel_layouts(id) on delete set null,
  version integer not null default 1,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint mi_tunnel_layouts_template check (is_template = (location_id is null))
);
create unique index mi_tunnel_layouts_site on public.mi_tunnel_layouts (location_id, tunnel_no) where not is_template;
create unique index mi_tunnel_layouts_template_name on public.mi_tunnel_layouts (account_id, lower(name)) where is_template;

create table public.mi_tunnel_items (
  id uuid primary key default gen_random_uuid(),
  layout_id uuid not null references public.mi_tunnel_layouts(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- Which drawing to use (the shapes live in the app): wrap, top_brush, arch...
  kind text not null check (kind ~ '^[a-z_]{2,30}$'),
  label text not null default '' check (length(label) <= 80),
  x_ft numeric(7,2) not null default 0,
  y_ft numeric(7,2) not null default 0,
  w_ft numeric(7,2) not null default 4 check (w_ft > 0 and w_ft <= 400),
  h_ft numeric(7,2) not null default 4 check (h_ft > 0 and h_ft <= 200),
  rotation smallint not null default 0 check (rotation in (0, 90, 180, 270)),
  side text not null default 'center' check (side in ('ds', 'ps', 'center', 'both', 'outside')),
  zone text check (zone is null or length(zone) <= 60),
  -- Templates: the equipment type this shape stands for at any site.
  match_type text check (match_type is null or length(match_type) <= 120),
  asset_id uuid references public.equipment(id) on delete set null,
  sort_order integer not null default 0,
  props jsonb not null default '{}'::jsonb check (jsonb_typeof(props) = 'object'),
  created_at timestamptz not null default now()
);
create index mi_tunnel_items_layout on public.mi_tunnel_items (layout_id, sort_order);
create index mi_tunnel_items_asset on public.mi_tunnel_items (asset_id) where asset_id is not null;

do $$
declare t text;
begin
  foreach t in array array['mi_tunnel_layouts', 'mi_tunnel_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;

create policy mi_tunnel_layouts_select on public.mi_tunnel_layouts for select
  using (account_id = auth_account_id() and public.mi_rank() >= 1
         and (is_template or location_id = any ((select public.auth_site_ids())::uuid[])));
create policy mi_tunnel_items_select on public.mi_tunnel_items for select
  using (exists (select 1 from public.mi_tunnel_layouts l where l.id = layout_id));

-- A machine moved to another site comes off its old site's drawing.
create or replace function public.mi__tunnel_unlink_moved() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.location_id is distinct from old.location_id then
    update public.mi_tunnel_items i set asset_id = null
    from public.mi_tunnel_layouts l
    where i.layout_id = l.id and i.asset_id = new.id and l.location_id is distinct from new.location_id;
  end if;
  return null;
end;
$$;
drop trigger if exists equipment_mi_tunnel_unlink on public.equipment;
create trigger equipment_mi_tunnel_unlink after update of location_id on public.equipment
  for each row execute function public.mi__tunnel_unlink_moved();

-- ---- Reading ------------------------------------------------------------------------
create or replace function public.mi__tunnel_layout_json(l public.mi_tunnel_layouts) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', l.id, 'location_id', l.location_id, 'tunnel_no', l.tunnel_no, 'name', l.name, 'is_template', l.is_template,
    'length_ft', l.length_ft, 'width_ft', l.width_ft, 'zones', l.zones, 'based_on', l.based_on, 'version', l.version, 'updated_at', l.updated_at,
    'updated_by', (select u.name from public.users u where u.id = l.updated_by))
$$;

create or replace function public.mi__tunnel_items_json(p_layout uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'label', i.label, 'x_ft', i.x_ft, 'y_ft', i.y_ft, 'w_ft', i.w_ft, 'h_ft', i.h_ft,
    'rotation', i.rotation, 'side', i.side, 'zone', i.zone, 'match_type', i.match_type, 'asset_id', i.asset_id, 'sort_order', i.sort_order, 'props', i.props)
    order by i.sort_order, i.x_ft), '[]'::jsonb)
  from public.mi_tunnel_items i where i.layout_id = p_layout
$$;

-- A site's drawing with everything the screen shows on it: each linked machine's status,
-- sticker, open work orders and use count, the site's car counts, which machines aren't
-- on the drawing yet, and the templates it could start from.
create or replace function public.mi_tunnel_get(p_site uuid, p_tunnel integer default 1) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  l public.mi_tunnel_layouts;
  linked uuid[];
  today date;
begin
  if not p_site = any (public.auth_site_ids()) then raise exception 'That site isn''t one of yours.' using errcode = '42501'; end if;
  today := public.mi__today(acct);
  select * into l from public.mi_tunnel_layouts where account_id = acct and location_id = p_site and tunnel_no = coalesce(p_tunnel, 1);
  select coalesce(array_agg(distinct i.asset_id), '{}') into linked from public.mi_tunnel_items i where i.layout_id = l.id and i.asset_id is not null;

  return jsonb_build_object(
    'layout', case when l.id is null then null else public.mi__tunnel_layout_json(l) end,
    'items', case when l.id is null then '[]'::jsonb else public.mi__tunnel_items_json(l.id) end,
    'assets', (
      select coalesce(jsonb_object_agg(e.id, jsonb_strip_nulls(jsonb_build_object(
        'id', e.id, 'name', e.name, 'type', e.type, 'status', e.status, 'crit_class', e.crit_class, 'parent_id', e.parent_asset_id,
        'area_name', (select a.name from public.mi_areas a where a.id = e.area_id),
        'tag', (select t.code from public.mi_tags t where t.entity_type = 'asset' and t.entity_id = e.id),
        'tag_printed', (select t.printed_count > 0 from public.mi_tags t where t.entity_type = 'asset' and t.entity_id = e.id),
        'open_wos', (select count(*) from public.work_orders w where w.equipment_id = e.id and w.status in ('open', 'in_progress', 'on_hold')),
        'children', (select count(*) from public.equipment c where c.parent_asset_id = e.id and c.status <> 'retired'),
        'last_serviced_at', e.last_serviced_at,
        'usage_since', u.since, 'cars_since', u.cars_since, 'usage_state', u.state, 'usage_basis', u.basis))), '{}'::jsonb)
      from public.equipment e
      left join public.mi__usage(acct, linked) u on u.asset_id = e.id
      where e.id = any (linked)),
    'site', (
      select jsonb_build_object('id', s.id, 'name', s.name, 'site_number', public.mi__site_number(s.id),
        'cars_today', c.today_cars, 'cars_30d', c.c30, 'data_through', c.last)
      from public.locations s
      left join lateral (
        select sum(m.cars) filter (where m.date = today) as today_cars, sum(m.cars) as c30, max(m.date) as last
        from (select mm.date, coalesce(mm.drb_cars, 0) - coalesce(mm.drb_test_cars, 0) + coalesce(mm.flex_cars, 0) as cars
              from public.site_daily_metrics mm
              where mm.account_id = acct and mm.site_number = public.mi__site_number(s.id) and mm.date > today - 30) m
      ) c on true
      where s.id = p_site),
    'tunnels', (
      select coalesce(jsonb_agg(jsonb_build_object('tunnel_no', x.tunnel_no, 'name', x.name) order by x.tunnel_no), '[]'::jsonb)
      from public.mi_tunnel_layouts x where x.account_id = acct and x.location_id = p_site),
    -- Machines at the site that aren't on this drawing: what's left to place.
    'unplaced', (
      select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'type', e.type, 'status', e.status,
               'area_name', (select a.name from public.mi_areas a where a.id = e.area_id)) order by e.name), '[]'::jsonb)
      from public.equipment e
      where e.account_id = acct and e.location_id = p_site and e.parent_asset_id is null and e.status <> 'retired' and not e.id = any (linked)),
    'templates', (
      select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'items', (select count(*) from public.mi_tunnel_items i where i.layout_id = x.id))
             order by x.name), '[]'::jsonb)
      from public.mi_tunnel_layouts x where x.account_id = acct and x.is_template),
    'can_edit', public.mi_rank() >= 2,
    'can_edit_templates', public.mi_rank() >= 4
  );
end;
$$;

-- Templates for the settings screen, with which sites already have a drawing.
create or replace function public.mi_tunnel_templates() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  sites uuid[] := public.auth_site_ids();
begin
  return jsonb_build_object(
    'templates', (
      select coalesce(jsonb_agg(public.mi__tunnel_layout_json(x) || jsonb_build_object(
               'items', (select count(*) from public.mi_tunnel_items i where i.layout_id = x.id),
               'sites_using', (select count(*) from public.mi_tunnel_layouts s where s.based_on = x.id)) order by x.name), '[]'::jsonb)
      from public.mi_tunnel_layouts x where x.account_id = acct and x.is_template),
    'site_layouts', (
      select coalesce(jsonb_agg(jsonb_build_object('location_id', s.location_id, 'tunnel_no', s.tunnel_no, 'name', s.name, 'based_on', s.based_on,
               'updated_at', s.updated_at, 'items', (select count(*) from public.mi_tunnel_items i where i.layout_id = s.id),
               'linked', (select count(*) from public.mi_tunnel_items i where i.layout_id = s.id and i.asset_id is not null))), '[]'::jsonb)
      from public.mi_tunnel_layouts s where s.account_id = acct and not s.is_template and s.location_id = any (sites)),
    'can_edit_templates', public.mi_rank() >= 4
  );
end;
$$;

create or replace function public.mi_tunnel_template(p_layout uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  l public.mi_tunnel_layouts;
begin
  select * into l from public.mi_tunnel_layouts where id = p_layout and account_id = acct and is_template;
  if not found then raise exception 'Template not found.'; end if;
  return jsonb_build_object('layout', public.mi__tunnel_layout_json(l), 'items', public.mi__tunnel_items_json(l.id), 'can_edit', public.mi_rank() >= 4);
end;
$$;

-- ---- Saving -------------------------------------------------------------------------
-- The editor sends the whole drawing; this replaces it in one go. version guards
-- against two people editing the same drawing: the second save is turned away.
create or replace function public.mi_tunnel_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  sites uuid[] := public.auth_site_ids();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  l public.mi_tunnel_layouts;
  is_tpl boolean;
  v_site uuid;
  before_ids uuid[];
  after_ids uuid[];
  keep uuid[];
  it jsonb;
  item_id uuid;
  bad text;
  n integer := 0;
begin
  if v_id is not null then
    select * into l from public.mi_tunnel_layouts where id = v_id and account_id = acct for update;
    if not found then raise exception 'Diagram not found.'; end if;
    if p ? 'version' and (p ->> 'version')::int <> l.version then
      raise exception 'Someone else changed this diagram while you were editing. Reload to see their changes.' using errcode = '40001';
    end if;
    is_tpl := l.is_template;
    v_site := l.location_id;
  else
    is_tpl := coalesce((p ->> 'is_template')::boolean, false);
    v_site := case when is_tpl then null else nullif(p ->> 'location_id', '')::uuid end;
    if not is_tpl and v_site is null then raise exception 'Pick a site.'; end if;
  end if;

  if is_tpl then
    perform public.mi__require_rank(4, 'change tunnel templates');
  else
    perform public.mi__require_rank(2, 'change tunnel diagrams');
    if not v_site = any (sites) then raise exception 'That site isn''t one of yours.' using errcode = '42501'; end if;
  end if;

  if jsonb_typeof(coalesce(p -> 'items', '[]'::jsonb)) <> 'array' then raise exception 'Items must be a list.'; end if;
  if jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb)) > 400 then raise exception 'That''s more than 400 shapes. Split it into a second tunnel.'; end if;

  -- Linked machines have to be at this site; templates link to none.
  select string_agg(distinct coalesce(e.name, x ->> 'asset_id'), ', ') into bad
  from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) x
  left join public.equipment e on e.id = nullif(x ->> 'asset_id', '')::uuid
  where nullif(x ->> 'asset_id', '') is not null and (is_tpl or e.id is null or e.location_id <> v_site or e.account_id <> acct);
  if bad is not null then
    raise exception '%', case when is_tpl then 'A template can''t be linked to real machines. Use the type instead.' else 'These aren''t at this site: ' || bad end;
  end if;

  if v_id is null then
    begin
      insert into public.mi_tunnel_layouts (account_id, location_id, tunnel_no, name, is_template, length_ft, width_ft, zones, based_on, updated_by)
      values (acct, v_site, coalesce((p ->> 'tunnel_no')::int, 1),
        coalesce(nullif(trim(coalesce(p ->> 'name', '')), ''), case when is_tpl then 'Tunnel template' else 'Tunnel' end),
        is_tpl, coalesce((p ->> 'length_ft')::numeric, 140), coalesce((p ->> 'width_ft')::numeric, 16),
        coalesce(p -> 'zones', '[]'::jsonb), nullif(p ->> 'based_on', '')::uuid, auth.uid())
      returning * into l;
    exception when unique_violation then
      raise exception '%', case when is_tpl then 'There''s already a template with that name.' else 'This site already has a diagram for that tunnel.' end;
    end;
    before_ids := '{}';
  else
    select coalesce(array_agg(distinct asset_id), '{}') into before_ids from public.mi_tunnel_items where layout_id = l.id and asset_id is not null;
    update public.mi_tunnel_layouts set
      name = coalesce(nullif(trim(coalesce(p ->> 'name', '')), ''), name),
      length_ft = coalesce((p ->> 'length_ft')::numeric, length_ft),
      width_ft = coalesce((p ->> 'width_ft')::numeric, width_ft),
      zones = coalesce(p -> 'zones', zones),
      version = version + 1, updated_at = now(), updated_by = auth.uid()
    where id = l.id
    returning * into l;
  end if;

  if p ? 'items' then
    select coalesce(array_agg((x ->> 'id')::uuid), '{}') into keep
    from jsonb_array_elements(p -> 'items') x
    where (x ->> 'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    delete from public.mi_tunnel_items where layout_id = l.id and not id = any (keep);

    for it in select value from jsonb_array_elements(p -> 'items') loop
      item_id := case when (it ->> 'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (it ->> 'id')::uuid end;
      update public.mi_tunnel_items set
        kind = it ->> 'kind', label = coalesce(it ->> 'label', ''),
        x_ft = coalesce((it ->> 'x_ft')::numeric, 0), y_ft = coalesce((it ->> 'y_ft')::numeric, 0),
        w_ft = coalesce((it ->> 'w_ft')::numeric, 4), h_ft = coalesce((it ->> 'h_ft')::numeric, 4),
        rotation = coalesce((it ->> 'rotation')::smallint, 0), side = coalesce(nullif(it ->> 'side', ''), 'center'),
        zone = nullif(trim(coalesce(it ->> 'zone', '')), ''), match_type = nullif(trim(coalesce(it ->> 'match_type', '')), ''),
        asset_id = nullif(it ->> 'asset_id', '')::uuid, sort_order = coalesce((it ->> 'sort_order')::int, n),
        props = coalesce(it -> 'props', '{}'::jsonb)
      where id = item_id and layout_id = l.id;
      if not found then
        insert into public.mi_tunnel_items (layout_id, account_id, kind, label, x_ft, y_ft, w_ft, h_ft, rotation, side, zone, match_type, asset_id, sort_order, props)
        values (l.id, acct, it ->> 'kind', coalesce(it ->> 'label', ''),
          coalesce((it ->> 'x_ft')::numeric, 0), coalesce((it ->> 'y_ft')::numeric, 0), coalesce((it ->> 'w_ft')::numeric, 4), coalesce((it ->> 'h_ft')::numeric, 4),
          coalesce((it ->> 'rotation')::smallint, 0), coalesce(nullif(it ->> 'side', ''), 'center'),
          nullif(trim(coalesce(it ->> 'zone', '')), ''), nullif(trim(coalesce(it ->> 'match_type', '')), ''),
          nullif(it ->> 'asset_id', '')::uuid, coalesce((it ->> 'sort_order')::int, n), coalesce(it -> 'props', '{}'::jsonb));
      end if;
      n := n + 1;
    end loop;
  end if;

  -- Note on each machine's history when it goes on or comes off the drawing.
  if not is_tpl then
    select coalesce(array_agg(distinct asset_id), '{}') into after_ids from public.mi_tunnel_items where layout_id = l.id and asset_id is not null;
    insert into public.mi_equipment_events (account_id, location_id, equipment_id, action, actor_user_id, actor_name, note)
    select acct, v_site, x, 'diagram_linked', auth.uid(), public.mi__actor_name(auth.uid()), l.name
    from unnest(after_ids) x where not x = any (before_ids);
    insert into public.mi_equipment_events (account_id, location_id, equipment_id, action, actor_user_id, actor_name, note)
    select acct, v_site, x, 'diagram_unlinked', auth.uid(), public.mi__actor_name(auth.uid()), l.name
    from unnest(before_ids) x where not x = any (after_ids);
  end if;

  return jsonb_build_object('id', l.id, 'version', l.version);
end;
$$;

-- Link one shape to a machine (or unlink it, p_asset null), from the diagram's panel.
create or replace function public.mi_tunnel_link_item(p_item uuid, p_asset uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  i public.mi_tunnel_items;
  l public.mi_tunnel_layouts;
begin
  perform public.mi__require_rank(2, 'change tunnel diagrams');
  select * into i from public.mi_tunnel_items where id = p_item and account_id = acct for update;
  if not found then raise exception 'That shape isn''t on a diagram anymore. Reload.'; end if;
  select * into l from public.mi_tunnel_layouts where id = i.layout_id;
  if l.is_template then raise exception 'Templates link by type, not to machines.'; end if;
  if not l.location_id = any (public.auth_site_ids()) then raise exception 'That site isn''t one of yours.' using errcode = '42501'; end if;
  if p_asset is not null and not exists (select 1 from public.equipment where id = p_asset and account_id = acct and location_id = l.location_id) then
    raise exception 'That machine isn''t at this site.';
  end if;
  update public.mi_tunnel_items set asset_id = p_asset where id = i.id;
  update public.mi_tunnel_layouts set version = version + 1, updated_at = now(), updated_by = auth.uid() where id = l.id returning * into l;
  if i.asset_id is not null and i.asset_id is distinct from p_asset
     and not exists (select 1 from public.mi_tunnel_items x where x.layout_id = l.id and x.asset_id = i.asset_id) then
    insert into public.mi_equipment_events (account_id, location_id, equipment_id, action, actor_user_id, actor_name, note)
    values (acct, l.location_id, i.asset_id, 'diagram_unlinked', auth.uid(), public.mi__actor_name(auth.uid()), coalesce(nullif(i.label, ''), l.name));
  end if;
  if p_asset is not null and p_asset is distinct from i.asset_id
     and (select count(*) from public.mi_tunnel_items x where x.layout_id = l.id and x.asset_id = p_asset) = 1 then
    insert into public.mi_equipment_events (account_id, location_id, equipment_id, action, actor_user_id, actor_name, note)
    values (acct, l.location_id, p_asset, 'diagram_linked', auth.uid(), public.mi__actor_name(auth.uid()), coalesce(nullif(i.label, ''), l.name));
  end if;
  return jsonb_build_object('version', l.version);
end;
$$;

-- ---- Copying a drawing to sites --------------------------------------------------------
-- From a template or another site's drawing, to one or more sites. Each shape links to the
-- site's machine of the same type: a machine first, then a component; two candidates
-- of the same kind is flagged as a guess. Zones become the site's zones, and machines
-- with no zone yet get the zone of the shape they landed on (their components too).
-- With p_commit false nothing is saved: it reports what would happen.
create or replace function public.mi_tunnel_apply(p_source uuid, p_sites uuid[], p_opts jsonb default '{}'::jsonb, p_commit boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  sites uuid[] := public.auth_site_ids();
  src public.mi_tunnel_layouts;
  mode text := coalesce(nullif(p_opts ->> 'mode', ''), 'skip_existing');
  tno integer := coalesce((p_opts ->> 'tunnel_no')::int, 1);
  set_zones boolean := coalesce((p_opts ->> 'set_zones')::boolean, true);
  site uuid;
  site_name text;
  existing public.mi_tunnel_layouts;
  nl public.mi_tunnel_layouts;
  si record;
  key text;
  cand uuid[];
  pick uuid;
  z jsonb;
  zid uuid;
  report jsonb := '[]'::jsonb;
  one jsonb;
  n_linked integer;
  unmatched text[];
  ambiguous text[];
  n_zones integer;
  n_areas integer;
  m integer;
begin
  perform public.mi__require_rank(2, 'set up tunnel diagrams');
  select * into src from public.mi_tunnel_layouts where id = p_source and account_id = acct;
  if not found or (not src.is_template and not src.location_id = any (sites)) then raise exception 'Diagram to copy from not found.'; end if;
  if mode not in ('skip_existing', 'replace') then raise exception 'Unknown mode.'; end if;
  if coalesce(array_length(p_sites, 1), 0) = 0 then raise exception 'Pick at least one site.'; end if;
  if exists (select 1 from unnest(p_sites) s where not s = any (sites)) then raise exception 'One of those sites isn''t yours.' using errcode = '42501'; end if;
  -- Several sites at once is a director's job; a manager sets up their own.
  if array_length(p_sites, 1) > 1 then perform public.mi__require_rank(4, 'set up several sites at once'); end if;

  begin
    foreach site in array p_sites loop
      select name into site_name from public.locations where id = site;
      select * into existing from public.mi_tunnel_layouts where account_id = acct and location_id = site and tunnel_no = tno;
      if existing.id is not null and (mode = 'skip_existing' or existing.id = src.id) then
        report := report || jsonb_build_array(jsonb_build_object('site_id', site, 'site_name', site_name, 'result', 'skipped'));
        existing := null;
        continue;
      end if;
      if existing.id is not null then delete from public.mi_tunnel_layouts where id = existing.id; end if;

      insert into public.mi_tunnel_layouts (account_id, location_id, tunnel_no, name, is_template, length_ft, width_ft, zones, based_on, updated_by)
      values (acct, site, tno, case when tno = 1 then 'Tunnel' else 'Tunnel ' || tno end, false, src.length_ft, src.width_ft, src.zones,
              case when src.is_template then src.id else src.based_on end, auth.uid())
      returning * into nl;

      n_linked := 0; unmatched := '{}'; ambiguous := '{}'; n_zones := 0; n_areas := 0;
      for si in
        select i.*, case when src.is_template then i.match_type else coalesce(i.match_type, e.type) end as key_type
        from public.mi_tunnel_items i left join public.equipment e on e.id = i.asset_id
        where i.layout_id = src.id order by i.sort_order, i.x_ft
      loop
        key := nullif(trim(coalesce(si.key_type, '')), '');
        pick := null;
        if key is not null then
          select array_agg(e.id order by e.name) into cand from public.equipment e
          where e.account_id = acct and e.location_id = site and e.status <> 'retired' and e.parent_asset_id is null and lower(e.type) = lower(key);
          if cand is null then
            select array_agg(e.id order by e.name) into cand from public.equipment e
            where e.account_id = acct and e.location_id = site and e.status <> 'retired' and lower(e.type) = lower(key);
          end if;
          pick := cand[1];
          if pick is null then unmatched := unmatched || coalesce(nullif(si.label, ''), key);
          else
            n_linked := n_linked + 1;
            if array_length(cand, 1) > 1 then ambiguous := ambiguous || coalesce(nullif(si.label, ''), key); end if;
          end if;
        end if;
        insert into public.mi_tunnel_items (layout_id, account_id, kind, label, x_ft, y_ft, w_ft, h_ft, rotation, side, zone, match_type, asset_id, sort_order, props)
        values (nl.id, acct, si.kind, si.label, si.x_ft, si.y_ft, si.w_ft, si.h_ft, si.rotation, si.side, si.zone, key, pick, si.sort_order, si.props);
      end loop;

      if set_zones then
        for z in select value from jsonb_array_elements(nl.zones) loop
          if nullif(trim(coalesce(z ->> 'name', '')), '') is not null
             and not exists (select 1 from public.mi_areas a where a.site_id = site and lower(a.name) = lower(trim(z ->> 'name'))) then
            n_zones := n_zones + 1;
          end if;
          perform public.mi__area_for(acct, site, z ->> 'name');
        end loop;
        -- Outside zones (equipment room, vacuums) come from the shapes themselves.
        for si in select distinct i.zone from public.mi_tunnel_items i where i.layout_id = nl.id and i.zone is not null loop
          if not exists (select 1 from public.mi_areas a where a.site_id = site and lower(a.name) = lower(si.zone)) then n_zones := n_zones + 1; end if;
          perform public.mi__area_for(acct, site, si.zone);
        end loop;
        for si in select i.asset_id, i.zone from public.mi_tunnel_items i where i.layout_id = nl.id and i.asset_id is not null and i.zone is not null loop
          zid := public.mi__area_for(acct, site, si.zone);
          with recursive tree as (
            select x.id from public.equipment x where x.id = si.asset_id
            union
            select x.id from public.equipment x join tree on x.parent_asset_id = tree.id
          )
          update public.equipment q set area_id = zid where q.id in (select id from tree) and q.area_id is null;
          get diagnostics m = row_count;
          n_areas := n_areas + m;
        end loop;
      end if;

      insert into public.mi_equipment_events (account_id, location_id, equipment_id, action, actor_user_id, actor_name, note)
      select distinct acct, site, i.asset_id, 'diagram_linked', auth.uid(), public.mi__actor_name(auth.uid()), 'Set up from ' || src.name
      from public.mi_tunnel_items i where i.layout_id = nl.id and i.asset_id is not null;

      one := jsonb_build_object('site_id', site, 'site_name', site_name, 'result', case when existing.id is not null then 'replaced' else 'created' end,
        'items', (select count(*) from public.mi_tunnel_items where layout_id = nl.id), 'linked', n_linked,
        'unmatched', to_jsonb(unmatched), 'ambiguous', to_jsonb(ambiguous), 'zones_created', n_zones, 'areas_set', n_areas);
      report := report || jsonb_build_array(one);
      existing := null;
    end loop;
    -- A check runs everything, then undoes it: the report stays, the changes don't.
    if not p_commit then raise exception using errcode = 'P0099', message = 'dry run'; end if;
  exception when sqlstate 'P0099' then
    null;
  end;
  return jsonb_build_object('committed', p_commit, 'sites', report);
end;
$$;

create or replace function public.mi_tunnel_delete(p_layout uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  l public.mi_tunnel_layouts;
begin
  select * into l from public.mi_tunnel_layouts where id = p_layout and account_id = acct;
  if not found then raise exception 'Diagram not found.'; end if;
  if l.is_template then perform public.mi__require_rank(4, 'remove tunnel templates');
  else
    perform public.mi__require_rank(2, 'remove tunnel diagrams');
    if not l.location_id = any (public.auth_site_ids()) then raise exception 'That site isn''t one of yours.' using errcode = '42501'; end if;
  end if;
  delete from public.mi_tunnel_layouts where id = l.id;
end;
$$;

-- ---- The machine's page knows where it sits on the drawing ------------------------------
create or replace function public.mi_equipment_detail(p_asset uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  d jsonb := public.mi_asset_detail(p_asset);
  e public.equipment;
  t public.mi_tags;
begin
  if d ? 'hidden' then return d; end if;
  select * into e from public.equipment where id = p_asset;
  select * into t from public.mi_tags where entity_type = 'asset' and entity_id = p_asset;
  return d || jsonb_build_object(
    'asset', (d -> 'asset') || jsonb_build_object(
      'tag_printed_count', coalesce(t.printed_count, 0),
      'tag_last_printed_at', t.last_printed_at,
      'site_number', public.mi__site_number(e.location_id),
      'can_manage', public.mi_rank() >= 2,
      'can_move_site', public.mi_rank() >= 4),
    'children', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'type', c.type, 'status', c.status, 'crit_class', c.crit_class,
               'children', (select count(*) from public.equipment g where g.parent_asset_id = c.id and g.status <> 'retired'))
             order by c.status = 'retired', c.name), '[]'::jsonb)
      from public.equipment c where c.parent_asset_id = e.id),
    'ancestors', (
      with recursive up as (
        select p.id, p.name, p.parent_asset_id, 1 as depth from public.equipment p where p.id = e.parent_asset_id
        union all
        select p.id, p.name, p.parent_asset_id, up.depth + 1 from public.equipment p join up on p.id = up.parent_asset_id where up.depth < 10
      )
      select coalesce(jsonb_agg(jsonb_build_object('id', up.id, 'name', up.name) order by up.depth desc), '[]'::jsonb) from up),
    'usage', (select to_jsonb(u) from public.mi__usage(acct, array[p_asset]) u),
    'resets', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('id', g.id, 'on', public.mi__local_date(acct, g.performed_at), 'notes', g.notes, 'by', g.performed_by_name) as x
        from public.mi_log_entries g
        where g.asset_id = e.id and g.resets_usage and g.voided_at is null
        order by g.performed_at desc limit 10) q),
    -- Where it is on its site's drawing; a component shows through its machine.
    'diagram', (
      with recursive up as (
        select e.id, e.parent_asset_id, 0 as depth
        union all
        select p.id, p.parent_asset_id, up.depth + 1 from public.equipment p join up on p.id = up.parent_asset_id where up.depth < 10
      )
      select coalesce(jsonb_agg(jsonb_build_object('layout_id', l.id, 'item_id', i.id, 'label', i.label, 'tunnel_no', l.tunnel_no, 'via_parent', up.depth > 0)
             order by up.depth, l.tunnel_no, i.sort_order), '[]'::jsonb)
      from up
      join public.mi_tunnel_items i on i.asset_id = up.id
      join public.mi_tunnel_layouts l on l.id = i.layout_id and l.location_id = e.location_id));
end;
$$;

-- ---- Grants ---------------------------------------------------------------------------
revoke all on function public.mi__tunnel_unlink_moved() from public, anon, authenticated;
revoke all on function public.mi__tunnel_layout_json(public.mi_tunnel_layouts) from public, anon, authenticated;
revoke all on function public.mi__tunnel_items_json(uuid) from public, anon, authenticated;

revoke all on function public.mi_tunnel_get(uuid, integer) from public, anon;
revoke all on function public.mi_tunnel_templates() from public, anon;
revoke all on function public.mi_tunnel_template(uuid) from public, anon;
revoke all on function public.mi_tunnel_save(jsonb) from public, anon;
revoke all on function public.mi_tunnel_link_item(uuid, uuid) from public, anon;
revoke all on function public.mi_tunnel_apply(uuid, uuid[], jsonb, boolean) from public, anon;
revoke all on function public.mi_tunnel_delete(uuid) from public, anon;
revoke all on function public.mi_equipment_detail(uuid) from public, anon;
grant execute on function public.mi_tunnel_get(uuid, integer) to authenticated;
grant execute on function public.mi_tunnel_templates() to authenticated;
grant execute on function public.mi_tunnel_template(uuid) to authenticated;
grant execute on function public.mi_tunnel_save(jsonb) to authenticated;
grant execute on function public.mi_tunnel_link_item(uuid, uuid) to authenticated;
grant execute on function public.mi_tunnel_apply(uuid, uuid[], jsonb, boolean) to authenticated;
grant execute on function public.mi_tunnel_delete(uuid) to authenticated;
grant execute on function public.mi_equipment_detail(uuid) to authenticated;
