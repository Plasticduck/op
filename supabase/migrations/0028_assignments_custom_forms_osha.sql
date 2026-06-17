-- 0028_assignments_custom_forms_osha.sql
--
-- Three additions that unlock the next batch of features:
--
-- 1) Invoice assignment notification tracking. ops_invoices already had
--    assigned_to / assigned_to_name — add assigned_at (when) and notify_status
--    (what happened when we tried to email the assignee via Resend).
--
-- 2) custom_forms — one row per (account, form_key). Stores the JSONB schema a
--    manager built in the in-app form builder. site_review is the first
--    consumer; future forms (site_audit, staffing_note, etc.) can share this
--    table by picking their own form_key.
--
-- 3) Injury reports get the OSHA 300 fields (case number, job title snapshot,
--    days_restricted, illness_type, classification) so we can produce a real
--    OSHA 300 log export.

-- 1) ops_invoices: assignment timestamp + notification status
alter table public.ops_invoices add column if not exists assigned_at timestamptz;
alter table public.ops_invoices add column if not exists notify_status text;

-- 2) custom_forms (account-scoped, manager+ write, owner delete)
create table if not exists public.custom_forms (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  form_key text not null,
  schema jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  unique (account_id, form_key)
);
create index if not exists custom_forms_acct_key_idx on public.custom_forms (account_id, form_key);

alter table public.custom_forms enable row level security;

drop policy if exists custom_forms_select on public.custom_forms;
create policy custom_forms_select on public.custom_forms for select
  using (account_id = public.auth_account_id());

drop policy if exists custom_forms_insert on public.custom_forms;
create policy custom_forms_insert on public.custom_forms for insert
  with check (account_id = public.auth_account_id() and public.auth_is_manager_plus());

drop policy if exists custom_forms_update on public.custom_forms;
create policy custom_forms_update on public.custom_forms for update
  using (account_id = public.auth_account_id() and public.auth_is_manager_plus())
  with check (account_id = public.auth_account_id() and public.auth_is_manager_plus());

drop policy if exists custom_forms_delete on public.custom_forms;
create policy custom_forms_delete on public.custom_forms for delete
  using (account_id = public.auth_account_id() and public.auth_role() = 'owner');

-- 3) OSHA 300 columns on injury_reports
alter table public.injury_reports add column if not exists case_number text;
alter table public.injury_reports add column if not exists job_title_snapshot text;
alter table public.injury_reports add column if not exists days_restricted integer;
alter table public.injury_reports add column if not exists illness_type text;
alter table public.injury_reports add column if not exists classification text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'injury_reports_illness_type_check') then
    alter table public.injury_reports
      add constraint injury_reports_illness_type_check
      check (illness_type is null or illness_type in
        ('injury','skin','respiratory','poisoning','hearing','other_illness'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'injury_reports_classification_check') then
    alter table public.injury_reports
      add constraint injury_reports_classification_check
      check (classification is null or classification in
        ('death','days_away','job_transfer','other_recordable'));
  end if;
end $$;
