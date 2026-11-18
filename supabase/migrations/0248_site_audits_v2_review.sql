-- Site Audit NEW: the follow-up after an audit is submitted (Kevan, 2026-11-18),
-- shaped like Invoice Approval's tabs.
--
-- Every submitted audit shows in Audit History. One with a red item goes to
-- Needs Attention, where the site's Regional Manager answers each red item (the
-- fix, or a reply) and marks it complete; then it's in Complete, and a text says
-- the RM acknowledged it. An audit with no red items goes straight to Complete.
--
-- The site's RM is the one company settings name for the site's region this
-- quarter (regions + regionalManagers, the same settings the clock-in texts
-- and dashboards read), matched by name to a Regional Manager login. Central is
-- vacant and MW35 is in no region, so an Admin can also answer and complete.
--
-- The answers are written only through site_audit_v2_respond(); the table's
-- update rule still lets only the auditor change their own draft.

alter table public.site_audits_v2
  add column review_status text check (review_status in ('needs_attention', 'complete')),
  add column rm_responses jsonb not null default '{}'::jsonb,
  add column rm_note text,
  add column completed_by uuid references public.users(id) on delete set null,
  add column completed_by_name text,
  add column completed_role text check (completed_role in ('regional_manager', 'admin')),
  add column completed_at timestamptz,
  add column ack_notified_at timestamptz,
  add column ack_notify_result jsonb;

update public.site_audits_v2 a
   set review_status = case when exists (
         select 1 from jsonb_each(a.answers) e where jsonb_typeof(e.value) = 'object' and e.value->>'value' = 'fail'
       ) then 'needs_attention' else 'complete' end,
       completed_at = case when exists (
         select 1 from jsonb_each(a.answers) e where jsonb_typeof(e.value) = 'object' and e.value->>'value' = 'fail'
       ) then null else a.submitted_at end
 where a.status = 'submitted';

alter table public.site_audits_v2
  add constraint site_audits_v2_review_set check (status = 'draft' or review_status is not null);

create index site_audits_v2_review_idx on public.site_audits_v2 (account_id, review_status) where status = 'submitted';

-- Submitting decides the tab from the answers themselves (any red item means
-- Needs Attention), not from what the app sent, and starts the follow-up clean.
create or replace function public.site_audits_v2_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status = 'draft') then
    new.submitted_at := now();
    new.rm_responses := '{}'::jsonb;
    new.rm_note := null;
    new.completed_by := null;
    new.completed_by_name := null;
    new.completed_role := null;
    new.ack_notified_at := null;
    new.ack_notify_result := null;
    if exists (select 1 from jsonb_each(coalesce(new.answers, '{}'::jsonb)) e
               where jsonb_typeof(e.value) = 'object' and e.value->>'value' = 'fail') then
      new.review_status := 'needs_attention';
      new.completed_at := null;
    else
      new.review_status := 'complete';
      new.completed_at := now();
    end if;
  elsif new.status = 'draft' then
    new.review_status := null;
    new.rm_responses := '{}'::jsonb;
    new.rm_note := null;
    new.completed_by := null;
    new.completed_by_name := null;
    new.completed_role := null;
    new.completed_at := null;
  end if;
  return new;
end $$;

-- Each site's region and Regional Manager this quarter, for one account. Names
-- match the way clock-in-alert-email matches them (letters and spaces only,
-- lowercased). A vacant region or a name with no RM login gives a null user_id.
-- Internal: the app reads its own account through site_audit_v2_rms().
create or replace function public.site_audit_v2_rm_map(p_account uuid)
returns table (location_id uuid, region text, user_id uuid, name text)
language sql stable security definer set search_path = public as $$
  with s as (
    select company_settings as cs from public.accounts where id = p_account
  ), q as (
    select to_char(date_trunc('quarter', (now() at time zone 'America/Chicago')::date), 'YYYY-MM-DD') as quarter
  ), r as (
    select reg->>'name' as region, sid::uuid as location_id, reg_ord
    from s,
         jsonb_array_elements(case when jsonb_typeof(s.cs->'regions') = 'array' then s.cs->'regions' else '[]'::jsonb end)
           with ordinality as t(reg, reg_ord),
         jsonb_array_elements_text(case when jsonb_typeof(reg->'siteIds') = 'array' then reg->'siteIds' else '[]'::jsonb end) as sid
    where sid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ), m as (
    select r.location_id, r.region, r.reg_ord,
      nullif(trim(case jsonb_typeof(s.cs->'regionalManagers'->r.region)
        when 'string' then s.cs->'regionalManagers'->>r.region
        when 'object' then (
          select v.value from jsonb_each_text(s.cs->'regionalManagers'->r.region) v, q
          where v.key <= q.quarter order by v.key desc limit 1)
        else null end), '') as manager
    from r, s
  )
  select distinct on (m.location_id) m.location_id, m.region, u.id, coalesce(u.name, m.manager)
  from m
  left join lateral (
    select u.id, u.name from public.users u
    where u.account_id = p_account and u.role_category = 'regional_manager' and m.manager is not null
      and trim(regexp_replace(regexp_replace(lower(u.name), '[^a-z ]', '', 'g'), '\s+', ' ', 'g'))
        = trim(regexp_replace(regexp_replace(lower(m.manager), '[^a-z ]', '', 'g'), '\s+', ' ', 'g'))
    order by u.created_at
    limit 1
  ) u on true
  order by m.location_id, m.reg_ord
$$;

revoke all on function public.site_audit_v2_rm_map(uuid) from public, anon, authenticated;
grant execute on function public.site_audit_v2_rm_map(uuid) to service_role;

-- The caller's own account, for the page (who to wait on, who may answer).
create or replace function public.site_audit_v2_rms()
returns table (location_id uuid, region text, user_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select m.* from public.site_audit_v2_rm_map(public.auth_account_id()) m
  where public.auth_role() = 'owner' or public.auth_page_granted('/app/site-audits-new')
$$;

revoke all on function public.site_audit_v2_rms() from public, anon;
grant execute on function public.site_audit_v2_rms() to authenticated;

-- The RM's answers to an audit's red items: saved as they type (p_complete
-- false), then marked complete, which needs an answer for every red item. Only
-- the site's Regional Manager or an Admin, and only while it needs attention.
-- Answers to anything that isn't a red item are dropped.
create or replace function public.site_audit_v2_respond(p_id uuid, p_responses jsonb, p_note text, p_complete boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.site_audits_v2;
  rm_user uuid;
  is_rm boolean;
  is_admin boolean := public.auth_role() = 'owner';
  clean jsonb := '{}'::jsonb;
  missing int := 0;
  e record;
  txt text;
begin
  select * into a from public.site_audits_v2 where id = p_id for update;
  if a.id is null or a.account_id is distinct from public.auth_account_id()
     or not public.auth_has_location(a.location_id)
     or not (is_admin or public.auth_page_granted('/app/site-audits-new')) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if a.status <> 'submitted' or a.review_status is distinct from 'needs_attention' then
    raise exception 'not_open' using errcode = 'P0001';
  end if;

  select m.user_id into rm_user from public.site_audit_v2_rm_map(a.account_id) m where m.location_id = a.location_id;
  is_rm := rm_user is not null and rm_user = auth.uid();
  if not (is_rm or is_admin) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  for e in select key, value from jsonb_each(a.answers)
           where jsonb_typeof(value) = 'object' and value->>'value' = 'fail' loop
    txt := case when jsonb_typeof(p_responses->e.key) = 'string' then left(trim(p_responses->>e.key), 4000) else '' end;
    if txt <> '' then clean := clean || jsonb_build_object(e.key, txt); else missing := missing + 1; end if;
  end loop;

  if p_complete and missing > 0 then
    raise exception 'missing_responses' using errcode = 'P0001', detail = missing::text;
  end if;

  update public.site_audits_v2 set
    rm_responses = clean,
    rm_note = nullif(left(trim(coalesce(p_note, '')), 4000), ''),
    review_status = case when p_complete then 'complete' else review_status end,
    completed_by = case when p_complete then auth.uid() else null end,
    completed_by_name = case when p_complete then (select u.name from public.users u where u.id = auth.uid()) else null end,
    completed_role = case when p_complete then (case when is_rm then 'regional_manager' else 'admin' end) else null end,
    completed_at = case when p_complete then now() else null end
  where id = p_id;

  return jsonb_build_object('ok', true, 'complete', p_complete, 'missing', missing);
end $$;

revoke all on function public.site_audit_v2_respond(uuid, jsonb, text, boolean) from public, anon;
grant execute on function public.site_audit_v2_respond(uuid, jsonb, text, boolean) to authenticated;
