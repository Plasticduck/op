-- Admins can re-open a submitted site audit, edit it and resubmit.
--
-- The submitted columns stay untouched until the resubmit, so walking away from
-- an edit leaves the audit exactly as it was. Until then the work in progress
-- lives in edit_draft ({ locationId, answers, byName, savedAt }), which is what
-- survives an iOS page reload after the camera. edited_* records the last resubmit.
alter table public.site_audits
  add column if not exists edit_draft jsonb,
  add column if not exists edited_by uuid references public.users(id) on delete set null,
  add column if not exists edited_by_name text,
  add column if not exists edited_at timestamptz;

-- Managers keep autosaving their drafts, but a submitted audit is now admin-only
-- to change. (The generic ops-suite policy let any manager update any row.)
drop policy if exists site_audits_update on public.site_audits;
create policy site_audits_update on public.site_audits for update
  using (
    account_id = public.auth_account_id()
    and (public.auth_role() = 'owner' or (public.auth_is_manager_plus() and status = 'draft'))
  )
  with check (
    account_id = public.auth_account_id()
    and (public.auth_role() = 'owner' or (public.auth_is_manager_plus() and status = 'draft'))
  );
