-- Mileage reimbursement requests, submitted to Accounts Payable (mirrors the
-- Corpay "Create Expense Item / Mileage" flow and the per_diem_requests workflow).
-- A user builds a route (stops), the app computes driving miles, and the amount is
-- miles * rate. Same AP review flow: draft -> submitted -> approved. AP = account
-- owners OR the 'finance' role_category (see auth_role_category() from 0150); a
-- submitter sees only their own.
create table if not exists public.mileage_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  requested_by uuid references public.users(id) on delete set null,
  requested_by_name text,
  policy text,
  expense_date date not null default current_date,
  currency text not null default 'USD',
  -- Ordered route stops: [{ address, lat, lon }]. Driving distance is computed
  -- from these; miles is editable so the user can correct an auto-calc.
  stops jsonb not null default '[]'::jsonb,
  round_trip boolean not null default false,
  miles numeric(10, 2) not null default 0,
  rate numeric(6, 3) not null default 0.67,
  amount numeric(12, 2) not null default 0,   -- miles * rate
  description text,
  category text,
  department text,
  business_unit text,
  status text not null default 'submitted' check (status in ('draft', 'submitted', 'approved')),
  approved_at timestamptz,
  approved_by uuid references public.users(id) on delete set null,
  approved_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz
);
alter table public.mileage_requests enable row level security;

create policy mr_select on public.mileage_requests for select
  using (account_id = auth_account_id()
    and (requested_by = auth.uid() or auth_role() = 'owner' or auth_role_category() = 'finance'));

create policy mr_insert on public.mileage_requests for insert
  with check (account_id = auth_account_id() and requested_by = auth.uid());

create policy mr_update on public.mileage_requests for update
  using (account_id = auth_account_id()
    and (requested_by = auth.uid() or auth_role() = 'owner' or auth_role_category() = 'finance'));

create policy mr_delete on public.mileage_requests for delete
  using (account_id = auth_account_id()
    and (requested_by = auth.uid() or auth_role() = 'owner' or auth_role_category() = 'finance'));

create index if not exists mr_account_idx on public.mileage_requests(account_id, created_at desc);
