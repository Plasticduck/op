-- Maintenance Inventory: equipment audits, like IT Inventory's (0195).
--
-- Walk a site and scan each machine's sticker (or tick it off when it has none): found,
-- missing, at the wrong site, or a sticker nobody knows. Finishing records the audit on
-- every machine, moves machines found in another zone, and puts faded or missing
-- stickers in the print queue. One audit open per site; anyone at the site can join it.
-- Machines only: components travel with their machine.

create table public.mi_audit_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  scope text not null default 'all' check (scope in ('all', 'stickered')),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'cancelled')),
  started_by uuid default auth.uid(),
  started_by_name text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid,
  completed_by_name text,
  note text,
  summary jsonb
);
create unique index mi_audit_runs_one_open on public.mi_audit_runs (location_id) where status = 'in_progress';
create index mi_audit_runs_site on public.mi_audit_runs (location_id, started_at desc);

create table public.mi_audit_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.mi_audit_runs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  equipment_id uuid references public.equipment(id) on delete set null,
  tag text,
  -- On the list when the audit started (as opposed to found along the way).
  expected boolean not null,
  listed_area_id uuid references public.mi_areas(id) on delete set null,
  found_area_id uuid references public.mi_areas(id) on delete set null,
  result text not null default 'not_checked' check (result in ('not_checked', 'found', 'missing', 'wrong_site', 'unregistered')),
  other_site_id uuid references public.locations(id) on delete set null,
  sticker_condition text check (sticker_condition is null or sticker_condition in ('ok', 'faded', 'missing', 'damaged')),
  note text,
  checked_by uuid,
  checked_by_name text,
  checked_at timestamptz
);
create unique index mi_audit_items_machine on public.mi_audit_items (run_id, equipment_id) where equipment_id is not null;
create unique index mi_audit_items_tag on public.mi_audit_items (run_id, tag) where equipment_id is null;
create index mi_audit_items_run on public.mi_audit_items (run_id);

do $$
declare t text;
begin
  foreach t in array array['mi_audit_runs', 'mi_audit_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;
create policy mi_audit_runs_select on public.mi_audit_runs for select
  using (account_id = auth_account_id() and public.mi_rank() >= 1 and location_id = any ((select public.auth_site_ids())::uuid[]));
create policy mi_audit_items_select on public.mi_audit_items for select
  using (exists (select 1 from public.mi_audit_runs r where r.id = run_id));

create or replace function public.mi__audit_run(p_run uuid, p_open boolean default true) returns public.mi_audit_runs
language plpgsql stable security definer set search_path = public as $$
declare
  r public.mi_audit_runs;
begin
  select * into r from public.mi_audit_runs where id = p_run and account_id = public.mi__account();
  if not found or not r.location_id = any (public.auth_site_ids()) then raise exception 'Audit not found.'; end if;
  if p_open and r.status <> 'in_progress' then raise exception 'That audit is already %.', replace(r.status, '_', ' '); end if;
  return r;
end;
$$;

-- ---- Start or join -----------------------------------------------------------------
create or replace function public.mi_audit_start(p_site uuid, p_scope text default 'all') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  v uuid;
begin
  if not p_site = any (public.auth_site_ids()) then raise exception 'That site isn''t one of yours.' using errcode = '42501'; end if;
  if p_scope not in ('all', 'stickered') then raise exception 'Pick what to audit.'; end if;
  select id into v from public.mi_audit_runs where location_id = p_site and status = 'in_progress';
  if v is not null then return v; end if;
  begin
    insert into public.mi_audit_runs (account_id, location_id, scope, started_by_name)
    values (acct, p_site, p_scope, public.mi__actor_name(auth.uid()))
    returning id into v;
  exception when unique_violation then
    select id into v from public.mi_audit_runs where location_id = p_site and status = 'in_progress';
    return v;
  end;
  insert into public.mi_audit_items (run_id, account_id, equipment_id, tag, expected, listed_area_id)
  select v, acct, e.id, t.code, true, e.area_id
  from public.equipment e
  left join public.mi_tags t on t.entity_type = 'asset' and t.entity_id = e.id
  where e.account_id = acct and e.location_id = p_site and e.parent_asset_id is null and e.status <> 'retired'
    and (p_scope = 'all' or t.id is not null);
  return v;
end;
$$;

-- ---- Scanning a sticker on the walk --------------------------------------------------
-- found (or already found), wrong_site, blank (a sticker from the roll: put it on a
-- machine, then scan again), retired, unregistered (not one of ours or not on anything).
create or replace function public.mi_audit_scan(p_run uuid, p_code text, p_area uuid default null, p_condition text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  r public.mi_audit_runs := public.mi__audit_run(p_run);
  v_code text := upper(trim(p_code));
  t public.mi_tags;
  e public.equipment;
  it public.mi_audit_items;
  was_found boolean;
  who text := public.mi__actor_name(auth.uid());
begin
  if v_code = '' then raise exception 'Nothing scanned.'; end if;
  if p_area is not null and not exists (select 1 from public.mi_areas where id = p_area and site_id = r.location_id) then raise exception 'That zone is at another site.'; end if;
  if p_condition is not null and p_condition not in ('ok', 'faded', 'missing', 'damaged') then raise exception 'Unknown sticker condition.'; end if;
  select * into t from public.mi_tags where account_id = acct and code = v_code;
  if t.id is not null and t.status = 'unused' then return jsonb_build_object('result', 'blank', 'code', v_code); end if;
  if t.id is not null and t.status = 'retired' then return jsonb_build_object('result', 'retired', 'code', v_code); end if;
  if t.id is not null and t.entity_type = 'asset' then
    select * into e from public.equipment where id = t.entity_id;
  elsif t.id is null then
    select * into e from public.equipment where account_id = acct and upper(qr_code) = v_code limit 1;
  end if;

  if e.id is null then
    insert into public.mi_audit_items (run_id, account_id, tag, expected, found_area_id, result, sticker_condition, checked_by, checked_by_name, checked_at)
    values (r.id, acct, v_code, false, p_area, 'unregistered', p_condition, auth.uid(), who, now())
    on conflict (run_id, tag) where equipment_id is null do update set checked_at = now()
    returning * into it;
    return jsonb_build_object('result', 'unregistered', 'code', v_code, 'item_id', it.id);
  end if;

  if e.location_id <> r.location_id then
    insert into public.mi_audit_items (run_id, account_id, equipment_id, tag, expected, found_area_id, result, other_site_id, sticker_condition, checked_by, checked_by_name, checked_at)
    values (r.id, acct, e.id, v_code, false, p_area, 'wrong_site', e.location_id, p_condition, auth.uid(), who, now())
    on conflict (run_id, equipment_id) where equipment_id is not null do update set checked_at = now()
    returning * into it;
    return jsonb_build_object('result', 'wrong_site', 'code', v_code, 'item_id', it.id, 'name', e.name,
      'other_site', (select name from public.locations where id = e.location_id));
  end if;

  -- A component's sticker counts for its machine.
  if e.parent_asset_id is not null then
    with recursive up as (
      select x.id, x.parent_asset_id from public.equipment x where x.id = e.parent_asset_id
      union all
      select x.id, x.parent_asset_id from public.equipment x join up on x.id = up.parent_asset_id
    )
    select x.* into e from public.equipment x where x.id = (select id from up where parent_asset_id is null limit 1);
  end if;

  select * into it from public.mi_audit_items where run_id = r.id and equipment_id = e.id;
  if it.id is null then
    insert into public.mi_audit_items (run_id, account_id, equipment_id, tag, expected, listed_area_id, found_area_id, result, sticker_condition, checked_by, checked_by_name, checked_at)
    values (r.id, acct, e.id, v_code, false, e.area_id, coalesce(p_area, e.area_id), 'found', p_condition, auth.uid(), who, now())
    returning * into it;
    return jsonb_build_object('result', 'found', 'code', v_code, 'item_id', it.id, 'name', e.name, 'unlisted', true);
  end if;
  was_found := it.result = 'found';
  update public.mi_audit_items set result = 'found', found_area_id = coalesce(p_area, found_area_id, listed_area_id),
    sticker_condition = coalesce(p_condition, sticker_condition, case when t.id is not null then 'ok' end),
    checked_by = auth.uid(), checked_by_name = who, checked_at = now()
  where id = it.id
  returning * into it;
  return jsonb_build_object('result', 'found', 'code', v_code, 'item_id', it.id, 'name', e.name, 'again', was_found,
    'moved', it.found_area_id is distinct from it.listed_area_id);
end;
$$;

-- Ticking a machine off by hand (no sticker yet), or marking it missing.
create or replace function public.mi_audit_mark(p_item uuid, p_result text, p_condition text default null, p_area uuid default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  it public.mi_audit_items;
  r public.mi_audit_runs;
begin
  select * into it from public.mi_audit_items where id = p_item and account_id = public.mi__account() for update;
  if not found then raise exception 'Not on this audit.'; end if;
  r := public.mi__audit_run(it.run_id);
  if p_result not in ('not_checked', 'found', 'missing') then raise exception 'Mark it found, missing, or not checked.'; end if;
  if p_condition is not null and p_condition not in ('ok', 'faded', 'missing', 'damaged') then raise exception 'Unknown sticker condition.'; end if;
  if p_area is not null and not exists (select 1 from public.mi_areas where id = p_area and site_id = r.location_id) then raise exception 'That zone is at another site.'; end if;
  update public.mi_audit_items set
    result = case when it.result in ('wrong_site', 'unregistered') then it.result else p_result end,
    sticker_condition = coalesce(p_condition, sticker_condition),
    found_area_id = case when p_result = 'found' then coalesce(p_area, found_area_id, listed_area_id) else found_area_id end,
    note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note),
    checked_by = case when p_result = 'not_checked' then null else auth.uid() end,
    checked_by_name = case when p_result = 'not_checked' then null else public.mi__actor_name(auth.uid()) end,
    checked_at = case when p_result = 'not_checked' then null else now() end
  where id = it.id;
end;
$$;

-- ---- Finish and cancel ---------------------------------------------------------------
create or replace function public.mi_audit_complete(p_run uuid, p_note text default null, p_rest_missing boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  r public.mi_audit_runs := public.mi__audit_run(p_run);
  left_over integer;
  s jsonb;
  who text := public.mi__actor_name(auth.uid());
begin
  select count(*) into left_over from public.mi_audit_items where run_id = r.id and result = 'not_checked';
  if left_over > 0 and not p_rest_missing then
    raise exception '% machine% not checked yet. Check them, or finish and count them as missing.', left_over, case when left_over = 1 then ' is' else 's are' end;
  end if;
  update public.mi_audit_items set result = 'missing', checked_by = auth.uid(), checked_by_name = who, checked_at = now()
  where run_id = r.id and result = 'not_checked';

  perform set_config('mi.action', 'audited', true);
  perform set_config('mi.note', 'Audit of ' || (select name from public.locations where id = r.location_id), true);
  -- Found: audited today, and moved to the zone it was found in.
  update public.equipment e set last_audited_at = now(), area_id = coalesce(i.found_area_id, e.area_id)
  from public.mi_audit_items i
  where i.run_id = r.id and i.result = 'found' and i.equipment_id = e.id;
  perform set_config('mi.action', '', true);
  perform set_config('mi.note', '', true);
  -- Missing machines get a line in their history, but no change.
  insert into public.mi_equipment_events (account_id, location_id, equipment_id, action, actor_user_id, actor_name, note)
  select acct, r.location_id, i.equipment_id, 'audited', auth.uid(), who, 'Not found in the audit'
  from public.mi_audit_items i where i.run_id = r.id and i.result = 'missing' and i.equipment_id is not null;
  -- What the walk said about each sticker.
  update public.mi_tags t set condition = i.sticker_condition
  from public.mi_audit_items i
  where i.run_id = r.id and i.sticker_condition is not null and i.equipment_id is not null
    and t.entity_type = 'asset' and t.entity_id = i.equipment_id and t.status = 'applied';

  select jsonb_build_object(
    'expected', count(*) filter (where expected),
    'found', count(*) filter (where result = 'found'),
    'missing', count(*) filter (where result = 'missing'),
    'moved', count(*) filter (where result = 'found' and found_area_id is distinct from listed_area_id),
    'wrong_site', count(*) filter (where result = 'wrong_site'),
    'unregistered', count(*) filter (where result = 'unregistered'),
    'stickers_bad', count(*) filter (where sticker_condition in ('faded', 'missing', 'damaged')),
    'no_sticker', count(*) filter (where result = 'found' and tag is null))
  into s from public.mi_audit_items where run_id = r.id;
  update public.mi_audit_runs set status = 'completed', completed_at = now(), completed_by = auth.uid(), completed_by_name = who,
    note = nullif(trim(coalesce(p_note, '')), ''), summary = s
  where id = r.id;
  return s;
end;
$$;

create or replace function public.mi_audit_cancel(p_run uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.mi_audit_runs := public.mi__audit_run(p_run);
begin
  if r.started_by is distinct from auth.uid() and public.mi_rank() < 2 then
    raise exception 'Only whoever started it or a manager can cancel this audit.' using errcode = '42501';
  end if;
  update public.mi_audit_runs set status = 'cancelled', completed_at = now(), completed_by = auth.uid(), completed_by_name = public.mi__actor_name(auth.uid())
  where id = r.id;
end;
$$;

-- ---- Reading ----------------------------------------------------------------------
create or replace function public.mi_audits_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  acct uuid := public.mi__account();
  sites uuid[] := public.auth_site_ids();
begin
  return jsonb_build_object(
    'sites', (
      select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name,
        'machines', (select count(*) from public.equipment e where e.location_id = l.id and e.parent_asset_id is null and e.status <> 'retired'),
        'stickered', (select count(*) from public.equipment e join public.mi_tags t on t.entity_type = 'asset' and t.entity_id = e.id
                      where e.location_id = l.id and e.parent_asset_id is null and e.status <> 'retired'),
        'open_run', (select r.id from public.mi_audit_runs r where r.location_id = l.id and r.status = 'in_progress'),
        'last_completed', (select max(r.completed_at) from public.mi_audit_runs r where r.location_id = l.id and r.status = 'completed'))
        order by l.name), '[]'::jsonb)
      from public.locations l where l.id = any (sites)),
    'runs', (
      select coalesce(jsonb_agg(x order by (x ->> 'started_at') desc), '[]'::jsonb) from (
        select jsonb_build_object('id', r.id, 'location_id', r.location_id, 'site_name', l.name, 'scope', r.scope, 'status', r.status,
          'started_at', r.started_at, 'started_by_name', r.started_by_name, 'completed_at', r.completed_at, 'completed_by_name', r.completed_by_name,
          'summary', r.summary,
          'progress', (select jsonb_build_object('checked', count(*) filter (where i.result <> 'not_checked' and i.expected), 'expected', count(*) filter (where i.expected))
                       from public.mi_audit_items i where i.run_id = r.id)) as x
        from public.mi_audit_runs r join public.locations l on l.id = r.location_id
        where r.account_id = acct and r.location_id = any (sites)
        order by r.started_at desc limit 100) q));
end;
$$;

create or replace function public.mi_audit_detail(p_run uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r public.mi_audit_runs := public.mi__audit_run(p_run, false);
begin
  return jsonb_build_object(
    'run', to_jsonb(r) || jsonb_build_object('site_name', (select name from public.locations where id = r.location_id),
      'can_cancel', r.started_by = auth.uid() or public.mi_rank() >= 2),
    'areas', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name) order by a.sort_order, a.name), '[]'::jsonb)
              from public.mi_areas a where a.site_id = r.location_id),
    'items', (
      select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', i.id, 'equipment_id', i.equipment_id, 'tag', i.tag, 'expected', i.expected,
               'result', i.result, 'listed_area_id', i.listed_area_id, 'found_area_id', i.found_area_id, 'sticker_condition', i.sticker_condition,
               'note', i.note, 'checked_by_name', i.checked_by_name, 'checked_at', i.checked_at,
               'name', e.name, 'type', e.type, 'other_site', o.name))
             order by la.sort_order nulls last, la.name nulls last, e.name nulls last, i.tag), '[]'::jsonb)
      from public.mi_audit_items i
      left join public.equipment e on e.id = i.equipment_id
      left join public.mi_areas la on la.id = i.listed_area_id
      left join public.locations o on o.id = i.other_site_id
      where i.run_id = r.id));
end;
$$;

revoke all on function public.mi__audit_run(uuid, boolean) from public, anon, authenticated;
revoke all on function public.mi_audit_start(uuid, text) from public, anon;
revoke all on function public.mi_audit_scan(uuid, text, uuid, text) from public, anon;
revoke all on function public.mi_audit_mark(uuid, text, text, uuid, text) from public, anon;
revoke all on function public.mi_audit_complete(uuid, text, boolean) from public, anon;
revoke all on function public.mi_audit_cancel(uuid) from public, anon;
revoke all on function public.mi_audits_list() from public, anon;
revoke all on function public.mi_audit_detail(uuid) from public, anon;
grant execute on function public.mi_audit_start(uuid, text) to authenticated;
grant execute on function public.mi_audit_scan(uuid, text, uuid, text) to authenticated;
grant execute on function public.mi_audit_mark(uuid, text, text, uuid, text) to authenticated;
grant execute on function public.mi_audit_complete(uuid, text, boolean) to authenticated;
grant execute on function public.mi_audit_cancel(uuid) to authenticated;
grant execute on function public.mi_audits_list() to authenticated;
grant execute on function public.mi_audit_detail(uuid) to authenticated;
