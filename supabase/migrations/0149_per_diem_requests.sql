-- Per Diem reimbursement requests, submitted to Accounts Payable (mirrors the
-- Corpay "Create Expense Item / Per Diem" flow). A user submits their own request;
-- the submitter sees their own, and account owners (AP) see all. Policy, category,
-- department, and business unit are free text for now (placeholder dropdowns in the
-- UI) until the exact option lists are finalized with AP.
create table if not exists public.per_diem_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  requested_by uuid references public.users(id) on delete set null,
  requested_by_name text,
  policy text,
  expense_date date not null default current_date,
  currency text not null default 'USD',
  amount numeric(12, 2) not null default 0,
  description text,
  category text,
  department text,
  business_unit text,
  status text not null default 'submitted' check (status in ('draft', 'submitted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz
);
alter table public.per_diem_requests enable row level security;
create policy pdr_select on public.per_diem_requests for select
  using (account_id = auth_account_id() and (requested_by = auth.uid() or auth_role() = 'owner'));
create policy pdr_insert on public.per_diem_requests for insert
  with check (account_id = auth_account_id() and requested_by = auth.uid());
create policy pdr_update on public.per_diem_requests for update
  using (account_id = auth_account_id() and (requested_by = auth.uid() or auth_role() = 'owner'));
create policy pdr_delete on public.per_diem_requests for delete
  using (account_id = auth_account_id() and (requested_by = auth.uid() or auth_role() = 'owner'));
create index if not exists pdr_account_idx on public.per_diem_requests(account_id, created_at desc);
