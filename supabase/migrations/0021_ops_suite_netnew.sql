-- 0021_ops_suite_netnew.sql — net-new ops-suite modules that had no source data
-- in the old app: Capital Improvement Requests, Market Research, and Site
-- Violations. Same account-scoped RLS as 0020: members read, managers+ write,
-- owners delete. Attribution stored in both *_by (uuid) and *_by_name (text).

-- Capital Improvement Requests -----------------------------------------------
create table public.capital_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  title text not null,
  description text,
  category text,
  estimated_cost numeric,
  priority text not null default 'medium',
  status text not null default 'pending',
  requested_by uuid references public.users(id) on delete set null,
  requested_by_name text,
  decided_by uuid references public.users(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now()
);
create index on public.capital_requests (account_id, status);

-- Market Research ------------------------------------------------------------
create table public.market_research (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  title text not null,
  research_type text,
  competitor_name text,
  content text,
  source_url text,
  submitted_by uuid references public.users(id) on delete set null,
  submitted_by_name text,
  created_at timestamptz not null default now()
);
create index on public.market_research (account_id, created_at desc);

-- Site Violations ------------------------------------------------------------
create table public.site_violations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  violation_type text,
  severity text not null default 'minor',
  description text,
  status text not null default 'open',
  due_date date,
  reported_by uuid references public.users(id) on delete set null,
  reported_by_name text,
  reported_at timestamptz not null default now(),
  resolved_by uuid references public.users(id) on delete set null,
  resolved_by_name text,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz not null default now()
);
create index on public.site_violations (account_id, status);

-- RLS: account members read; managers+ write; owners delete. -----------------
do $$
declare t text;
begin
  foreach t in array array['capital_requests','market_research','site_violations'] loop
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
