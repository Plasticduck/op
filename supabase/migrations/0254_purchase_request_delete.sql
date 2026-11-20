-- Purchase Request: the super admin (kevan@washlyfe.com) can delete a request
-- from any tab (Kevan, 2026-11-20).
--
-- A request that was sent carries an e-signature envelope whose signatures,
-- consents and audit trail are permanent by design (migration 0238's guards let
-- only a database admin past them). purchase_request_delete runs as that admin,
-- but only for the super admin, and takes the whole request with it: its
-- envelopes (with their recipients and events), files and bell notifications.
-- People's e-signature consents stay, since they cover every document they sign,
-- not this one. A row in purchase_request_deletions records what was deleted and
-- by whom.
--
-- Files in storage are removed by the app with the paths the function returns,
-- so the super admin also gets read and delete on the account's request files.

create table if not exists public.purchase_request_deletions (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  request_id      uuid not null,
  number          bigint,
  title           text,
  requester_name  text,
  total           numeric(12, 2),
  status          text,
  ever_sent       boolean,
  envelope_count  int not null default 0,
  file_count      int not null default 0,
  deleted_by      uuid references public.users(id) on delete set null,
  deleted_by_name text,
  deleted_at      timestamptz not null default now()
);
alter table public.purchase_request_deletions enable row level security;
drop policy if exists purchase_request_deletions_read on public.purchase_request_deletions;
create policy purchase_request_deletions_read on public.purchase_request_deletions for select to authenticated
  using (account_id = public.auth_account_id() and public.auth_is_super_admin());

create or replace function public.purchase_request_delete(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pr public.purchase_requests;
  me public.users;
  paths text[];
  n_env int;
  n_files int;
begin
  if not public.auth_is_super_admin() then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into me from public.users where id = auth.uid();
  select * into pr from public.purchase_requests where id = p_id for update;
  if not found or pr.account_id is distinct from me.account_id then raise exception 'not_found' using errcode = 'P0002'; end if;

  -- Every stored file under the request's folder (attachments, paper
  -- signatures, sealed PDFs), plus any path the rows name elsewhere.
  select coalesce(array_agg(distinct p), '{}') into paths from (
    select o.name as p from storage.objects o
      where o.bucket_id = 'purchase-requests' and o.name like pr.account_id::text || '/' || pr.id::text || '/%'
    union select f.path from public.purchase_request_files f where f.request_id = pr.id
    union select e.sealed_pdf_path from public.esign_envelopes e
      where e.source_type = 'purchase_request' and e.source_id = pr.id and e.sealed_pdf_path is not null
  ) x where p is not null;
  select count(*) into n_env from public.esign_envelopes where source_type = 'purchase_request' and source_id = pr.id;
  select count(*) into n_files from public.purchase_request_files where request_id = pr.id;

  insert into public.purchase_request_deletions
    (account_id, request_id, number, title, requester_name, total, status, ever_sent, envelope_count, file_count, deleted_by, deleted_by_name)
  values (pr.account_id, pr.id, pr.number, pr.title, pr.requester_name, pr.total, pr.status, pr.ever_sent, n_env, n_files, me.id, me.name);

  delete from public.notifications where kind = 'purchase_request' and payload->>'request_id' = pr.id::text;
  -- The request (and its file rows) first, then its envelopes (and their
  -- recipients and events).
  delete from public.purchase_requests where id = pr.id;
  delete from public.esign_envelopes where source_type = 'purchase_request' and source_id = pr.id;

  return jsonb_build_object('ok', true, 'number', pr.number, 'title', pr.title, 'envelopes', n_env, 'files', n_files, 'paths', to_jsonb(paths));
end $$;
revoke all on function public.purchase_request_delete(uuid) from public, anon;
grant execute on function public.purchase_request_delete(uuid) to authenticated;

drop policy if exists purchase_requests_files_admin_read on storage.objects;
create policy purchase_requests_files_admin_read on storage.objects for select to authenticated using (
  bucket_id = 'purchase-requests'
  and (storage.foldername(name))[1] = public.auth_account_id()::text
  and public.auth_is_super_admin());
drop policy if exists purchase_requests_files_admin_delete on storage.objects;
create policy purchase_requests_files_admin_delete on storage.objects for delete to authenticated using (
  bucket_id = 'purchase-requests'
  and (storage.foldername(name))[1] = public.auth_account_id()::text
  and public.auth_is_super_admin());
