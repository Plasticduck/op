-- Procedures: MaintainX-style reusable templates (checklists / inspections /
-- forms) with typed fields, attachable to a work order and filled out on the job.
-- When attached to a work order the template's fields are SNAPSHOT onto the work
-- order so later template edits don't change past work orders.

-- Reusable templates ------------------------------------------------------
create table if not exists public.procedure_templates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  description text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists procedure_templates_account_idx on public.procedure_templates (account_id, name);
alter table public.procedure_templates enable row level security;
drop policy if exists procedure_templates_select on public.procedure_templates;
drop policy if exists procedure_templates_write on public.procedure_templates;
create policy procedure_templates_select on public.procedure_templates for select
  using (account_id = auth_account_id());
create policy procedure_templates_write on public.procedure_templates for all
  using (account_id = auth_account_id() and auth_is_manager_plus())
  with check (account_id = auth_account_id() and auth_is_manager_plus());

-- Field types: section (heading), checkbox, text, number, amount (money),
-- inspection (pass/fail/flag), multiple_choice (options[]), date.
create table if not exists public.procedure_fields (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.procedure_templates(id) on delete cascade,
  order_index int not null default 0,
  label text not null,
  type text not null default 'checkbox'
    check (type in ('section','checkbox','text','number','amount','inspection','multiple_choice','date')),
  required boolean not null default false,
  options jsonb not null default '[]'::jsonb
);
create index if not exists procedure_fields_template_idx on public.procedure_fields (template_id, order_index);
alter table public.procedure_fields enable row level security;
drop policy if exists procedure_fields_select on public.procedure_fields;
drop policy if exists procedure_fields_write on public.procedure_fields;
create policy procedure_fields_select on public.procedure_fields for select
  using (exists (select 1 from public.procedure_templates t
    where t.id = procedure_fields.template_id and t.account_id = auth_account_id()));
create policy procedure_fields_write on public.procedure_fields for all
  using (exists (select 1 from public.procedure_templates t
    where t.id = procedure_fields.template_id and t.account_id = auth_account_id() and auth_is_manager_plus()))
  with check (exists (select 1 from public.procedure_templates t
    where t.id = procedure_fields.template_id and t.account_id = auth_account_id() and auth_is_manager_plus()));

-- A procedure attached to a work order (snapshot instance) -----------------
create table if not exists public.work_order_procedures (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  template_id uuid references public.procedure_templates(id) on delete set null,
  name text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists work_order_procedures_wo_idx on public.work_order_procedures (work_order_id);
alter table public.work_order_procedures enable row level security;
drop policy if exists work_order_procedures_all on public.work_order_procedures;
create policy work_order_procedures_all on public.work_order_procedures for all
  using (exists (select 1 from public.work_orders w
    where w.id = work_order_procedures.work_order_id and w.account_id = auth_account_id() and auth_has_location(w.location_id)))
  with check (exists (select 1 from public.work_orders w
    where w.id = work_order_procedures.work_order_id and w.account_id = auth_account_id() and auth_has_location(w.location_id)));

-- Snapshot fields + their responses (one row per field per instance) --------
create table if not exists public.work_order_procedure_items (
  id uuid primary key default gen_random_uuid(),
  wo_procedure_id uuid not null references public.work_order_procedures(id) on delete cascade,
  order_index int not null default 0,
  label text not null,
  type text not null default 'checkbox',
  required boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  value text,
  responded_by uuid references public.users(id) on delete set null,
  responded_at timestamptz
);
create index if not exists work_order_procedure_items_proc_idx on public.work_order_procedure_items (wo_procedure_id, order_index);
alter table public.work_order_procedure_items enable row level security;
drop policy if exists work_order_procedure_items_all on public.work_order_procedure_items;
create policy work_order_procedure_items_all on public.work_order_procedure_items for all
  using (exists (select 1 from public.work_order_procedures p join public.work_orders w on w.id = p.work_order_id
    where p.id = work_order_procedure_items.wo_procedure_id and w.account_id = auth_account_id() and auth_has_location(w.location_id)))
  with check (exists (select 1 from public.work_order_procedures p join public.work_orders w on w.id = p.work_order_id
    where p.id = work_order_procedure_items.wo_procedure_id and w.account_id = auth_account_id() and auth_has_location(w.location_id)));
