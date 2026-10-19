-- Link Operator employee rows to their iSolved employee number so the active
-- iSolved roster can be synced in as schedulable labor — no manual profile
-- creation. The sync upserts by this number. Unique so upserts are idempotent;
-- NULL (non-iSolved accounts / manually-created staff) stays unconstrained since
-- NULLs are distinct in a btree unique index.
alter table public.employees
  add column if not exists isolved_number text;

create unique index if not exists employees_isolved_number_key
  on public.employees (isolved_number);
