-- Site audit drafts: a user can save an in-progress audit and resume it later.
-- A draft is a site_audits row with status='draft' holding the full raw answers
-- in draft_answers; on submit a fresh 'submitted' audit is written and the draft
-- is deleted. Existing rows backfill to 'submitted' via the column default.
alter table public.site_audits
  add column if not exists status text not null default 'submitted',
  add column if not exists draft_answers jsonb,
  add column if not exists updated_at timestamptz;

-- The generic delete policy on these ops-suite tables is owner-only; additionally
-- let a user delete THEIR OWN draft (to discard it, or to clean it up after it's
-- been submitted as a fresh audit). Only ever applies to status='draft' rows.
drop policy if exists site_audits_delete_own_draft on public.site_audits;
create policy site_audits_delete_own_draft on public.site_audits for delete
  using (
    account_id = public.auth_account_id()
    and status = 'draft'
    and submitted_by = auth.uid()
  );
