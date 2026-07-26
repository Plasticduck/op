-- Standalone artwork library entries: PDFs uploaded directly to the library,
-- not tied to any order. The library view merges these with the artwork attached
-- to past orders. Files live in the same signage-artwork bucket.
create table if not exists public.signage_artwork (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  path       text not null,
  name       text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (account_id, path)
);
create index if not exists signage_artwork_acct_idx on public.signage_artwork (account_id, created_at desc);

alter table public.signage_artwork enable row level security;

create policy signage_artwork_lib_select on public.signage_artwork
  for select using (account_id = auth_account_id());
create policy signage_artwork_lib_insert on public.signage_artwork
  for insert with check (account_id = auth_account_id());
create policy signage_artwork_lib_delete on public.signage_artwork
  for delete using (account_id = auth_account_id() and auth_is_manager_plus());
