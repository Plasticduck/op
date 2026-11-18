-- Checklists: submit -> RM Audit -> Archive, with comments and photos on each item.
--
-- Kevan, 2026-11-18: drop the AI photo check; keep the checklists and a photo for
-- proof. When the site finishes a checklist it submits it, and it lands in RM
-- Audit. The site's Regional Manager reads it, acknowledges anything the site
-- pointed out, and marks it complete, which moves it to Archive. Anyone on the
-- checklist can comment on an item, the site while filling it out and the RM
-- while reviewing.
--
--  * checklist_instances gains the submission (who, when, a snapshot of every
--    item as it stood) and the RM's follow-up (acknowledged items, note, who
--    completed it). review_status: null while the site works on it, 'rm_audit'
--    once submitted, 'archived' once the RM marks it complete.
--  * Submitting needs every item checked off or a comment saying why not, and a
--    photo on every checked item that requires one. Items that weren't done or
--    have a comment are "flagged": the RM acknowledges each before completing.
--  * The RM is the site's Regional Manager from company settings (the same
--    lookup as Site Audit NEW, site_audit_v2_rm_map). An Admin (owner) can also
--    review, for sites with no RM.
--  * Writes to the follow-up only go through the functions below: the direct
--    write policy on checklist_instances is dropped (only SECURITY DEFINER
--    functions ever wrote to it), and item toggles and photos stop at submit.
--  * checklist_day_report feeds the 8pm email: every checklist each site was due
--    that day, submitted or not, worked out from the templates (instances are
--    only made when someone opens the page).
--
-- The AI tables from 0050 (checklist_item_baselines, checklist_submissions) are
-- left in place but nothing reads or writes them any more.

-- 1) Follow-up columns on the day's checklist.
alter table public.checklist_instances
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_by uuid references public.users(id) on delete set null,
  add column if not exists submitted_by_name text,
  add column if not exists review_status text,
  add column if not exists snapshot jsonb,
  add column if not exists items_total int,
  add column if not exists items_done int,
  add column if not exists flagged_items text[] not null default '{}',
  add column if not exists rm_acks jsonb not null default '{}'::jsonb,
  add column if not exists rm_note text,
  add column if not exists completed_by uuid references public.users(id) on delete set null,
  add column if not exists completed_by_name text,
  add column if not exists completed_role text,
  add column if not exists completed_at timestamptz;

alter table public.checklist_instances
  add constraint checklist_instances_review_status_check
    check (review_status is null or review_status in ('rm_audit', 'archived')),
  add constraint checklist_instances_completed_role_check
    check (completed_role is null or completed_role in ('regional_manager', 'admin'));

create index if not exists checklist_instances_review_idx
  on public.checklist_instances (review_status, submitted_at desc)
  where review_status is not null;

-- Only the SECURITY DEFINER functions write instances (ensure_*, submit, review).
drop policy if exists checklist_instances_write on public.checklist_instances;

-- Item toggles stop once the checklist is submitted.
drop policy if exists checklist_item_events_insert on public.checklist_item_events;
create policy checklist_item_events_insert on public.checklist_item_events for insert
  with check (
    actor_id = auth.uid()
    and exists (
      select 1 from public.checklist_instances i
      where i.id = instance_id and public.auth_has_location(i.location_id) and i.review_status is null
    )
  );

-- The current-state view read events as its owner, so any signed-in person could
-- read every account's checks. Run it as the caller so the events' RLS applies.
alter view public.checklist_item_state set (security_invoker = true);
alter view public.checklist_submission_latest set (security_invoker = true);

-- Who the person is to this site's checklists: the site's Regional Manager, an
-- Admin (owner), or someone at the site.
create or replace function public.checklist_author_role(p_location uuid, p_user uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (
      select 1 from public.site_audit_v2_rm_map(l.account_id) m
      where m.location_id = p_location and m.user_id = p_user
    ) then 'rm'
    when u.role = 'owner' then 'admin'
    else 'site'
  end
  from public.locations l
  join public.users u on u.id = p_user and u.account_id = l.account_id
  where l.id = p_location
$$;
revoke all on function public.checklist_author_role(uuid, uuid) from public, anon, authenticated;
grant execute on function public.checklist_author_role(uuid, uuid) to service_role;

-- Is this item on this day's checklist (the template's items while it's being
-- filled out, the snapshot once submitted)?
create or replace function public.checklist_item_on_instance(p_instance uuid, p_item uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.checklist_instances i
    where i.id = p_instance
      and (
        (i.snapshot is null and exists (
          select 1 from public.checklist_items it where it.id = p_item and it.checklist_id = i.checklist_id))
        or (i.snapshot is not null and exists (
          select 1 from jsonb_array_elements(i.snapshot->'items') e where e->>'id' = p_item::text))
      )
  )
$$;
revoke all on function public.checklist_item_on_instance(uuid, uuid) from public, anon, authenticated;
grant execute on function public.checklist_item_on_instance(uuid, uuid) to service_role;

-- 2) Comments on an item. Append-only; the author can take one back while it
-- isn't part of a submitted record (before submit, or added during the review).
create table if not exists public.checklist_item_comments (
  id          uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.checklist_instances(id) on delete cascade,
  item_id     uuid not null,
  location_id uuid not null references public.locations(id) on delete cascade,
  author_id   uuid references public.users(id) on delete set null default auth.uid(),
  author_name text,
  author_role text not null default 'site' check (author_role in ('site', 'rm', 'admin')),
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists checklist_item_comments_instance_idx
  on public.checklist_item_comments (instance_id, item_id, created_at);

create or replace function public.checklist_item_comments_stamp()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  i public.checklist_instances;
begin
  select * into i from public.checklist_instances where id = new.instance_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if i.review_status = 'archived' then raise exception 'checklist_archived' using errcode = 'P0001'; end if;
  if not public.checklist_item_on_instance(new.instance_id, new.item_id) then
    raise exception 'item_not_on_checklist' using errcode = 'P0001';
  end if;
  new.location_id := i.location_id;
  new.author_id := auth.uid();
  new.author_name := (select name from public.users where id = auth.uid());
  new.author_role := coalesce(public.checklist_author_role(i.location_id, auth.uid()), 'site');
  new.body := btrim(new.body);
  new.created_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists checklist_item_comments_stamp on public.checklist_item_comments;
create trigger checklist_item_comments_stamp before insert on public.checklist_item_comments
  for each row execute function public.checklist_item_comments_stamp();

alter table public.checklist_item_comments enable row level security;

drop policy if exists checklist_item_comments_select on public.checklist_item_comments;
create policy checklist_item_comments_select on public.checklist_item_comments for select
  using (public.auth_has_location(location_id));

drop policy if exists checklist_item_comments_insert on public.checklist_item_comments;
create policy checklist_item_comments_insert on public.checklist_item_comments for insert
  with check (author_id = auth.uid() and public.auth_has_location(location_id));

drop policy if exists checklist_item_comments_delete on public.checklist_item_comments;
create policy checklist_item_comments_delete on public.checklist_item_comments for delete
  using (
    author_id = auth.uid()
    and exists (
      select 1 from public.checklist_instances i
      where i.id = instance_id
        and (i.review_status is null
             or (i.review_status = 'rm_audit' and checklist_item_comments.created_at > i.submitted_at))
    )
  );

-- 3) Photos on an item: proof the task was done. Stored in the checklist-photos
-- bucket under {account}/{instance}/{item}/{uuid}.{ext}. Added and removed only
-- while the site is filling the checklist out; up to 6 per item.
create table if not exists public.checklist_item_photos (
  id               uuid primary key default gen_random_uuid(),
  instance_id      uuid not null references public.checklist_instances(id) on delete cascade,
  item_id          uuid not null,
  location_id      uuid not null references public.locations(id) on delete cascade,
  path             text not null unique,
  uploaded_by      uuid references public.users(id) on delete set null default auth.uid(),
  uploaded_by_name text,
  created_at       timestamptz not null default now()
);
create index if not exists checklist_item_photos_instance_idx
  on public.checklist_item_photos (instance_id, item_id, created_at);

create or replace function public.checklist_item_photos_stamp()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  i public.checklist_instances;
  acct uuid;
begin
  select * into i from public.checklist_instances where id = new.instance_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if i.review_status is not null then raise exception 'checklist_submitted' using errcode = 'P0001'; end if;
  if not public.checklist_item_on_instance(new.instance_id, new.item_id) then
    raise exception 'item_not_on_checklist' using errcode = 'P0001';
  end if;
  select account_id into acct from public.locations where id = i.location_id;
  if new.path not like acct::text || '/' || i.id::text || '/' || new.item_id::text || '/%' then
    raise exception 'bad_path' using errcode = 'P0001';
  end if;
  if (select count(*) from public.checklist_item_photos p where p.instance_id = new.instance_id and p.item_id = new.item_id) >= 6 then
    raise exception 'too_many_photos' using errcode = 'P0001';
  end if;
  new.location_id := i.location_id;
  new.uploaded_by := auth.uid();
  new.uploaded_by_name := (select name from public.users where id = auth.uid());
  new.created_at := now();
  return new;
end $$;

drop trigger if exists checklist_item_photos_stamp on public.checklist_item_photos;
create trigger checklist_item_photos_stamp before insert on public.checklist_item_photos
  for each row execute function public.checklist_item_photos_stamp();

alter table public.checklist_item_photos enable row level security;

drop policy if exists checklist_item_photos_select on public.checklist_item_photos;
create policy checklist_item_photos_select on public.checklist_item_photos for select
  using (public.auth_has_location(location_id));

drop policy if exists checklist_item_photos_insert on public.checklist_item_photos;
create policy checklist_item_photos_insert on public.checklist_item_photos for insert
  with check (uploaded_by = auth.uid() and public.auth_has_location(location_id));

drop policy if exists checklist_item_photos_delete on public.checklist_item_photos;
create policy checklist_item_photos_delete on public.checklist_item_photos for delete
  using (
    uploaded_by = auth.uid()
    and exists (select 1 from public.checklist_instances i where i.id = instance_id and i.review_status is null)
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('checklist-photos', 'checklist-photos', false, 15 * 1024 * 1024,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
              'image/gif', 'image/bmp', 'image/tiff', 'image/avif'])
on conflict (id) do nothing;

-- Read: anyone with the checklist's site. Write: into their own account's folder
-- for a checklist at one of their sites. Delete: only their own upload.
create or replace function public.checklist_photo_path_ok(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select (storage.foldername(p_name))[1] = l.account_id::text and public.auth_has_location(i.location_id)
    from public.checklist_instances i
    join public.locations l on l.id = i.location_id
    where (storage.foldername(p_name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and i.id = ((storage.foldername(p_name))[2])::uuid
  ), false)
$$;
revoke all on function public.checklist_photo_path_ok(text) from public, anon;
grant execute on function public.checklist_photo_path_ok(text) to authenticated;

drop policy if exists "checklist photos read" on storage.objects;
create policy "checklist photos read" on storage.objects for select
  using (bucket_id = 'checklist-photos' and public.checklist_photo_path_ok(name));
drop policy if exists "checklist photos write" on storage.objects;
create policy "checklist photos write" on storage.objects for insert
  with check (bucket_id = 'checklist-photos' and public.checklist_photo_path_ok(name));
drop policy if exists "checklist photos delete" on storage.objects;
create policy "checklist photos delete" on storage.objects for delete
  using (bucket_id = 'checklist-photos' and owner_id = auth.uid()::text and public.checklist_photo_path_ok(name));

-- 4) Submit. Returns {ok:false, missing:[{item_id, label, reason}]} when an item
-- still needs something (reason 'photo': checked but no photo; 'not_done': not
-- checked and no comment), else {ok:true, flagged:n}.
create or replace function public.checklist_submit(p_instance uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  i public.checklist_instances;
  c public.checklists;
  me public.users;
  r record;
  missing jsonb := '[]'::jsonb;
  items jsonb := '[]'::jsonb;
  flagged text[] := '{}';
  n_total int := 0;
  n_done int := 0;
begin
  select * into i from public.checklist_instances where id = p_instance for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into me from public.users where id = auth.uid();
  select * into c from public.checklists where id = i.checklist_id;
  if me.id is null or c.account_id is distinct from me.account_id or not public.auth_has_location(i.location_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if i.review_status is not null then raise exception 'already_submitted' using errcode = 'P0001'; end if;

  for r in
    select it.id, it.label, it.requires_photo,
      coalesce(s.checked, false) as done, s.last_actor_name, s.last_event_at,
      (select count(*) from public.checklist_item_photos p where p.instance_id = i.id and p.item_id = it.id) as photos,
      (select count(*) from public.checklist_item_comments m where m.instance_id = i.id and m.item_id = it.id) as comments
    from public.checklist_items it
    left join public.checklist_item_state s on s.instance_id = i.id and s.item_id = it.id
    where it.checklist_id = i.checklist_id
    order by it.order_index, it.label
  loop
    n_total := n_total + 1;
    if r.done then n_done := n_done + 1; end if;
    if r.done and r.requires_photo and r.photos = 0 then
      missing := missing || jsonb_build_object('item_id', r.id, 'label', r.label, 'reason', 'photo');
    elsif not r.done and r.comments = 0 then
      missing := missing || jsonb_build_object('item_id', r.id, 'label', r.label, 'reason', 'not_done');
    end if;
    if not r.done or r.comments > 0 then flagged := flagged || r.id::text; end if;
    items := items || jsonb_build_object(
      'id', r.id, 'label', r.label, 'requires_photo', r.requires_photo, 'done', r.done,
      'done_by', case when r.done then r.last_actor_name end,
      'done_at', case when r.done then r.last_event_at end);
  end loop;

  if n_total = 0 then raise exception 'no_items' using errcode = 'P0001'; end if;
  if jsonb_array_length(missing) > 0 then
    return jsonb_build_object('ok', false, 'missing', missing);
  end if;

  update public.checklist_instances set
    submitted_at = clock_timestamp(),
    submitted_by = me.id,
    submitted_by_name = me.name,
    review_status = 'rm_audit',
    snapshot = jsonb_build_object('name', c.name, 'description', c.description, 'items', items),
    items_total = n_total,
    items_done = n_done,
    flagged_items = flagged,
    rm_acks = '{}'::jsonb,
    rm_note = null,
    completed_by = null, completed_by_name = null, completed_role = null, completed_at = null
  where id = i.id;
  return jsonb_build_object('ok', true, 'flagged', cardinality(flagged));
end $$;
revoke all on function public.checklist_submit(uuid) from public, anon;
grant execute on function public.checklist_submit(uuid) to authenticated;

-- 5) The RM's review: acknowledgements save as they go (p_complete false), then
-- mark complete, which needs every flagged item acknowledged. Only the site's
-- Regional Manager or an Admin, and only while it's in RM Audit. Acks for items
-- that aren't flagged are dropped.
create or replace function public.checklist_review(p_instance uuid, p_acks jsonb, p_note text, p_complete boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  i public.checklist_instances;
  me public.users;
  acct uuid;
  rm_user uuid;
  acks jsonb;
  missing text[];
begin
  select * into i from public.checklist_instances where id = p_instance for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select account_id into acct from public.locations where id = i.location_id;
  select * into me from public.users where id = auth.uid();
  if me.id is null or me.account_id is distinct from acct or not public.auth_has_location(i.location_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select m.user_id into rm_user from public.site_audit_v2_rm_map(acct) m where m.location_id = i.location_id;
  if not (me.role = 'owner' or (rm_user is not null and me.id = rm_user)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if i.review_status is distinct from 'rm_audit' then raise exception 'not_open' using errcode = 'P0001'; end if;

  select coalesce(jsonb_object_agg(e.key, true), '{}'::jsonb) into acks
  from jsonb_each(case when jsonb_typeof(p_acks) = 'object' then p_acks else '{}'::jsonb end) e
  where e.key = any (i.flagged_items) and e.value = 'true'::jsonb;
  missing := array(select f from unnest(i.flagged_items) f where not (acks ? f));
  if p_complete and cardinality(missing) > 0 then
    raise exception 'missing_acks' using errcode = 'P0001';
  end if;

  update public.checklist_instances set
    rm_acks = acks,
    rm_note = nullif(left(btrim(coalesce(p_note, '')), 4000), ''),
    review_status = case when p_complete then 'archived' else review_status end,
    completed_by = case when p_complete then me.id end,
    completed_by_name = case when p_complete then me.name end,
    completed_role = case when p_complete then (case when me.id = rm_user then 'regional_manager' else 'admin' end) end,
    completed_at = case when p_complete then now() end
  where id = i.id;
  return jsonb_build_object('ok', true, 'complete', p_complete, 'missing', to_jsonb(missing));
end $$;
revoke all on function public.checklist_review(uuid, jsonb, text, boolean) from public, anon;
grant execute on function public.checklist_review(uuid, jsonb, text, boolean) to authenticated;

-- Mark complete, in one go, the listed checklists that have nothing flagged and
-- that this person may review. Returns how many moved to Archive.
create or replace function public.checklist_review_bulk(p_ids uuid[])
returns int
language plpgsql security definer set search_path = public as $$
declare
  me public.users;
  n int;
begin
  select * into me from public.users where id = auth.uid();
  if me.id is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  with rm as (select * from public.site_audit_v2_rm_map(me.account_id))
  update public.checklist_instances i set
    review_status = 'archived',
    rm_acks = '{}'::jsonb,
    completed_by = me.id,
    completed_by_name = me.name,
    completed_role = case when rm.user_id = me.id then 'regional_manager' else 'admin' end,
    completed_at = now()
  from public.locations l
  left join rm on rm.location_id = l.id
  where i.id = any (p_ids)
    and l.id = i.location_id and l.account_id = me.account_id
    and i.review_status = 'rm_audit'
    and cardinality(i.flagged_items) = 0
    and public.auth_has_location(i.location_id)
    and (me.role = 'owner' or rm.user_id = me.id);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.checklist_review_bulk(uuid[]) from public, anon;
grant execute on function public.checklist_review_bulk(uuid[]) to authenticated;

-- Each of the caller's sites with its Regional Manager, for the page.
create or replace function public.checklist_site_rms()
returns table (location_id uuid, region text, user_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select m.* from public.site_audit_v2_rm_map(public.auth_account_id()) m
  where public.auth_has_location(m.location_id)
$$;
revoke all on function public.checklist_site_rms() from public, anon;
grant execute on function public.checklist_site_rms() to authenticated;

-- 6) The day's report for the 8pm email: one row per checklist each site was due
-- on p_date (its days of week), with the day's checklist if one was made. The
-- window is in the site's time zone; no closing time means it's open until
-- midnight, and a closing time at or before the opening time means the next day.
create or replace function public.checklist_day_report(p_account uuid, p_date date)
returns table (
  location_id uuid, location_name text, region text, rm_name text,
  checklist_id uuid, checklist_name text, opens_at timestamptz, closes_at timestamptz,
  instance_id uuid, submitted_at timestamptz, submitted_by_name text, review_status text,
  items_total int, items_done int, flagged_count int, photo_count int, comment_count int,
  completed_by_name text, completed_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with rm as (
    select * from public.site_audit_v2_rm_map(p_account)
  ), due as (
    select l.id as location_id, l.name as location_name, coalesce(nullif(l.timezone, ''), 'America/Chicago') as tz,
      c.id as checklist_id, c.name as checklist_name, c.opens_at_local, c.closes_at_local
    from public.checklists c
    join public.checklist_locations cl on cl.checklist_id = c.id
    join public.locations l on l.id = cl.location_id
    where c.account_id = p_account and not c.archived
      and l.account_id = p_account and not l.archived
      and extract(dow from p_date)::int = any (c.days_of_week)
  )
  select d.location_id, d.location_name, rm.region, rm.name,
    d.checklist_id, d.checklist_name,
    (p_date + coalesce(d.opens_at_local, '00:00'::time))::timestamp at time zone d.tz,
    case
      when d.closes_at_local is null then (p_date + 1)::timestamp at time zone d.tz
      when d.closes_at_local <= coalesce(d.opens_at_local, '00:00'::time) then (p_date + 1 + d.closes_at_local)::timestamp at time zone d.tz
      else (p_date + d.closes_at_local)::timestamp at time zone d.tz
    end,
    i.id, i.submitted_at, i.submitted_by_name, i.review_status, i.items_total, i.items_done,
    coalesce(cardinality(i.flagged_items), 0),
    (select count(*) from public.checklist_item_photos p where p.instance_id = i.id)::int,
    (select count(*) from public.checklist_item_comments m where m.instance_id = i.id)::int,
    i.completed_by_name, i.completed_at
  from due d
  left join public.checklist_instances i
    on i.checklist_id = d.checklist_id and i.location_id = d.location_id and i.instance_date = p_date
  left join rm on rm.location_id = d.location_id
$$;
revoke all on function public.checklist_day_report(uuid, date) from public, anon, authenticated;
grant execute on function public.checklist_day_report(uuid, date) to service_role;

-- 7) One 8pm email per account per day: the function claims the day before it
-- sends, so a retried cron can't send it twice.
create table if not exists public.checklist_daily_emails (
  account_id  uuid not null references public.accounts(id) on delete cascade,
  report_date date not null,
  claimed_at  timestamptz not null default now(),
  sent_at     timestamptz,
  result      jsonb,
  primary key (account_id, report_date)
);
alter table public.checklist_daily_emails enable row level security;
