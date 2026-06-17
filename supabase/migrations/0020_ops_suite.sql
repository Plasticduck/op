-- 0020_ops_suite.sql — tables for the migrated Mighty Wash ops suite:
-- Monthly Site Review, Site Audit, Staffing/Leadership/Culture Notes, Invoice
-- Approval, and Inventory (catalog + counts).
--
-- These are leadership/back-office records. RLS is account-scoped: any user in
-- the account can read; managers+ write; owners delete. Legacy attribution is
-- preserved in *_name columns (the old app stored submitter as free text).

-- Monthly Site Review --------------------------------------------------------
create table public.site_evaluations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  result text,
  answers jsonb not null default '{}',
  additional_notes text,
  follow_up_instructions text,
  submitted_by uuid references public.users(id) on delete set null,
  submitted_by_name text,
  submitted_at timestamptz not null default now()
);
create index on public.site_evaluations (account_id, submitted_at desc);

-- Site Audit -----------------------------------------------------------------
create table public.site_audits (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  initial_observations text,
  primary_section jsonb,
  secondary_section jsonb,
  priority_section jsonb,
  final_thoughts jsonb,
  section_comments jsonb,
  photos jsonb,
  explanation text,
  submitted_by uuid references public.users(id) on delete set null,
  submitted_by_name text,
  created_at timestamptz not null default now()
);
create index on public.site_audits (account_id, created_at desc);

-- Staffing / Leadership / Culture Notes --------------------------------------
create table public.ops_notes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  department text,
  note_type text,
  other_description text,
  additional_notes text,
  submitted_by uuid references public.users(id) on delete set null,
  submitted_by_name text,
  created_at timestamptz not null default now()
);
create index on public.ops_notes (account_id, created_at desc);

-- Invoice Approval -----------------------------------------------------------
create table public.ops_invoices (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  vendor_name text,
  invoice_date date,
  amount numeric not null default 0,
  gl_code text,
  status text not null default 'pending',
  file_name text,
  file_type text,
  assigned_to uuid references public.users(id) on delete set null,
  assigned_to_name text,
  submitted_by uuid references public.users(id) on delete set null,
  submitted_by_name text,
  submitted_at timestamptz not null default now(),
  decided_by uuid references public.users(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  decision_reason text
);
create index on public.ops_invoices (account_id, status);

-- Inventory catalog (account-level) ------------------------------------------
create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  category text,
  brand text,
  item text,
  created_at timestamptz not null default now()
);
create index on public.inventory_items (account_id, category);

-- Inventory counts (per site) ------------------------------------------------
create table public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  category text,
  brand text,
  item text,
  quantity numeric not null default 0,
  submitted_by uuid references public.users(id) on delete set null,
  submitted_by_name text,
  created_at timestamptz not null default now()
);
create index on public.inventory_counts (account_id, created_at desc);

-- RLS: account members read; managers+ write; owners delete. -----------------
do $$
declare t text;
begin
  foreach t in array array[
    'site_evaluations','site_audits','ops_notes','ops_invoices',
    'inventory_items','inventory_counts'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$
      create policy %1$s_select on public.%1$s for select
        using (account_id = public.auth_account_id());
    $f$, t);
    execute format($f$
      create policy %1$s_insert on public.%1$s for insert
        with check (account_id = public.auth_account_id() and public.auth_is_manager_plus());
    $f$, t);
    execute format($f$
      create policy %1$s_update on public.%1$s for update
        using (account_id = public.auth_account_id() and public.auth_is_manager_plus())
        with check (account_id = public.auth_account_id() and public.auth_is_manager_plus());
    $f$, t);
    execute format($f$
      create policy %1$s_delete on public.%1$s for delete
        using (account_id = public.auth_account_id() and public.auth_role() = 'owner');
    $f$, t);
  end loop;
end $$;
