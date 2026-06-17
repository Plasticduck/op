-- 0022_ops_attachments.sql — file attachments for ops-suite records, plus a
-- department column on site_violations (the old "notes" app tracked violations
-- by department: Accounting, HR, Operations, IT, Safety).
--
-- Attachments are stored as base64 data URIs in their own table so the list
-- queries (which select * from the parent tables) stay light — the blob is only
-- fetched when a user opens a record and views the file.

alter table public.site_violations add column if not exists department text;

create table public.ops_attachments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  entity_type text not null,           -- 'violation' | 'invoice' | 'audit' | 'evaluation'
  entity_id uuid not null,
  label text,                          -- optional caption (e.g. audit section)
  file_name text,
  file_type text,
  data_uri text not null,
  created_at timestamptz not null default now()
);
create index on public.ops_attachments (account_id, entity_type, entity_id);

-- RLS: account members read; managers+ write; owners delete (matches 0020/0021).
do $$
declare t text;
begin
  foreach t in array array['ops_attachments'] loop
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
