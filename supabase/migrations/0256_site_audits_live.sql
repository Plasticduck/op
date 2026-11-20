-- Site Audits goes live (Kevan, 2026-11-20): the graded audit (Site Audit NEW,
-- migrations 0244-0248) replaces the earlier Site Audits form and takes its name
-- and address, /app/site-audits. The earlier form's audits stay read only.
--
-- 1. The same people as the earlier Site Audits: every Admin (owner) and manager
--    at the sites they have, plus anyone the super admin grants the page. Pre-launch
--    this was Admins and grants of '/app/site-audits-new' only.
-- 2. Every submitted audit waits in Needs Attention for the site's Regional Manager
--    (or an Admin) to acknowledge it, a perfect one too. Before, an audit with
--    nothing red went straight to Complete.

create or replace function public.site_audit_v2_can_use()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.auth_role() in ('owner', 'manager') or public.auth_page_granted('/app/site-audits')
$$;
revoke all on function public.site_audit_v2_can_use() from public, anon;
grant execute on function public.site_audit_v2_can_use() to authenticated;

drop policy if exists site_audits_v2_select on public.site_audits_v2;
create policy site_audits_v2_select on public.site_audits_v2 for select using (
  account_id = auth_account_id()
  and public.site_audit_v2_can_use()
  and auth_has_location(location_id)
  and (status = 'submitted' or auditor_id = auth.uid())
);

drop policy if exists site_audits_v2_insert on public.site_audits_v2;
create policy site_audits_v2_insert on public.site_audits_v2 for insert with check (
  account_id = auth_account_id()
  and public.site_audit_v2_can_use()
  and auth_has_location(location_id)
  and auditor_id = auth.uid()
);

-- Only the auditor's own draft changes; submitting it is the last change.
drop policy if exists site_audits_v2_update on public.site_audits_v2;
create policy site_audits_v2_update on public.site_audits_v2 for update using (
  account_id = auth_account_id()
  and status = 'draft'
  and auditor_id = auth.uid()
) with check (
  account_id = auth_account_id()
  and public.site_audit_v2_can_use()
  and auth_has_location(location_id)
  and auditor_id = auth.uid()
);

-- Submitting always opens the follow-up: the RM acknowledges every audit.
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
    new.review_status := 'needs_attention';
    new.completed_at := null;
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

create or replace function public.site_audit_v2_rms()
returns table (location_id uuid, region text, user_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select m.* from public.site_audit_v2_rm_map(public.auth_account_id()) m
  where public.site_audit_v2_can_use()
$$;

-- As in 0248, with the wider access check. With nothing red there is nothing to
-- answer, so marking it complete is the acknowledgement.
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
     or not public.site_audit_v2_can_use() then
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
