-- Signage becomes a simple order form (like supplies requests). One row per
-- request, plus a private bucket for the artwork PDF, scoped to the account.
create table if not exists public.signage_requests (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  location_id   uuid not null references public.locations(id) on delete cascade,
  requested_by  uuid references public.users(id) on delete set null,
  first_name    text,
  last_name     text,
  sign_category text not null,
  sign_type     text,
  width         numeric,
  height        numeric,
  size_unit     text not null default 'in',   -- 'in' | 'ft'
  quantity      numeric not null default 1,
  artwork_path  text,
  artwork_name  text,
  status        text not null default 'pending',
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists signage_requests_loc_idx
  on public.signage_requests (location_id, created_at desc);

alter table public.signage_requests enable row level security;

create policy signage_requests_select on public.signage_requests
  for select using (account_id = auth_account_id() and auth_has_location(location_id));
create policy signage_requests_insert on public.signage_requests
  for insert with check (account_id = auth_account_id() and auth_has_location(location_id));
create policy signage_requests_update on public.signage_requests
  for update using (account_id = auth_account_id() and auth_is_manager_plus())
  with check (account_id = auth_account_id() and auth_is_manager_plus());
create policy signage_requests_delete on public.signage_requests
  for delete using (account_id = auth_account_id() and auth_is_manager_plus());

-- Private artwork bucket. Files live under <account_id>/..., and policies scope
-- read + upload to the caller's own account folder.
insert into storage.buckets (id, name, public)
values ('signage-artwork', 'signage-artwork', false)
on conflict (id) do nothing;

create policy signage_artwork_read on storage.objects
  for select using (
    bucket_id = 'signage-artwork'
    and (storage.foldername(name))[1] = auth_account_id()::text
  );
create policy signage_artwork_insert on storage.objects
  for insert with check (
    bucket_id = 'signage-artwork'
    and (storage.foldername(name))[1] = auth_account_id()::text
  );
