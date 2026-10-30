-- IT Inventory Phase 2 (2026-10-30): physical audits, inside IT Inventory
-- (Kevan: audits stay in the module, not the checklist list).
--
-- An audit is a walk through one site with a phone, scanning every sticker.
-- Starting one lists every active item at the site (it_audit_items, one row
-- each, in walk order by area). Each scan marks its item found; something
-- registered at another site is flagged as in the wrong place; a sticker we
-- don't know is noted. Anything not scanned must be marked found, missing or
-- damaged before the audit can be finished. Finishing applies everything to
-- the equipment in one go: last and next audit dates, sticker condition (faded
-- or missing stickers land in the print queue), the area it was found in, and
-- custom fields marked "editable during audit". Each item's Timeline gets an
-- "audited" row with what happened.
--
-- Crew can audit (spec: crew can read, scan, audit and report a problem), so
-- the functions check it_can_read, and equipment changes happen only through
-- it_complete_audit.

-- ---- Runs ---------------------------------------------------------------------------
create table if not exists public.it_audit_runs (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  location_id      uuid not null references public.locations(id) on delete cascade,
  status           text not null default 'in_progress' check (status in ('in_progress', 'completed', 'canceled')),
  started_at       timestamptz not null default now(),
  started_by       uuid references public.users(id) on delete set null default auth.uid(),
  completed_at     timestamptz,
  completed_by     uuid references public.users(id) on delete set null,
  -- Counts at completion: found, missing, damaged, wrong_location, unregistered,
  -- moved (area), stickers (faded or missing).
  summary          jsonb not null default '{}'::jsonb,
  note             text,
  -- From the spec's data model, for a checklist-engine link. Unused: audits
  -- live in IT Inventory.
  checklist_run_id uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.users(id) on delete set null default auth.uid()
);
create index if not exists it_audit_runs_site_idx on public.it_audit_runs (account_id, location_id, started_at desc);
-- One audit at a time per site.
create unique index if not exists it_audit_runs_open_unq on public.it_audit_runs (location_id) where status = 'in_progress';
create trigger it_audit_runs_touch before update on public.it_audit_runs
  for each row execute function public.it_touch();
alter table public.it_audit_runs enable row level security;
create policy it_audit_runs_select on public.it_audit_runs
  for select using (account_id = auth_account_id() and it_can_read(location_id));
-- Written only by the functions below.

-- ---- Items ---------------------------------------------------------------------------
create table if not exists public.it_audit_items (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null references public.accounts(id) on delete cascade,
  location_id            uuid not null references public.locations(id) on delete cascade,
  audit_run_id           uuid not null references public.it_audit_runs(id) on delete cascade,
  asset_id               uuid references public.it_assets(id) on delete set null,
  -- The tag as scanned: for stickers not in the inventory, and a record of
  -- what was read.
  tag                    text,
  -- On the list when the audit started (false = turned up during the walk).
  expected               boolean not null default true,
  listed_area_id         uuid references public.it_site_areas(id) on delete set null,
  -- Where it was found, when that's different; it moves there at completion.
  found_area_id          uuid references public.it_site_areas(id) on delete set null,
  result                 text not null default 'not_checked'
                         check (result in ('not_checked', 'found', 'missing', 'damaged', 'wrong_location', 'unregistered')),
  -- wrong_location: the site it's registered at.
  other_site_id          uuid references public.locations(id) on delete set null,
  sticker_condition      text check (sticker_condition in ('ok', 'faded', 'missing')),
  -- Custom fields edited during the audit; applied at completion (only
  -- fields marked editable_during_audit).
  custom_values          jsonb not null default '{}'::jsonb,
  photo_path             text,
  ai_verification_result jsonb,
  note                   text,
  checked_at             timestamptz,
  checked_by             uuid references public.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references public.users(id) on delete set null default auth.uid()
);
create index if not exists it_audit_items_run_idx on public.it_audit_items (audit_run_id);
create index if not exists it_audit_items_asset_idx on public.it_audit_items (asset_id);
create unique index if not exists it_audit_items_asset_unq on public.it_audit_items (audit_run_id, asset_id) where asset_id is not null;
create unique index if not exists it_audit_items_tag_unq on public.it_audit_items (audit_run_id, tag) where asset_id is null;

-- People set an item's result, sticker, area, fields, photo and note while the
-- audit is open. Everything else about the row is fixed.
create or replace function public.it_audit_items_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or current_setting('it.audit_fn', true) = '1' then
    return new; -- the scan function below writes freely
  end if;
  if new.account_id is distinct from old.account_id or new.location_id is distinct from old.location_id
     or new.audit_run_id is distinct from old.audit_run_id or new.asset_id is distinct from old.asset_id
     or new.tag is distinct from old.tag or new.expected is distinct from old.expected
     or new.listed_area_id is distinct from old.listed_area_id or new.other_site_id is distinct from old.other_site_id
     or new.ai_verification_result is distinct from old.ai_verification_result then
    raise exception 'Only the result, sticker, area, details, photo and note can change' using errcode = '42501';
  end if;
  if (select status from public.it_audit_runs where id = new.audit_run_id) <> 'in_progress' then
    raise exception 'This audit is finished.';
  end if;
  if new.result not in ('found', 'missing', 'damaged', 'not_checked') and new.result is distinct from old.result then
    raise exception 'Mark it found, missing or damaged.';
  end if;
  if new.found_area_id is not null and not exists (
    select 1 from public.it_site_areas where id = new.found_area_id and location_id = new.location_id) then
    raise exception 'That area is at another site.';
  end if;
  new.checked_at := now();
  new.checked_by := auth.uid();
  return new;
end $$;
create trigger it_audit_items_guard_trg before update on public.it_audit_items
  for each row execute function public.it_audit_items_guard();
create trigger it_audit_items_touch before update on public.it_audit_items
  for each row execute function public.it_touch();

alter table public.it_audit_items enable row level security;
create policy it_audit_items_select on public.it_audit_items
  for select using (account_id = auth_account_id() and it_can_read(location_id));
create policy it_audit_items_update on public.it_audit_items
  for update using (account_id = auth_account_id() and it_can_read(location_id))
  with check (account_id = auth_account_id() and it_can_read(location_id));
-- Inserted only by it_start_audit / it_audit_scan.

-- Audit photos: anyone who can audit can upload them (equipment photos stay
-- staff-only), under <account>/audit/.
create policy it_inventory_files_insert_audit on storage.objects
  for insert to authenticated with check (
    bucket_id = 'it-inventory' and (storage.foldername(name))[1] = auth_account_id()::text
    and (storage.foldername(name))[2] = 'audit'
  );

-- ---- Start ---------------------------------------------------------------------------
-- Opens the site's audit (or returns the one already open) with every active
-- item on the list.
create or replace function public.it_start_audit(p_location uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  acct uuid := auth_account_id();
  run  uuid;
begin
  if acct is null or not exists (select 1 from public.locations where id = p_location and account_id = acct)
     or not it_can_read(p_location) then
    raise exception 'You can''t audit this site' using errcode = '42501';
  end if;
  select id into run from public.it_audit_runs where location_id = p_location and status = 'in_progress';
  if run is not null then
    return run;
  end if;
  begin
    insert into public.it_audit_runs (account_id, location_id) values (acct, p_location) returning id into run;
  exception when unique_violation then
    -- Someone else started it a moment ago: join theirs.
    select id into run from public.it_audit_runs where location_id = p_location and status = 'in_progress';
    return run;
  end;
  insert into public.it_audit_items (account_id, location_id, audit_run_id, asset_id, tag, expected, listed_area_id)
  select acct, p_location, run, a.id, a.asset_tag, true, a.area_id
    from public.it_assets a
    left join public.it_status_labels st on st.id = a.status_label_id
   where a.account_id = acct and a.location_id = p_location and a.deleted_at is null
     and coalesce(st.type, '') <> 'archived';
  return run;
end $$;
grant execute on function public.it_start_audit(uuid) to authenticated;

-- ---- Scan ----------------------------------------------------------------------------
-- One scanned sticker during the walk. p_area is the area the auditor is in,
-- if they've said; an item listed somewhere else is noted to move there.
create or replace function public.it_audit_scan(p_run uuid, p_tag text, p_area uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r     public.it_audit_runs%rowtype;
  t     text := upper(btrim(coalesce(p_tag, '')));
  a     public.it_assets%rowtype;
  it    public.it_audit_items%rowtype;
  again boolean := false;
  area  uuid;
begin
  select * into r from public.it_audit_runs where id = p_run and account_id = auth_account_id();
  if not found or not it_can_read(r.location_id) then
    raise exception 'You can''t audit this site' using errcode = '42501';
  end if;
  if r.status <> 'in_progress' then
    raise exception 'This audit is finished.';
  end if;
  if t = '' then
    raise exception 'Scan or type a tag.';
  end if;
  perform set_config('it.audit_fn', '1', true);
  select id into area from public.it_site_areas where id = p_area and location_id = r.location_id;

  select * into a from public.it_assets where account_id = r.account_id and asset_tag = t and deleted_at is null;
  if found and a.location_id = r.location_id then
    select (result <> 'not_checked' and result <> 'wrong_location') into again
      from public.it_audit_items where audit_run_id = r.id and asset_id = a.id;
    insert into public.it_audit_items as i
      (account_id, location_id, audit_run_id, asset_id, tag, expected, listed_area_id, result, sticker_condition,
       found_area_id, checked_at, checked_by)
    values (r.account_id, r.location_id, r.id, a.id, a.asset_tag, false, a.area_id, 'found', 'ok',
            case when area is distinct from a.area_id then area end, now(), auth.uid())
    on conflict (audit_run_id, asset_id) where asset_id is not null do update
      set result = case when i.result = 'damaged' then 'damaged' else 'found' end,
          sticker_condition = coalesce(i.sticker_condition, 'ok'),
          found_area_id = case when area is null then i.found_area_id
                               when area is distinct from i.listed_area_id then area else null end,
          other_site_id = null,
          checked_at = now(), checked_by = auth.uid()
    returning * into it;
    perform set_config('it.audit_fn', '', true);
    return jsonb_build_object('result', it.result, 'item_id', it.id, 'asset_id', a.id, 'tag', a.asset_tag, 'name', a.name,
                              'again', coalesce(again, false), 'listed_area_id', it.listed_area_id, 'found_area_id', it.found_area_id);
  elsif found then
    -- Registered at another site. Its name only if the auditor can see that site.
    insert into public.it_audit_items as i
      (account_id, location_id, audit_run_id, asset_id, tag, expected, result, other_site_id, found_area_id, checked_at, checked_by)
    values (r.account_id, r.location_id, r.id, a.id, a.asset_tag, false, 'wrong_location', a.location_id, area, now(), auth.uid())
    on conflict (audit_run_id, asset_id) where asset_id is not null do update
      set checked_at = now(), checked_by = auth.uid()
    returning * into it;
    perform set_config('it.audit_fn', '', true);
    return jsonb_build_object('result', 'wrong_location', 'item_id', it.id, 'asset_id', a.id, 'tag', a.asset_tag,
                              'name', case when it_can_read(a.location_id) then a.name end,
                              'site', (select name from public.locations where id = a.location_id),
                              'can_move', it_can_write(a.location_id) and it_can_write(r.location_id));
  else
    -- Not in the inventory (a blank pre-printed tag, or a sticker we don't know).
    insert into public.it_audit_items as i
      (account_id, location_id, audit_run_id, tag, expected, result, found_area_id, checked_at, checked_by)
    values (r.account_id, r.location_id, r.id, t, false, 'unregistered', area, now(), auth.uid())
    on conflict (audit_run_id, tag) where asset_id is null do update
      set checked_at = now(), checked_by = auth.uid()
    returning * into it;
    perform set_config('it.audit_fn', '', true);
    return jsonb_build_object('result', 'unregistered', 'item_id', it.id, 'tag', t,
                              'unused', exists (select 1 from public.it_asset_tags
                                                 where account_id = r.account_id and tag = t and status = 'unused'));
  end if;
end $$;
grant execute on function public.it_audit_scan(uuid, text, uuid) to authenticated;

-- ---- Finish ----------------------------------------------------------------------------
create or replace function public.it_complete_audit(p_run uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r       public.it_audit_runs%rowtype;
  s       public.it_settings%rowtype;
  it      record;
  open_n  integer;
  months  integer;
  note    text;
  fields  jsonb;
  site    text;
  day     text := to_char(now() at time zone 'America/Chicago', 'Mon FMDD');
  nm      text;
  sum_    jsonb;
begin
  select * into r from public.it_audit_runs where id = p_run and account_id = auth_account_id() for update;
  if not found or not it_can_read(r.location_id) then
    raise exception 'You can''t audit this site' using errcode = '42501';
  end if;
  if r.status <> 'in_progress' then
    raise exception 'This audit is already finished.';
  end if;
  select count(*) into open_n from public.it_audit_items where audit_run_id = r.id and result = 'not_checked';
  if open_n > 0 then
    raise exception '% % still need a result: found, missing or damaged.', open_n, case when open_n = 1 then 'item' else 'items' end;
  end if;
  select * into s from public.it_settings where account_id = r.account_id;
  select name into site from public.locations where id = r.location_id;
  select name into nm from public.users where id = auth.uid();

  perform set_config('it.action', 'audited', true);
  for it in
    select i.*, a.location_id as asset_site, a.category_id, a.custom_values as current_values,
           (select ar.name from public.it_site_areas ar where ar.id = i.found_area_id) as found_area
      from public.it_audit_items i
      join public.it_assets a on a.id = i.asset_id
     where i.audit_run_id = r.id
  loop
    if it.result in ('found', 'damaged') or (it.result = 'wrong_location' and it.asset_site = r.location_id) then
      select coalesce(c.audit_interval_months, s.audit_interval_months) into months
        from public.it_categories c where c.id = it.category_id;
      -- Only fields marked editable during audits.
      select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into fields
        from jsonb_each(it.custom_values) e
        join public.it_custom_fields f on f.account_id = r.account_id and f.key = e.key
                                      and f.editable_during_audit and f.deleted_at is null;
      note := concat_ws('. ',
        case when it.result = 'damaged' then 'Found damaged' else 'Found' end
          || case when it.found_area is not null then ' in ' || it.found_area || ' (moved there)' else '' end,
        case it.sticker_condition when 'faded' then 'Sticker faded' when 'missing' then 'Sticker missing' end,
        nullif(btrim(coalesce(it.note, '')), ''));
      perform set_config('it.note', note, true);
      update public.it_assets
         set last_audit_at = now(),
             next_audit_date = (current_date + make_interval(months => coalesce(months, s.audit_interval_months, 6)))::date,
             sticker_condition = coalesce(it.sticker_condition, sticker_condition),
             sticker_last_verified_at = case when it.sticker_condition is not null then now() else sticker_last_verified_at end,
             area_id = coalesce(it.found_area_id, area_id),
             custom_values = coalesce(custom_values, '{}'::jsonb) || fields
       where id = it.asset_id;
    else
      -- Missing, or found here but registered somewhere else: history only.
      insert into public.it_activity_log
        (account_id, location_id, asset_id, entity_type, entity_id, action, actor_user_id, actor_name, after)
      values (r.account_id, it.asset_site, it.asset_id, 'asset', it.asset_id, 'audited', auth.uid(), nm,
              jsonb_build_object('note', case
                when it.result = 'missing' then concat_ws('. ', 'Missing at the ' || site || ' audit on ' || day, nullif(btrim(coalesce(it.note, '')), ''))
                else 'Found at ' || site || ' during its audit on ' || day || ', but registered at another site' end));
    end if;
  end loop;
  perform set_config('it.action', '', true);
  perform set_config('it.note', '', true);

  select jsonb_build_object(
           'total',          count(*),
           'found',          count(*) filter (where result = 'found'),
           'missing',        count(*) filter (where result = 'missing'),
           'damaged',        count(*) filter (where result = 'damaged'),
           'wrong_location', count(*) filter (where result = 'wrong_location'),
           'unregistered',   count(*) filter (where result = 'unregistered'),
           'moved',          count(*) filter (where found_area_id is not null and result in ('found', 'damaged')),
           'stickers',       count(*) filter (where sticker_condition in ('faded', 'missing')))
    into sum_
    from public.it_audit_items where audit_run_id = r.id;
  update public.it_audit_runs
     set status = 'completed', completed_at = now(), completed_by = auth.uid(), summary = sum_,
         note = nullif(btrim(coalesce(p_note, '')), '')
   where id = r.id;
  return sum_;
end $$;
grant execute on function public.it_complete_audit(uuid, text) to authenticated;

-- Stop an audit without changing any equipment. The person who started it,
-- or anyone who manages the site.
create or replace function public.it_cancel_audit(p_run uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.it_audit_runs%rowtype;
begin
  select * into r from public.it_audit_runs where id = p_run and account_id = auth_account_id();
  if not found or not (it_can_write(r.location_id) or (r.started_by = auth.uid() and it_can_read(r.location_id))) then
    raise exception 'You can''t cancel this audit' using errcode = '42501';
  end if;
  if r.status <> 'in_progress' then
    raise exception 'This audit is already finished.';
  end if;
  update public.it_audit_runs set status = 'canceled', completed_at = now(), completed_by = auth.uid() where id = r.id;
end $$;
grant execute on function public.it_cancel_audit(uuid) to authenticated;
