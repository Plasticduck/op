-- Maintenance Inventory: equipment, run the way IT Inventory runs devices
-- (docs/maintenance-inventory/EQUIPMENT.md). Adds:
--   - a history of every change to a machine (mi_equipment_events, written by a trigger,
--     so edits from the older Assets page show up too),
--   - retire instead of delete: a machine with maintenance history can't be deleted,
--     which also stops a parent's delete from cascading through its components,
--   - saved list views,
--   - a use counter: cars washed at the site since the machine went in or was last
--     replaced (site_daily_metrics, the same count as the dashboards and the
--     Maintenance Log's car schedules),
--   - the equipment screens' functions (list, detail, save, clone, bulk changes,
--     retire, restore, timeline, restart the counter).
-- Same access as the rest of the module: mi_members decides what a person reaches and
-- writes go through these functions.

-- ---- Columns --------------------------------------------------------------------
alter table public.equipment
  add column if not exists usage_basis text not null default 'all_cars',
  -- Reserved: wash packages that run this machine (tire shine only on some). Counted
  -- as every car until package counts are stored.
  add column if not exists usage_packages text[],
  add column if not exists last_audited_at timestamptz,
  add column if not exists retired_at timestamptz;
alter table public.equipment drop constraint if exists equipment_usage_basis_check;
alter table public.equipment add constraint equipment_usage_basis_check check (usage_basis in ('all_cars', 'packages', 'none'));

-- A "Replaced" log entry restarts the machine's use counter. Voiding it puts the
-- counter back, because the start is worked out from the live entries every time.
alter table public.mi_log_entries add column if not exists resets_usage boolean not null default false;
create index if not exists mi_log_asset_resets on public.mi_log_entries (asset_id, performed_at desc) where resets_usage and voided_at is null;

create index if not exists site_daily_metrics_site_date on public.site_daily_metrics (account_id, site_number, date);
create index if not exists work_orders_equipment on public.work_orders (equipment_id) where equipment_id is not null;

-- ---- History ----------------------------------------------------------------------
-- No foreign key on equipment_id: the history outlives the machine.
create table public.mi_equipment_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid,
  equipment_id uuid not null,
  action text not null check (action in (
    'created', 'updated', 'status_changed', 'retired', 'restored', 'moved_site', 'moved_zone', 'parent_changed',
    'cloned', 'imported', 'tag_applied', 'tag_retired', 'label_printed', 'audited', 'problem_reported',
    'diagram_linked', 'diagram_unlinked', 'deleted')),
  actor_user_id uuid,
  actor_name text,
  before jsonb,
  after jsonb,
  note text,
  created_at timestamptz not null default now()
);
create index mi_equipment_events_asset on public.mi_equipment_events (equipment_id, created_at desc);
create index mi_equipment_events_account on public.mi_equipment_events (account_id, created_at desc);

alter table public.mi_equipment_events enable row level security;
revoke all on public.mi_equipment_events from anon;
revoke insert, update, delete, truncate on public.mi_equipment_events from authenticated;
create policy mi_equipment_events_select on public.mi_equipment_events for select
  using (account_id = auth_account_id() and public.mi_rank() >= 1 and location_id = any ((select public.auth_site_ids())::uuid[]));

-- Who did it: the signed-in person, or what the calling function says (a public
-- sticker report, an import).
create or replace function public.mi__actor_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select u.name from public.users u where u.id = p_user), nullif(current_setting('mi.actor', true), ''))
$$;

create or replace function public.mi__equipment_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := case when tg_op = 'DELETE' then old.account_id else new.account_id end;
  act text := nullif(current_setting('mi.action', true), '');
  note text := nullif(current_setting('mi.note', true), '');
  -- Bookkeeping columns that change on their own; not worth a line in the history.
  skip text[] := array['updated_at', 'last_serviced_at', 'qr_code', 'asset_number', 'created_at', 'retired_at'];
  who uuid := auth.uid();
  o jsonb;
  n jsonb;
  b jsonb := '{}'::jsonb;
  a jsonb := '{}'::jsonb;
  k text;
  nk integer;
begin
  -- Only accounts that use Maintenance Inventory keep this history.
  if not exists (select 1 from public.mi_settings s where s.account_id = acct) then return null; end if;

  if tg_op = 'INSERT' then
    insert into public.mi_equipment_events (account_id, location_id, equipment_id, action, actor_user_id, actor_name, after, note)
    values (acct, new.location_id, new.id, coalesce(act, 'created'), who, public.mi__actor_name(who),
            jsonb_strip_nulls(jsonb_build_object('name', new.name, 'type', new.type, 'parent_asset_id', new.parent_asset_id)), note);
    return null;
  end if;

  if tg_op = 'DELETE' then
    insert into public.mi_equipment_events (account_id, location_id, equipment_id, action, actor_user_id, actor_name, before)
    values (acct, old.location_id, old.id, 'deleted', who, public.mi__actor_name(who),
            jsonb_strip_nulls(jsonb_build_object('name', old.name, 'type', old.type)));
    return null;
  end if;

  o := to_jsonb(old) - skip;
  n := to_jsonb(new) - skip;
  for k in select jsonb_object_keys(n) loop
    if (o -> k) is distinct from (n -> k) then
      b := b || jsonb_build_object(k, o -> k);
      a := a || jsonb_build_object(k, n -> k);
    end if;
  end loop;
  if a = '{}'::jsonb then return null; end if;
  nk := (select count(*) from jsonb_object_keys(a));
  act := coalesce(act, case
    when a ? 'status' and new.status = 'retired' then 'retired'
    when a ? 'status' and old.status = 'retired' then 'restored'
    when a ? 'location_id' then 'moved_site'
    when nk = 1 and a ? 'status' then 'status_changed'
    when nk = 1 and a ? 'area_id' then 'moved_zone'
    when nk = 1 and a ? 'parent_asset_id' then 'parent_changed'
    else 'updated' end);
  insert into public.mi_equipment_events (account_id, location_id, equipment_id, action, actor_user_id, actor_name, before, after, note)
  values (acct, new.location_id, new.id, act, who, public.mi__actor_name(who), b, a, note);
  return null;
end;
$$;

drop trigger if exists equipment_mi_log on public.equipment;
create trigger equipment_mi_log after insert or update or delete on public.equipment
  for each row execute function public.mi__equipment_log();

-- ---- Retire, don't delete ---------------------------------------------------------
-- A machine with work, parts, schedules or a sticker behind it is retired, never
-- deleted. Deleting a parent would otherwise take every component with it
-- (parent_asset_id cascades). Removing sample data and admin clean-up set mi.allow_delete.
create or replace function public.mi__equipment_delete_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('mi.allow_delete', true) = 'on' or current_setting('mi.purge', true) = 'on' then return old; end if;
  if not exists (select 1 from public.mi_settings s where s.account_id = old.account_id) then return old; end if;
  if exists (select 1 from public.mi_log_entries g where g.asset_id = old.id)
     or exists (select 1 from public.mi_inventory_transactions m where m.asset_id = old.id)
     or exists (select 1 from public.mi_schedules s where s.asset_id = old.id)
     or exists (select 1 from public.mi_tags t where t.entity_type = 'asset' and t.entity_id = old.id)
     or exists (select 1 from public.work_orders w where w.equipment_id = old.id) then
    raise exception '% has history in Maintenance Inventory. Retire it instead.', old.name using errcode = '23503';
  end if;
  return old;
end;
$$;

drop trigger if exists equipment_mi_delete_guard on public.equipment;
create trigger equipment_mi_delete_guard before delete on public.equipment
  for each row execute function public.mi__equipment_delete_guard();

-- ---- Saved views --------------------------------------------------------------------
create table public.mi_saved_views (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  entity text not null default 'equipment' check (entity in ('equipment')),
  name text not null check (length(trim(name)) between 1 and 60),
  params jsonb not null default '{}'::jsonb,
  is_shared boolean not null default false,
  created_at timestamptz not null default now()
);
create index mi_saved_views_account on public.mi_saved_views (account_id, entity);

alter table public.mi_saved_views enable row level security;
revoke all on public.mi_saved_views from anon;
create policy mi_saved_views_select on public.mi_saved_views for select
  using (account_id = auth_account_id() and public.mi_rank() >= 1 and (user_id = auth.uid() or is_shared));
create policy mi_saved_views_insert on public.mi_saved_views for insert
  with check (account_id = auth_account_id() and public.mi_rank() >= 1 and user_id = auth.uid() and (not is_shared or public.mi_rank() >= 2));
create policy mi_saved_views_update on public.mi_saved_views for update
  using (account_id = auth_account_id() and (user_id = auth.uid() or (is_shared and public.mi_rank() >= 4)))
  with check (account_id = auth_account_id() and (not is_shared or public.mi_rank() >= 2));
create policy mi_saved_views_delete on public.mi_saved_views for delete
  using (account_id = auth_account_id() and (user_id = auth.uid() or (is_shared and public.mi_rank() >= 4)));
grant select, insert, update, delete on public.mi_saved_views to authenticated;

-- ---- Zones --------------------------------------------------------------------------
-- Zones are per site (mi_areas). Picking one by name finds that site's zone or makes it,
-- so "Dryers" means the same thing at every site.
create or replace function public.mi__area_for(p_account uuid, p_site uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  nm text := nullif(trim(p_name), '');
  v uuid;
begin
  if nm is null then return null; end if;
  if length(nm) > 60 then raise exception 'Keep zone names under 60 characters.'; end if;
  select id into v from public.mi_areas where site_id = p_site and lower(name) = lower(nm) limit 1;
  if v is not null then return v; end if;
  insert into public.mi_areas (account_id, site_id, name, sort_order)
  values (p_account, p_site, nm, coalesce((select max(sort_order) + 1 from public.mi_areas where site_id = p_site), 0))
  on conflict (site_id, name) do update set name = excluded.name
  returning id into v;
  return v;
end;
$$;

-- ---- Use counter ------------------------------------------------------------------
-- Cars washed at the machine's site: DRB less test cars, plus FlexWash, by day. Counted
-- from the later of the install date and the last live "Replaced" entry, that day
-- included. Without either, the windows (30 days, 12 months, everything stored) still
-- say how hard the site runs it.
create or replace function public.mi__usage(p_account uuid, p_assets uuid[])
returns table (asset_id uuid, basis text, since date, since_source text, cars_since numeric, cars_today numeric, cars_30d numeric,
               cars_12m numeric, cars_all numeric, data_from date, data_through date, state text)
language sql stable security definer set search_path = public as $$
  with a as (
    select e.id, e.usage_basis, e.install_date, public.mi__site_number(e.location_id) as site_no,
      (select max(public.mi__local_date(p_account, g.performed_at)) from public.mi_log_entries g
       where g.asset_id = e.id and g.resets_usage and g.voided_at is null) as reset_on
    from public.equipment e
    where e.account_id = p_account and e.id = any (p_assets)
  ),
  d as (select public.mi__today(p_account) as today),
  s as (
    select x.site_no, min(m.date) as data_from, max(m.date) as data_through,
      sum(m.cars) as cars_all,
      sum(m.cars) filter (where m.date > d.today - 30) as cars_30d,
      sum(m.cars) filter (where m.date > d.today - 365) as cars_12m,
      sum(m.cars) filter (where m.date = d.today) as cars_today
    from (select distinct site_no from a where site_no is not null) x
    cross join d
    join lateral (
      select mm.date, coalesce(mm.drb_cars, 0) - coalesce(mm.drb_test_cars, 0) + coalesce(mm.flex_cars, 0) as cars
      from public.site_daily_metrics mm where mm.account_id = p_account and mm.site_number = x.site_no
    ) m on true
    group by x.site_no, d.today
  )
  select a.id, a.usage_basis,
    greatest(a.install_date, a.reset_on),
    case when a.reset_on is not null and (a.install_date is null or a.reset_on >= a.install_date) then 'reset'
         when a.install_date is not null then 'install' end,
    case when greatest(a.install_date, a.reset_on) is not null and s.site_no is not null then (
      select coalesce(sum(coalesce(mm.drb_cars, 0) - coalesce(mm.drb_test_cars, 0) + coalesce(mm.flex_cars, 0)), 0)
      from public.site_daily_metrics mm
      where mm.account_id = p_account and mm.site_number = a.site_no and mm.date >= greatest(a.install_date, a.reset_on)) end,
    coalesce(s.cars_today, 0), s.cars_30d, s.cars_12m, s.cars_all, s.data_from, s.data_through,
    case when a.usage_basis = 'none' then 'not_counted'
         when a.site_no is null then 'no_site_number'
         when s.site_no is null then 'no_data'
         else 'ok' end
  from a left join s on s.site_no = a.site_no
$$;

-- ---- The list ---------------------------------------------------------------------
-- Every machine and component at the caller's sites in one call; the screen filters,
-- sorts and pages it (the IT Inventory list works the same way).
create or replace function public.mi_equipment_list(p_include_retired boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  sites uuid[] := public.auth_site_ids();
  today date := public.mi__today(acct);
begin
  return jsonb_build_object(
    'today', today,
    'rows', (
      with eq as (
        select e.* from public.equipment e
        where e.account_id = acct and e.location_id = any (sites) and (p_include_retired or e.status <> 'retired')
      ),
      resets as (
        select g.asset_id, max(public.mi__local_date(acct, g.performed_at)) as on_date
        from public.mi_log_entries g
        where g.account_id = acct and g.resets_usage and g.voided_at is null and g.asset_id is not null
        group by 1
      ),
      kids as (
        select x.parent_asset_id as id, count(*) as n from public.equipment x
        where x.account_id = acct and x.parent_asset_id is not null and x.status <> 'retired' group by 1
      ),
      bom as (select pa.asset_id as id, count(*) as n from public.part_assets pa join eq on eq.id = pa.asset_id group by 1),
      wos as (
        select w.equipment_id as id, count(*) as n from public.work_orders w
        where w.account_id = acct and w.equipment_id is not null and w.status in ('open', 'in_progress', 'on_hold') group by 1
      )
      select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', e.id, 'location_id', e.location_id, 'name', e.name, 'type', e.type, 'status', e.status, 'parent_id', e.parent_asset_id,
        'area_id', e.area_id, 'crit_class', e.crit_class, 'manufacturer', e.manufacturer, 'model', e.model, 'serial_number', e.serial_number,
        'asset_number', e.asset_number, 'install_date', e.install_date, 'warranty_expiry', e.warranty_expiry,
        'last_serviced_at', e.last_serviced_at, 'last_audited_at', e.last_audited_at, 'retired_at', e.retired_at,
        'usage_basis', e.usage_basis, 'maintainx_id', e.maintainx_id,
        'tag', t.code, 'tag_printed', t.printed_count > 0,
        'children', coalesce(k.n, 0), 'bom_lines', coalesce(b.n, 0), 'open_wos', coalesce(w.n, 0),
        'usage_since', u.since,
        'cars_since', case when u.since is not null and e.usage_basis <> 'none' then (
          select coalesce(sum(coalesce(m.drb_cars, 0) - coalesce(m.drb_test_cars, 0) + coalesce(m.flex_cars, 0)), 0)
          from public.site_daily_metrics m
          where m.account_id = acct and m.site_number = public.mi__site_number(e.location_id) and m.date >= u.since and m.date <= today) end
      ))), '[]'::jsonb)
      from eq e
      left join public.mi_tags t on t.entity_type = 'asset' and t.entity_id = e.id
      left join kids k on k.id = e.id
      left join bom b on b.id = e.id
      left join wos w on w.id = e.id
      left join resets r on r.asset_id = e.id
      cross join lateral (select greatest(e.install_date, r.on_date) as since) u
    ),
    'areas', (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'site_id', a.site_id, 'name', a.name, 'sort_order', a.sort_order)
             order by a.sort_order, a.name), '[]'::jsonb)
      from public.mi_areas a where a.account_id = acct and a.site_id = any (sites)
    ),
    -- Each site's last 30 days of cars, for the overview and the "cars" column.
    'sites', (
      select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'site_number', sn.n, 'cars_30d', c.c30, 'data_through', c.last)
             order by l.name), '[]'::jsonb)
      from public.locations l
      cross join lateral (select public.mi__site_number(l.id) as n) sn
      left join lateral (
        select sum(coalesce(m.drb_cars, 0) - coalesce(m.drb_test_cars, 0) + coalesce(m.flex_cars, 0)) as c30, max(m.date) as last
        from public.site_daily_metrics m where m.account_id = acct and m.site_number = sn.n and m.date > today - 30
      ) c on true
      where l.id = any (sites)
    )
  );
end;
$$;

-- ---- One machine --------------------------------------------------------------------
-- The inventory's asset screen (mi_asset_detail, still used by the scan sheet) plus
-- the use counter, where it sits in the machine tree, and what the caller may do.
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
    'diagram', '[]'::jsonb);
end;
$$;

-- ---- Add and edit ---------------------------------------------------------------------
-- One function for both. Only the keys sent change. The site is set when it's added;
-- moving it to another site is mi_equipment_bulk(..., 'site').
create or replace function public.mi_equipment_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  sites uuid[] := public.auth_site_ids();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  e public.equipment;
  v_site uuid;
  v_name text;
  v_parent uuid;
  v_area uuid;
  v_status text;
  v_crit text;
  v_basis text;
  v_vendor uuid;
begin
  perform public.mi__require_rank(2, case when v_id is null then 'add equipment' else 'edit equipment' end);

  if v_id is not null then
    select * into e from public.equipment where id = v_id and account_id = acct for update;
    if not found or not e.location_id = any (sites) then raise exception 'Equipment not found.'; end if;
    v_site := e.location_id;
    if p ? 'location_id' and nullif(p ->> 'location_id', '')::uuid is distinct from e.location_id then
      raise exception 'Use Move to take equipment to another site.';
    end if;
  else
    v_site := nullif(p ->> 'location_id', '')::uuid;
    if v_site is null or not v_site = any (sites) then raise exception 'Pick one of your sites.' using errcode = '42501'; end if;
  end if;

  if v_id is null or p ? 'name' then
    v_name := nullif(trim(coalesce(p ->> 'name', '')), '');
    if v_name is null then raise exception 'Give it a name.'; end if;
    if length(v_name) > 120 then raise exception 'Keep the name under 120 characters.'; end if;
  end if;

  if p ? 'parent_asset_id' then
    v_parent := nullif(p ->> 'parent_asset_id', '')::uuid;
    if v_parent is not null then
      if v_parent = v_id then raise exception 'A machine can''t be part of itself.'; end if;
      if not exists (select 1 from public.equipment where id = v_parent and account_id = acct and location_id = v_site) then
        raise exception 'The machine it''s part of has to be at the same site.';
      end if;
      if v_id is not null and exists (
        with recursive up as (
          select x.id, x.parent_asset_id, 1 as depth from public.equipment x where x.id = v_parent
          union all
          select x.id, x.parent_asset_id, up.depth + 1 from public.equipment x join up on x.id = up.parent_asset_id where up.depth < 50
        )
        select 1 from up where up.id = v_id) then
        raise exception 'That would make it part of one of its own components.';
      end if;
    end if;
  end if;

  if nullif(trim(coalesce(p ->> 'area_name', '')), '') is not null then
    v_area := public.mi__area_for(acct, v_site, p ->> 'area_name');
  elsif p ? 'area_id' then
    v_area := nullif(p ->> 'area_id', '')::uuid;
    if v_area is not null and not exists (select 1 from public.mi_areas where id = v_area and site_id = v_site) then
      raise exception 'That zone is at another site.';
    end if;
  end if;

  if p ? 'status' then
    v_status := p ->> 'status';
    if v_status not in ('online', 'offline_planned', 'offline_unplanned') then raise exception 'Pick a status. Use Retire to take a machine out of service for good.'; end if;
  end if;
  if p ? 'crit_class' then
    v_crit := nullif(p ->> 'crit_class', '');
    if v_crit is not null and v_crit not in ('A', 'B', 'C') then raise exception 'Criticality is A, B or C.'; end if;
  end if;
  if p ? 'usage_basis' then
    v_basis := p ->> 'usage_basis';
    if v_basis not in ('all_cars', 'packages', 'none') then raise exception 'Pick how its use is counted.'; end if;
  end if;
  if p ? 'vendor_id' then
    v_vendor := nullif(p ->> 'vendor_id', '')::uuid;
    if v_vendor is not null and not exists (select 1 from public.vendors where id = v_vendor and account_id = acct) then
      raise exception 'Vendor not found.';
    end if;
  end if;

  if v_id is null then
    insert into public.equipment (account_id, location_id, name, type, description, status, parent_asset_id, area_id, vendor_id,
      crit_class, criticality, manufacturer, model, serial_number, purchase_date, install_date, warranty_expiry, usage_basis)
    values (acct, v_site, v_name, nullif(trim(coalesce(p ->> 'type', '')), ''), nullif(trim(coalesce(p ->> 'description', '')), ''),
      coalesce(v_status, 'online'), v_parent, v_area, v_vendor, v_crit,
      case v_crit when 'A' then 'high' when 'B' then 'medium' when 'C' then 'low' else 'none' end,
      nullif(trim(coalesce(p ->> 'manufacturer', '')), ''), nullif(trim(coalesce(p ->> 'model', '')), ''),
      nullif(trim(coalesce(p ->> 'serial_number', '')), ''),
      nullif(p ->> 'purchase_date', '')::date, nullif(p ->> 'install_date', '')::date, nullif(p ->> 'warranty_expiry', '')::date,
      coalesce(v_basis, 'all_cars'))
    returning * into e;
  else
    update public.equipment set
      name = coalesce(v_name, name),
      type = case when p ? 'type' then nullif(trim(coalesce(p ->> 'type', '')), '') else type end,
      description = case when p ? 'description' then nullif(trim(coalesce(p ->> 'description', '')), '') else description end,
      status = case when p ? 'status' then v_status else status end,
      parent_asset_id = case when p ? 'parent_asset_id' then v_parent else parent_asset_id end,
      area_id = case when nullif(trim(coalesce(p ->> 'area_name', '')), '') is not null or p ? 'area_id' then v_area else area_id end,
      vendor_id = case when p ? 'vendor_id' then v_vendor else vendor_id end,
      crit_class = case when p ? 'crit_class' then v_crit else crit_class end,
      -- The older Assets page reads this one; keep the two in step.
      criticality = case when p ? 'crit_class' then (case v_crit when 'A' then 'high' when 'B' then 'medium' when 'C' then 'low' else 'none' end) else criticality end,
      manufacturer = case when p ? 'manufacturer' then nullif(trim(coalesce(p ->> 'manufacturer', '')), '') else manufacturer end,
      model = case when p ? 'model' then nullif(trim(coalesce(p ->> 'model', '')), '') else model end,
      serial_number = case when p ? 'serial_number' then nullif(trim(coalesce(p ->> 'serial_number', '')), '') else serial_number end,
      purchase_date = case when p ? 'purchase_date' then nullif(p ->> 'purchase_date', '')::date else purchase_date end,
      install_date = case when p ? 'install_date' then nullif(p ->> 'install_date', '')::date else install_date end,
      warranty_expiry = case when p ? 'warranty_expiry' then nullif(p ->> 'warranty_expiry', '')::date else warranty_expiry end,
      usage_basis = case when p ? 'usage_basis' then v_basis else usage_basis end
    where id = v_id
    returning * into e;
  end if;
  return jsonb_build_object('id', e.id, 'name', e.name);
end;
$$;

-- Copies one machine (and its components) under a parent. Serial numbers, dates and
-- MaintainX links stay behind: it's a new unit.
create or replace function public.mi__clone_one(p_src uuid, p_parent uuid, p_name text, p_children boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s public.equipment;
  v uuid;
  c record;
begin
  select * into s from public.equipment where id = p_src;
  insert into public.equipment (account_id, location_id, name, type, description, status, parent_asset_id, area_id, vendor_id,
    crit_class, criticality, manufacturer, model, usage_basis, usage_packages)
  values (s.account_id, s.location_id, p_name, s.type, s.description, 'online', p_parent, s.area_id, s.vendor_id,
    s.crit_class, s.criticality, s.manufacturer, s.model, s.usage_basis, s.usage_packages)
  returning id into v;
  insert into public.part_assets (part_id, asset_id, qty_per, notes)
  select pa.part_id, v, pa.qty_per, pa.notes from public.part_assets pa where pa.asset_id = p_src;
  if p_children then
    for c in select id, name from public.equipment where parent_asset_id = p_src and status <> 'retired' order by name loop
      perform public.mi__clone_one(c.id, v, c.name, true);
    end loop;
  end if;
  return v;
end;
$$;

create or replace function public.mi_equipment_clone(p_asset uuid, p_count integer default 1, p_with_children boolean default true, p_names text[] default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  s public.equipment;
  out jsonb := '[]'::jsonb;
  nm text;
  v uuid;
begin
  perform public.mi__require_rank(2, 'add equipment');
  select * into s from public.equipment where id = p_asset and account_id = acct;
  if not found or not s.location_id = any (public.auth_site_ids()) then raise exception 'Equipment not found.'; end if;
  if p_count is null or p_count < 1 or p_count > 50 then raise exception 'Make between 1 and 50 copies.'; end if;
  perform set_config('mi.action', 'cloned', true);
  for i in 1..p_count loop
    nm := coalesce(nullif(trim(coalesce(p_names[i], '')), ''), s.name || ' (copy' || case when p_count > 1 then ' ' || i else '' end || ')');
    v := public.mi__clone_one(s.id, s.parent_asset_id, left(nm, 120), p_with_children);
    out := out || jsonb_build_array(jsonb_build_object('id', v, 'name', nm));
  end loop;
  perform set_config('mi.action', '', true);
  return out;
end;
$$;

-- ---- Bulk changes ---------------------------------------------------------------------
-- status | crit | zone (by name, made at each site that lacks it) | site (whole machines,
-- components follow; a director's call).
create or replace function public.mi_equipment_bulk(p_ids uuid[], p_op text, p_value text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  sites uuid[] := public.auth_site_ids();
  ids uuid[];
  all_ids uuid[];
  target uuid;
  n integer := 0;
  m integer;
  r record;
  v_area uuid;
begin
  perform public.mi__require_rank(case when p_op = 'site' then 4 else 2 end,
    case when p_op = 'site' then 'move equipment between sites' else 'change equipment' end);
  select array_agg(id) into ids from public.equipment where account_id = acct and id = any (p_ids) and location_id = any (sites);
  if ids is null then raise exception 'Nothing to change.'; end if;

  if p_op = 'status' then
    if p_value not in ('online', 'offline_planned', 'offline_unplanned') then raise exception 'Pick a status.'; end if;
    update public.equipment set status = p_value where id = any (ids) and status not in ('retired', p_value);
    get diagnostics n = row_count;
  elsif p_op = 'crit' then
    if nullif(p_value, '') is not null and p_value not in ('A', 'B', 'C') then raise exception 'Criticality is A, B or C.'; end if;
    update public.equipment set crit_class = nullif(p_value, ''),
      criticality = case nullif(p_value, '') when 'A' then 'high' when 'B' then 'medium' when 'C' then 'low' else 'none' end
    where id = any (ids) and crit_class is distinct from nullif(p_value, '');
    get diagnostics n = row_count;
  elsif p_op = 'zone' then
    for r in select id, location_id, area_id from public.equipment where id = any (ids) loop
      v_area := public.mi__area_for(acct, r.location_id, p_value);
      if r.area_id is distinct from v_area then
        update public.equipment set area_id = v_area where id = r.id;
        n := n + 1;
      end if;
    end loop;
  elsif p_op = 'site' then
    target := nullif(p_value, '')::uuid;
    if target is null or not target = any (sites) then raise exception 'Pick one of your sites.'; end if;
    with recursive tree as (
      select x.id from public.equipment x where x.id = any (ids)
      union
      select x.id from public.equipment x join tree on x.parent_asset_id = tree.id
    )
    select array_agg(id) into all_ids from tree;
    for r in select id, area_id, parent_asset_id from public.equipment where id = any (all_ids) and location_id <> target loop
      update public.equipment set
        location_id = target,
        -- Same-named zone at the new site, if it has one.
        area_id = (select a2.id from public.mi_areas a1 join public.mi_areas a2 on a2.site_id = target and lower(a2.name) = lower(a1.name) where a1.id = r.area_id limit 1),
        parent_asset_id = case when r.parent_asset_id = any (all_ids) then r.parent_asset_id end
      where id = r.id;
      get diagnostics m = row_count;
      n := n + m;
    end loop;
  else
    raise exception 'Unknown change.';
  end if;
  return jsonb_build_object('changed', n);
end;
$$;

-- ---- Retire and restore ----------------------------------------------------------------
-- A retired machine takes its components with it. Nothing is deleted; history stays.
create or replace function public.mi_equipment_retire(p_ids uuid[], p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  all_ids uuid[];
  n integer;
begin
  perform public.mi__require_rank(2, 'retire equipment');
  with recursive tree as (
    select x.id from public.equipment x where x.account_id = acct and x.id = any (p_ids) and x.location_id = any (public.auth_site_ids())
    union
    select x.id from public.equipment x join tree on x.parent_asset_id = tree.id
  )
  select array_agg(id) into all_ids from tree;
  if all_ids is null then raise exception 'Nothing to retire.'; end if;
  perform set_config('mi.note', coalesce(nullif(trim(coalesce(p_note, '')), ''), ''), true);
  update public.equipment set status = 'retired', retired_at = now() where id = any (all_ids) and status <> 'retired';
  get diagnostics n = row_count;
  perform set_config('mi.note', '', true);
  return jsonb_build_object('retired', n);
end;
$$;

create or replace function public.mi_equipment_restore(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  all_ids uuid[];
  n integer;
begin
  perform public.mi__require_rank(2, 'restore equipment');
  with recursive tree as (
    select x.id from public.equipment x where x.account_id = acct and x.id = any (p_ids) and x.location_id = any (public.auth_site_ids())
    union
    select x.id from public.equipment x join tree on x.parent_asset_id = tree.id
  )
  select array_agg(id) into all_ids from tree;
  if all_ids is null then raise exception 'Nothing to restore.'; end if;
  update public.equipment set status = 'online', retired_at = null where id = any (all_ids) and status = 'retired';
  get diagnostics n = row_count;
  return jsonb_build_object('restored', n);
end;
$$;

-- ---- Timeline -------------------------------------------------------------------------
-- Everything that happened to one machine, newest first: changes, logged work, work
-- orders and parts. Closed work orders already show as their log entry.
create or replace function public.mi_equipment_timeline(p_asset uuid, p_limit integer default 150) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
begin
  if not exists (select 1 from public.equipment e where e.id = p_asset and e.account_id = acct and e.location_id = any (public.auth_site_ids())) then
    raise exception 'Equipment not found.';
  end if;
  return (
    select coalesce(jsonb_agg(q.x order by q.at desc), '[]'::jsonb) from (
      select u.x, u.at from (
        select jsonb_build_object('kind', 'event', 'at', ev.created_at, 'action', ev.action, 'before', ev.before, 'after', ev.after,
                 'note', ev.note, 'by', ev.actor_name) as x, ev.created_at as at
        from public.mi_equipment_events ev where ev.account_id = acct and ev.equipment_id = p_asset
        union all
        select jsonb_build_object('kind', 'log', 'at', g.performed_at, 'id', g.id, 'entry_type', g.entry_type, 'title', g.title, 'result', g.result,
                 'notes', g.notes, 'by', g.performed_by_name, 'resets_usage', g.resets_usage, 'voided', g.voided_at is not null,
                 'downtime_minutes', g.downtime_minutes, 'work_order_id', g.work_order_id), g.performed_at
        from public.mi_log_entries g where g.account_id = acct and g.asset_id = p_asset
        union all
        select jsonb_build_object('kind', 'wo', 'what', 'opened', 'at', w.created_at, 'id', w.id, 'number', w.number, 'title', w.title,
                 'status', w.status, 'by', coalesce(w.created_by_name, w.requested_by_name)), w.created_at
        from public.work_orders w where w.account_id = acct and w.equipment_id = p_asset
        union all
        select jsonb_build_object('kind', 'wo', 'what', 'closed', 'at', w.completed_at, 'id', w.id, 'number', w.number, 'title', w.title,
                 'status', w.status), w.completed_at
        from public.work_orders w
        where w.account_id = acct and w.equipment_id = p_asset and w.completed_at is not null
          and not exists (select 1 from public.mi_log_entries g where g.work_order_id = w.id)
        union all
        select jsonb_build_object('kind', 'part', 'at', m.created_at, 'type', m.type, 'part_id', p.id, 'part_name', p.name, 'qty', -m.qty,
                 'cost', round(-m.qty * m.unit_cost, 2), 'work_order_id', m.work_order_id), m.created_at
        from public.mi_inventory_transactions m join public.parts p on p.id = m.part_id
        where m.account_id = acct and m.asset_id = p_asset and m.type in ('issue', 'return')
      ) u
      order by u.at desc
      limit greatest(1, least(coalesce(p_limit, 150), 500))
    ) q
  );
end;
$$;

-- ---- Restart the use counter -----------------------------------------------------------
-- "Replaced": a log entry (so it shows with the rest of the machine's work) that also
-- restarts the counter from that day.
create or replace function public.mi_reset_usage(p_asset uuid, p_on date default null, p_note text default null, p_client_txn_id text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  e public.equipment;
  today date := public.mi__today(acct);
  at_time timestamptz;
  res jsonb;
begin
  select * into e from public.equipment where id = p_asset and account_id = acct;
  if not found or not e.location_id = any (public.auth_site_ids()) then raise exception 'Equipment not found.'; end if;
  if e.status = 'retired' then raise exception '% is retired. Restore it first.', e.name; end if;
  if p_on is not null and p_on > today then raise exception 'Pick today or an earlier day.'; end if;
  at_time := case when p_on is null or p_on = today then now()
    else (p_on::timestamp + time '12:00') at time zone coalesce((select timezone from public.mi_settings where account_id = acct), 'America/Chicago') end;
  res := public.mi_log_add(jsonb_build_object(
    'site_id', e.location_id, 'asset_id', e.id, 'entry_type', 'replacement', 'title', 'Replaced',
    'notes', nullif(trim(coalesce(p_note, '')), ''), 'performed_at', at_time), 'web', p_client_txn_id);
  if not coalesce((res ->> 'deduped')::boolean, false) then
    update public.mi_log_entries set resets_usage = true where id = (res ->> 'id')::uuid;
  end if;
  return res;
end;
$$;

-- ---- Grants ---------------------------------------------------------------------------
revoke all on function public.mi__actor_name(uuid) from public, anon, authenticated;
revoke all on function public.mi__equipment_log() from public, anon, authenticated;
revoke all on function public.mi__equipment_delete_guard() from public, anon, authenticated;
revoke all on function public.mi__area_for(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.mi__usage(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.mi__clone_one(uuid, uuid, text, boolean) from public, anon, authenticated;

revoke all on function public.mi_equipment_list(boolean) from public, anon;
revoke all on function public.mi_equipment_detail(uuid) from public, anon;
revoke all on function public.mi_equipment_save(jsonb) from public, anon;
revoke all on function public.mi_equipment_clone(uuid, integer, boolean, text[]) from public, anon;
revoke all on function public.mi_equipment_bulk(uuid[], text, text) from public, anon;
revoke all on function public.mi_equipment_retire(uuid[], text) from public, anon;
revoke all on function public.mi_equipment_restore(uuid[]) from public, anon;
revoke all on function public.mi_equipment_timeline(uuid, integer) from public, anon;
revoke all on function public.mi_reset_usage(uuid, date, text, text) from public, anon;
grant execute on function public.mi_equipment_list(boolean) to authenticated;
grant execute on function public.mi_equipment_detail(uuid) to authenticated;
grant execute on function public.mi_equipment_save(jsonb) to authenticated;
grant execute on function public.mi_equipment_clone(uuid, integer, boolean, text[]) to authenticated;
grant execute on function public.mi_equipment_bulk(uuid[], text, text) to authenticated;
grant execute on function public.mi_equipment_retire(uuid[], text) to authenticated;
grant execute on function public.mi_equipment_restore(uuid[]) to authenticated;
grant execute on function public.mi_equipment_timeline(uuid, integer) to authenticated;
grant execute on function public.mi_reset_usage(uuid, date, text, text) to authenticated;
