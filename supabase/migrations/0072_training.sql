-- Training: a library of training material with per-employee assignment and
-- completion tracking, new-hire onboarding checklists with step sign-offs, and
-- employee certifications with expiration tracking. Managers manage everything;
-- employees can see and complete their own items.

-- ---------- Training library ----------
create table if not exists public.training_items (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  title        text not null,
  description  text,
  category     text,
  content_type text not null default 'link',   -- 'link' | 'video' | 'text'
  url          text,
  body         text,
  roles        text[],                          -- empty/null = applies to everyone
  required     boolean not null default false,
  active       boolean not null default true,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists training_items_acct_idx on public.training_items (account_id, active);

-- ---------- Assignment + completion ----------
create table if not exists public.training_assignments (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  training_item_id uuid not null references public.training_items(id) on delete cascade,
  employee_id      uuid not null references public.employees(id) on delete cascade,
  location_id      uuid references public.locations(id) on delete set null,
  due_date         date,
  assigned_by      uuid references public.users(id) on delete set null,
  assigned_at      timestamptz not null default now(),
  completed_at     timestamptz,
  completed_by     uuid references public.users(id) on delete set null,
  notes            text,
  unique (training_item_id, employee_id)
);
create index if not exists training_assignments_emp_idx on public.training_assignments (employee_id);
create index if not exists training_assignments_acct_idx on public.training_assignments (account_id, completed_at);

-- ---------- Onboarding ----------
create table if not exists public.onboarding_templates (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name       text not null,
  -- [{ "key": "uniform", "label": "Issue uniform" }, ...] in display order
  steps      jsonb not null default '[]'::jsonb,
  active     boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_onboarding (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  location_id  uuid references public.locations(id) on delete set null,
  template_id  uuid references public.onboarding_templates(id) on delete set null,
  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  -- { "<stepKey>": { "done": true, "by_name": "...", "at": "...", "note": "..." } }
  step_state   jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  unique (employee_id, template_id)
);
create index if not exists employee_onboarding_acct_idx on public.employee_onboarding (account_id, completed_at);

-- ---------- Certifications ----------
create table if not exists public.certifications (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  location_id  uuid references public.locations(id) on delete set null,
  name         text not null,
  issuer       text,
  issued_on    date,
  expires_on   date,
  document_url text,
  notes        text,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists certifications_expiry_idx on public.certifications (account_id, expires_on);

-- ---------- RLS ----------
alter table public.training_items enable row level security;
alter table public.training_assignments enable row level security;
alter table public.onboarding_templates enable row level security;
alter table public.employee_onboarding enable row level security;
alter table public.certifications enable row level security;

-- Library and onboarding templates are readable by the whole account; only
-- managers+ maintain them.
create policy training_items_select on public.training_items
  for select using (account_id = auth_account_id());
create policy training_items_write on public.training_items
  for all using (account_id = auth_account_id() and auth_is_manager_plus())
  with check (account_id = auth_account_id() and auth_is_manager_plus());

create policy onboarding_templates_select on public.onboarding_templates
  for select using (account_id = auth_account_id());
create policy onboarding_templates_write on public.onboarding_templates
  for all using (account_id = auth_account_id() and auth_is_manager_plus())
  with check (account_id = auth_account_id() and auth_is_manager_plus());

-- Employee-scoped records: managers+ see all in the account, employees see only
-- their own. Employees may update their own assignment (to mark it complete).
create policy training_assignments_select on public.training_assignments
  for select using (
    account_id = auth_account_id()
    and (auth_is_manager_plus() or employee_id = auth_employee_id())
  );
create policy training_assignments_write on public.training_assignments
  for all using (account_id = auth_account_id() and auth_is_manager_plus())
  with check (account_id = auth_account_id() and auth_is_manager_plus());
create policy training_assignments_self_update on public.training_assignments
  for update using (account_id = auth_account_id() and employee_id = auth_employee_id())
  with check (account_id = auth_account_id() and employee_id = auth_employee_id());

create policy employee_onboarding_select on public.employee_onboarding
  for select using (
    account_id = auth_account_id()
    and (auth_is_manager_plus() or employee_id = auth_employee_id())
  );
create policy employee_onboarding_write on public.employee_onboarding
  for all using (account_id = auth_account_id() and auth_is_manager_plus())
  with check (account_id = auth_account_id() and auth_is_manager_plus());

create policy certifications_select on public.certifications
  for select using (
    account_id = auth_account_id()
    and (auth_is_manager_plus() or employee_id = auth_employee_id())
  );
create policy certifications_write on public.certifications
  for all using (account_id = auth_account_id() and auth_is_manager_plus())
  with check (account_id = auth_account_id() and auth_is_manager_plus());
