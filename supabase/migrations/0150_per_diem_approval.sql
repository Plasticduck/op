-- Per Diem approval workflow (mirrors Invoice Approval). A submitted request
-- lands in an AP-only review queue; AP double-checks it and marks it approved,
-- after which it moves to a Complete tab for CSV export into QuickBooks.
--
-- Status flow: draft -> submitted -> approved. AP = account owners OR anyone
-- with the 'finance' role_category; they see and act on every request in the
-- account, while a regular submitter still only sees their own rows.

-- Who reviews per diem: the finance team. Expose role_category to RLS the same
-- way auth_role() exposes role (SECURITY DEFINER, so policies can read users
-- without recursing into its own RLS).
create or replace function public.auth_role_category()
returns text language sql stable security definer set search_path = public as $$
  select role_category from public.users where id = auth.uid()
$$;

-- Approval audit columns.
alter table public.per_diem_requests
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.users(id) on delete set null,
  add column if not exists approved_by_name text;

-- Widen the status check to include 'approved'. The original constraint has an
-- auto-generated name, so drop whatever check references `status`, then re-add.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.per_diem_requests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.per_diem_requests drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.per_diem_requests add constraint per_diem_requests_status_check
  check (status in ('draft', 'submitted', 'approved'));

-- Rebuild RLS so AP (owner or finance) can see and act on all account rows,
-- while submitters keep access to their own.
drop policy if exists pdr_select on public.per_diem_requests;
drop policy if exists pdr_insert on public.per_diem_requests;
drop policy if exists pdr_update on public.per_diem_requests;
drop policy if exists pdr_delete on public.per_diem_requests;

create policy pdr_select on public.per_diem_requests for select
  using (account_id = auth_account_id()
    and (requested_by = auth.uid() or auth_role() = 'owner' or auth_role_category() = 'finance'));

create policy pdr_insert on public.per_diem_requests for insert
  with check (account_id = auth_account_id() and requested_by = auth.uid());

create policy pdr_update on public.per_diem_requests for update
  using (account_id = auth_account_id()
    and (requested_by = auth.uid() or auth_role() = 'owner' or auth_role_category() = 'finance'));

create policy pdr_delete on public.per_diem_requests for delete
  using (account_id = auth_account_id()
    and (requested_by = auth.uid() or auth_role() = 'owner' or auth_role_category() = 'finance'));
