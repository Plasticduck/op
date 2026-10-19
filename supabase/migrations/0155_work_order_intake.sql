-- Work order intake. Any staff member submits a ticket to a department
-- (Maintenance / Facilities / IT); reviewers for that department triage it.
-- Mirrors the Invoice Approval flow: a submitted ticket sits in a "New" queue
-- (reviewed_at is null) until a reviewer sets assignee/dates/priority/type and
-- accepts it, after which it runs through the normal status pipeline.
--
-- MaintainX-synced and older rows have department = null and keep exactly the
-- location-based visibility they had before, so the legacy Work Orders page and
-- the MaintainX sync are unaffected.

alter table public.work_orders
  add column if not exists department text
    check (department in ('maintenance', 'facilities', 'it')),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.users(id) on delete set null,
  add column if not exists reviewed_by_name text,
  -- Who set work_type: 'default' (submit-time placeholder), 'ai' (the
  -- classify-work-order function), or 'manual' (a person). The classifier only
  -- writes over 'default', so it never clobbers a reviewer's choice.
  add column if not exists work_type_source text not null default 'manual'
    check (work_type_source in ('default', 'ai', 'manual'));

create index if not exists work_orders_intake_idx
  on public.work_orders (account_id, department, reviewed_at)
  where department is not null;
create index if not exists work_orders_requested_by_idx
  on public.work_orders (requested_by);

-- Who may see and triage a department ticket. Keep in sync with
-- canReviewTicket() in src/lib/workOrderIntake.ts (that copy only shapes the UI;
-- this one is the real gate).
create or replace function public.auth_is_wo_reviewer(dept text, loc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.auth_role() = 'owner' then true
    when dept = 'maintenance' then
      public.auth_role() = 'technician'
      or (public.auth_role_category() = 'regional_manager' and public.auth_has_location(loc))
    when dept in ('facilities', 'it') then
      -- IT Personnel joins here once that role exists.
      public.auth_role_category() = 'regional_manager' and public.auth_has_location(loc)
    else false
  end
$$;
revoke all on function public.auth_is_wo_reviewer(text, uuid) from public;
grant execute on function public.auth_is_wo_reviewer(text, uuid) to authenticated;

-- Submitters always see their own tickets; department tickets are otherwise
-- visible only to that department's reviewers.
drop policy if exists wo_select on public.work_orders;
create policy wo_select on public.work_orders for select using (
  account_id = public.auth_account_id() and (
    (department is null and public.auth_has_location(location_id))
    or requested_by = auth.uid()
    or public.auth_is_wo_reviewer(department, location_id)
  )
);

-- Anyone may file a ticket at a site they belong to, but only a reviewer may
-- create one that is already accepted.
drop policy if exists wo_insert on public.work_orders;
create policy wo_insert on public.work_orders for insert with check (
  account_id = public.auth_account_id()
  and public.auth_has_location(location_id)
  and (department is null or reviewed_at is null or public.auth_is_wo_reviewer(department, location_id))
);

-- Once submitted, a department ticket belongs to its reviewers.
drop policy if exists wo_update on public.work_orders;
create policy wo_update on public.work_orders for update
  using (
    account_id = public.auth_account_id() and (
      (department is null and public.auth_has_location(location_id))
      or public.auth_is_wo_reviewer(department, location_id)
    )
  )
  with check (
    account_id = public.auth_account_id() and (
      (department is null and public.auth_has_location(location_id))
      or public.auth_is_wo_reviewer(department, location_id)
    )
  );

drop policy if exists wo_delete on public.work_orders;
create policy wo_delete on public.work_orders for delete using (
  account_id = public.auth_account_id() and (
    (department is null and public.auth_is_manager_plus())
    or (department is not null and public.auth_role() = 'owner')
  )
);

-- Child tables (files, comments, assignees, ...) check access through a
-- subquery on work_orders, which applies the policies above, so they inherit
-- this visibility with no changes. Only the file kind needs widening for video.
alter table public.work_order_files drop constraint if exists work_order_files_kind_check;
alter table public.work_order_files
  add constraint work_order_files_kind_check check (kind in ('photo', 'video', 'file'));

-- Allow short phone videos on tickets. Uploads above the project-wide Storage
-- limit (50 MB on the Free plan) are still rejected by Supabase.
update storage.buckets
set file_size_limit = 100 * 1024 * 1024,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
      'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/3gpp',
      'application/pdf', 'application/zip', 'text/plain'
    ]
where id = 'work-order-files';
