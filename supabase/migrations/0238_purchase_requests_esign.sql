-- Purchase Requests (Finance) and Operator's e-signature engine (2026-11-13).
--
-- A purchase request is drafted by its requester, then sent for signature: the
-- requester signs it, and one or more approvers sign it in order (or in any
-- order). Signing runs through esign_* tables, built so other documents can use
-- them later (source_type). The design follows the federal ESIGN Act (15 U.S.C.
-- 7001 et seq.) and the Texas Uniform Electronic Transactions Act (Tex. Bus. &
-- Com. Code ch. 322); docs/purchase-requests/ESIGN.md maps each requirement.
--
-- Every signing step (send, view, consent, sign, decline, void, seal) is written
-- by the purchase-requests edge function with the service role, so timestamps and
-- IP addresses come from the server, never the browser. The app can only read
-- these records. Audit records are append-only, signed content can't change, and
-- nothing signed can be deleted (triggers below); only a database admin can.

-- ---------------------------------------------------------------- disclosures
-- The Electronic Record and Signature Disclosure a person agrees to before they
-- first sign. {company} is replaced with the account's name when shown.
create table if not exists public.esign_disclosures (
  version     text primary key,
  title       text not null,
  body        text not null,
  body_sha256 text not null,
  active      boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.esign_disclosures enable row level security;
create policy esign_disclosures_read on public.esign_disclosures for select to authenticated using (true);

-- --------------------------------------------------------------- consents
create table if not exists public.esign_consents (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts(id) on delete cascade,
  user_id              uuid references public.users(id) on delete set null,
  user_name            text not null,
  user_email           text not null,
  disclosure_version   text not null references public.esign_disclosures(version),
  disclosure_sha256    text not null,
  consented_at         timestamptz not null default clock_timestamp(),
  ip                   text,
  user_agent           text,
  withdrawn_at         timestamptz,
  withdrawn_ip         text,
  withdrawn_user_agent text
);
create index if not exists esign_consents_user on public.esign_consents (user_id, consented_at desc);
alter table public.esign_consents enable row level security;

-- --------------------------------------------------------------- envelopes
create table if not exists public.esign_envelopes (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts(id) on delete cascade,
  source_type          text not null check (source_type in ('purchase_request')),
  source_id            uuid not null,
  version              int not null default 1,
  title                text not null,
  message              text,
  document             jsonb not null,            -- the exact content signed
  document_hash        text not null,             -- SHA-256 of its canonical JSON
  sign_in_order        boolean not null default true,
  status               text not null default 'sent' check (status in ('sent', 'completed', 'declined', 'voided')),
  created_by           uuid references public.users(id) on delete set null,
  created_by_name      text not null,
  created_by_email     text not null,
  created_ip           text,
  created_user_agent   text,
  sent_at              timestamptz not null default clock_timestamp(),
  completed_at         timestamptz,
  declined_at          timestamptz,
  voided_at            timestamptz,
  void_reason          text,
  voided_by_name       text,
  sealed_pdf_path      text,
  sealed_pdf_sha256    text,
  sealed_at            timestamptz,
  seal_certificate     text,                      -- subject + SHA-256 fingerprint of the seal certificate
  seal_error           text,
  last_reminded_at     timestamptz,
  created_at           timestamptz not null default now(),
  unique (source_type, source_id, version)
);
create index if not exists esign_envelopes_source on public.esign_envelopes (source_type, source_id);
create index if not exists esign_envelopes_sealed on public.esign_envelopes (sealed_pdf_sha256) where sealed_pdf_sha256 is not null;
alter table public.esign_envelopes enable row level security;

-- -------------------------------------------------------------- recipients
-- role: 'sender' signs when sending (the requester), 'signer' approves, 'cc' gets
-- the completed copy. Same routing_order = sign at the same time.
create table if not exists public.esign_recipients (
  id                    uuid primary key default gen_random_uuid(),
  envelope_id           uuid not null references public.esign_envelopes(id) on delete cascade,
  account_id            uuid not null references public.accounts(id) on delete cascade,
  user_id               uuid references public.users(id) on delete set null,
  name                  text not null,
  email                 text not null,
  role                  text not null check (role in ('sender', 'signer', 'cc')),
  label                 text,
  routing_order         int not null,
  required_by_rule      text,
  status                text not null default 'waiting' check (status in ('waiting', 'sent', 'viewed', 'signed', 'declined', 'completed')),
  sent_at               timestamptz,
  viewed_at             timestamptz,
  signed_at             timestamptz,
  declined_at           timestamptz,
  decline_reason        text,
  paper_requested_at    timestamptz,
  signature_kind        text check (signature_kind in ('drawn', 'typed', 'paper')),
  signature_image       text check (signature_image is null or length(signature_image) < 400000),
  signature_name        text,
  signature_sha256      text,
  signed_document_hash  text,
  consent_id            uuid references public.esign_consents(id),
  ip                    text,
  user_agent            text,
  paper_file_path       text,
  paper_file_sha256     text,
  paper_recorded_by     text,
  created_at            timestamptz not null default now()
);
create index if not exists esign_recipients_envelope on public.esign_recipients (envelope_id, routing_order);
create index if not exists esign_recipients_user on public.esign_recipients (user_id);
alter table public.esign_recipients enable row level security;

-- ------------------------------------------------------------------ events
create table if not exists public.esign_events (
  id            bigint generated always as identity primary key,
  envelope_id   uuid not null references public.esign_envelopes(id) on delete cascade,
  account_id    uuid not null references public.accounts(id) on delete cascade,
  recipient_id  uuid references public.esign_recipients(id) on delete set null,
  actor_user_id uuid references public.users(id) on delete set null,
  actor_name    text,
  actor_email   text,
  event         text not null,
  at            timestamptz not null default clock_timestamp(),
  ip            text,
  user_agent    text,
  detail        jsonb not null default '{}'::jsonb
);
create index if not exists esign_events_envelope on public.esign_events (envelope_id, id);
alter table public.esign_events enable row level security;

-- A person's adopted signature, offered again next time they sign.
create table if not exists public.esign_saved_signatures (
  user_id    uuid primary key references public.users(id) on delete cascade,
  kind       text not null check (kind in ('drawn', 'typed')),
  image      text not null check (length(image) < 400000),
  typed_name text,
  updated_at timestamptz not null default now()
);
alter table public.esign_saved_signatures enable row level security;
create policy esign_saved_signatures_own on public.esign_saved_signatures for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- -------------------------------------------------------- purchase requests
create table if not exists public.purchase_requests (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  number            bigint generated always as identity (start with 1001) unique,
  requester_id      uuid references public.users(id) on delete set null,
  requester_name    text not null default '',
  requester_email   text not null default '',
  title             text not null default '',
  vendor            text,
  site              text,
  category          text,
  gl_code           text,
  payment_method    text,
  needed_by         date,
  priority          text not null default 'normal' check (priority in ('normal', 'urgent')),
  justification     text,
  line_items        jsonb not null default '[]'::jsonb check (jsonb_typeof(line_items) = 'array'),
  subtotal          numeric(12, 2) not null default 0,
  shipping          numeric(12, 2) not null default 0 check (shipping >= 0),
  tax               numeric(12, 2) not null default 0 check (tax >= 0),
  total             numeric(12, 2) not null default 0,
  status            text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'purchased', 'declined', 'voided')),
  envelope_id       uuid references public.esign_envelopes(id) on delete set null,
  ever_sent         boolean not null default false,
  submitted_at      timestamptz,
  approved_at       timestamptz,
  closed_at         timestamptz,
  purchased_at      timestamptz,
  purchased_by      uuid references public.users(id) on delete set null,
  purchased_by_name text,
  po_number         text,
  actual_amount     numeric(12, 2),
  purchase_note     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists purchase_requests_account on public.purchase_requests (account_id, status, created_at desc);
create index if not exists purchase_requests_requester on public.purchase_requests (requester_id);
alter table public.purchase_requests enable row level security;

create table if not exists public.purchase_request_files (
  id               uuid primary key default gen_random_uuid(),
  request_id       uuid not null references public.purchase_requests(id) on delete cascade,
  account_id       uuid not null references public.accounts(id) on delete cascade,
  path             text not null,
  name             text not null,
  size             bigint,
  mime             text,
  sha256           text,
  kind             text not null default 'attachment' check (kind in ('attachment', 'paper_signature')),
  locked           boolean not null default false,   -- part of a sent envelope: kept for the record
  removed_at       timestamptz,                      -- taken off the draft (kept if locked)
  uploaded_by      uuid references public.users(id) on delete set null,
  uploaded_by_name text,
  created_at       timestamptz not null default now()
);
create index if not exists purchase_request_files_request on public.purchase_request_files (request_id);
alter table public.purchase_request_files enable row level security;

-- Owner-set rules: a request at or above min_amount (and of the category, when
-- set) must also be signed by these people. Enforced when a request is sent.
create table if not exists public.purchase_approval_rules (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  label       text,
  min_amount  numeric(12, 2) not null default 0 check (min_amount >= 0),
  category    text,
  signer_ids  uuid[] not null default '{}',
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.purchase_approval_rules enable row level security;

-- ------------------------------------------------------------------ helpers
create or replace function public.pr_is_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'owner' or role_category = 'finance' from public.users where id = auth.uid()), false)
$$;

create or replace function public.pr_me()
returns table (name text, email text) language sql stable security definer set search_path = public as $$
  select name, email from public.users where id = auth.uid()
$$;

create or replace function public.pr_is_recipient(p_request uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.esign_envelopes e
    join public.esign_recipients r on r.envelope_id = e.id
    where e.source_type = 'purchase_request' and e.source_id = p_request and r.user_id = auth.uid()
  )
$$;

create or replace function public.pr_can_view(p_request uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.purchase_requests p
    where p.id = p_request and p.account_id = public.auth_account_id()
      and (p.requester_id = auth.uid() or public.pr_is_finance() or public.pr_is_recipient(p.id))
  )
$$;

create or replace function public.pr_is_my_draft(p_request uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.purchase_requests
    where id = p_request and requester_id = auth.uid() and status = 'draft' and account_id = public.auth_account_id()
  )
$$;

create or replace function public.esign_can_view(p_envelope uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.esign_envelopes e
    where e.id = p_envelope and e.account_id = public.auth_account_id()
      and (e.created_by = auth.uid() or public.pr_is_finance()
        or exists (select 1 from public.esign_recipients r where r.envelope_id = e.id and r.user_id = auth.uid())
        or (e.source_type = 'purchase_request'
            and exists (select 1 from public.purchase_requests p where p.id = e.source_id and p.requester_id = auth.uid())))
  )
$$;

-- Storage paths are <account_id>/<request_id>/...; the request id, or null.
create or replace function public.pr_path_request(p_name text)
returns uuid language plpgsql stable set search_path = public as $$
declare parts text[] := storage.foldername(p_name);
begin
  if coalesce(array_length(parts, 1), 0) < 2 or parts[2] !~ '^[0-9a-fA-F-]{36}$' then return null; end if;
  return parts[2]::uuid;
end $$;

-- --------------------------------------------------------------------- RLS
create policy purchase_requests_read on public.purchase_requests for select to authenticated
  using (account_id = public.auth_account_id()
    and (requester_id = auth.uid() or public.pr_is_finance() or public.pr_is_recipient(id)));
create policy purchase_requests_insert on public.purchase_requests for insert to authenticated
  with check (account_id = public.auth_account_id() and requester_id = auth.uid() and status = 'draft');
create policy purchase_requests_update on public.purchase_requests for update to authenticated
  using (requester_id = auth.uid() and status = 'draft' and account_id = public.auth_account_id())
  with check (requester_id = auth.uid() and status = 'draft' and account_id = public.auth_account_id());
create policy purchase_requests_delete on public.purchase_requests for delete to authenticated
  using (requester_id = auth.uid() and status = 'draft' and not ever_sent and account_id = public.auth_account_id());

create policy purchase_request_files_read on public.purchase_request_files for select to authenticated
  using (account_id = public.auth_account_id() and public.pr_can_view(request_id));
create policy purchase_request_files_insert on public.purchase_request_files for insert to authenticated
  with check (account_id = public.auth_account_id() and kind = 'attachment' and uploaded_by = auth.uid()
    and public.pr_is_my_draft(request_id));
-- A file on a draft can be taken off it (removed_at); one that was part of a sent
-- request stays in storage for the record.
create policy purchase_request_files_remove on public.purchase_request_files for update to authenticated
  using (account_id = public.auth_account_id() and public.pr_is_my_draft(request_id))
  with check (account_id = public.auth_account_id() and public.pr_is_my_draft(request_id));
revoke update on public.purchase_request_files from authenticated;
grant update (removed_at) on public.purchase_request_files to authenticated;
create policy purchase_request_files_delete on public.purchase_request_files for delete to authenticated
  using (account_id = public.auth_account_id() and not locked and kind = 'attachment' and public.pr_is_my_draft(request_id));

create policy purchase_approval_rules_read on public.purchase_approval_rules for select to authenticated
  using (account_id = public.auth_account_id());
create policy purchase_approval_rules_write on public.purchase_approval_rules for all to authenticated
  using (account_id = public.auth_account_id() and public.auth_role() = 'owner')
  with check (account_id = public.auth_account_id() and public.auth_role() = 'owner');

create policy esign_envelopes_read on public.esign_envelopes for select to authenticated
  using (public.esign_can_view(id));
create policy esign_recipients_read on public.esign_recipients for select to authenticated
  using (public.esign_can_view(envelope_id));
create policy esign_events_read on public.esign_events for select to authenticated
  using (public.esign_can_view(envelope_id));
create policy esign_consents_read on public.esign_consents for select to authenticated
  using (user_id = auth.uid() or (account_id = public.auth_account_id() and public.pr_is_finance()));

-- ----------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit)
values ('purchase-requests', 'purchase-requests', false, 26214400)
on conflict (id) do nothing;

create policy purchase_requests_files_read on storage.objects for select to authenticated using (
  bucket_id = 'purchase-requests'
  and (storage.foldername(name))[1] = public.auth_account_id()::text
  and public.pr_can_view(public.pr_path_request(name)));
create policy purchase_requests_files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'purchase-requests'
  and (storage.foldername(name))[1] = public.auth_account_id()::text
  and public.pr_is_my_draft(public.pr_path_request(name)));
create policy purchase_requests_files_delete on storage.objects for delete to authenticated using (
  bucket_id = 'purchase-requests'
  and (storage.foldername(name))[1] = public.auth_account_id()::text
  and public.pr_is_my_draft(public.pr_path_request(name))
  and not exists (select 1 from public.purchase_request_files f where f.path = name and f.locked));

-- ---------------------------------------------------------------- triggers
-- The app writes only a draft's own fields. Who requested it, its number, status
-- and everything set by the workflow are kept from the server; totals are always
-- worked out here from the line items.
create or replace function public.purchase_requests_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  sub numeric := 0;
  it jsonb;
  me record;
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      select * into me from public.pr_me();
      new.account_id := public.auth_account_id();
      new.requester_id := auth.uid();
      new.requester_name := coalesce(me.name, '');
      new.requester_email := coalesce(me.email, '');
      new.status := 'draft';
      new.envelope_id := null;
      new.ever_sent := false;
      new.submitted_at := null; new.approved_at := null; new.closed_at := null;
      new.purchased_at := null; new.purchased_by := null; new.purchased_by_name := null;
      new.po_number := null; new.actual_amount := null; new.purchase_note := null;
      new.created_at := now();
    else
      new.id := old.id; new.account_id := old.account_id;
      new.requester_id := old.requester_id; new.requester_name := old.requester_name; new.requester_email := old.requester_email;
      new.status := old.status; new.envelope_id := old.envelope_id; new.ever_sent := old.ever_sent;
      new.submitted_at := old.submitted_at; new.approved_at := old.approved_at; new.closed_at := old.closed_at;
      new.purchased_at := old.purchased_at; new.purchased_by := old.purchased_by; new.purchased_by_name := old.purchased_by_name;
      new.po_number := old.po_number; new.actual_amount := old.actual_amount; new.purchase_note := old.purchase_note;
      new.created_at := old.created_at;
    end if;
  end if;
  for it in select * from jsonb_array_elements(coalesce(new.line_items, '[]'::jsonb)) loop
    sub := sub + round(coalesce(nullif(it->>'quantity', '')::numeric, 0) * coalesce(nullif(it->>'unit_price', '')::numeric, 0), 2);
  end loop;
  new.subtotal := sub;
  new.total := sub + coalesce(new.shipping, 0) + coalesce(new.tax, 0);
  new.updated_at := now();
  return new;
end $$;
create trigger purchase_requests_guard before insert or update on public.purchase_requests
  for each row execute function public.purchase_requests_guard();

create or replace function public.purchase_request_files_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.account_id := public.auth_account_id();
    new.uploaded_by := auth.uid();
    new.uploaded_by_name := (select name from public.pr_me());
    new.locked := false;
    new.removed_at := null;
    new.kind := 'attachment';
  end if;
  return new;
end $$;
create trigger purchase_request_files_guard before insert on public.purchase_request_files
  for each row execute function public.purchase_request_files_guard();

-- Only a database admin (migrations, support) may get past these.
create or replace function public.esign_is_admin()
returns boolean language sql stable as $$ select current_user in ('postgres', 'supabase_admin') $$;

-- Envelopes: what was signed, its fingerprint and its seal never change, a
-- finished envelope stays finished, and none are deleted.
create or replace function public.esign_envelopes_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.esign_is_admin() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    raise exception 'E-signature envelopes are permanent records and cannot be deleted';
  end if;
  if new.document is distinct from old.document or new.document_hash is distinct from old.document_hash
     or new.account_id is distinct from old.account_id or new.source_type is distinct from old.source_type
     or new.source_id is distinct from old.source_id or new.version is distinct from old.version
     or new.sent_at is distinct from old.sent_at or new.sign_in_order is distinct from old.sign_in_order
     or new.created_by_name is distinct from old.created_by_name or new.created_by_email is distinct from old.created_by_email
     or new.created_ip is distinct from old.created_ip then
    raise exception 'The signed content of an e-signature envelope cannot be changed';
  end if;
  if old.sealed_pdf_sha256 is not null and (new.sealed_pdf_sha256 is distinct from old.sealed_pdf_sha256
     or new.sealed_pdf_path is distinct from old.sealed_pdf_path or new.sealed_at is distinct from old.sealed_at) then
    raise exception 'A sealed e-signature record cannot be changed';
  end if;
  if old.status <> 'sent' and new.status is distinct from old.status then
    raise exception 'A finished e-signature envelope cannot change status';
  end if;
  return new;
end $$;
create trigger esign_envelopes_guard before update or delete on public.esign_envelopes
  for each row execute function public.esign_envelopes_guard();

-- Recipients: once someone has signed or declined, their record is fixed (a
-- deleted user's id may still be cleared).
create or replace function public.esign_recipients_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.esign_is_admin() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    raise exception 'E-signature recipients are permanent records and cannot be deleted';
  end if;
  if (old.signed_at is not null or old.declined_at is not null)
     and (to_jsonb(new) - 'user_id') is distinct from (to_jsonb(old) - 'user_id') then
    raise exception 'A completed signature cannot be changed';
  end if;
  if new.envelope_id is distinct from old.envelope_id or new.role is distinct from old.role
     or new.email is distinct from old.email or new.routing_order is distinct from old.routing_order then
    raise exception 'An e-signature recipient cannot be moved or changed';
  end if;
  return new;
end $$;
create trigger esign_recipients_guard before update or delete on public.esign_recipients
  for each row execute function public.esign_recipients_guard();

-- Events: append-only (a deleted user's id may still be cleared).
create or replace function public.esign_events_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.esign_is_admin() then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and new.actor_user_id is null
     and (to_jsonb(new) - 'actor_user_id' - 'recipient_id') = (to_jsonb(old) - 'actor_user_id' - 'recipient_id') then
    return new;
  end if;
  raise exception 'The e-signature audit trail is append-only';
end $$;
create trigger esign_events_guard before update or delete on public.esign_events
  for each row execute function public.esign_events_guard();

-- Consents: only a withdrawal can be added, once.
create or replace function public.esign_consents_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.esign_is_admin() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    raise exception 'E-signature consents are permanent records and cannot be deleted';
  end if;
  if (to_jsonb(new) - 'user_id' - 'withdrawn_at' - 'withdrawn_ip' - 'withdrawn_user_agent')
     is distinct from (to_jsonb(old) - 'user_id' - 'withdrawn_at' - 'withdrawn_ip' - 'withdrawn_user_agent')
     or (old.withdrawn_at is not null and (new.withdrawn_at, new.withdrawn_ip, new.withdrawn_user_agent)
         is distinct from (old.withdrawn_at, old.withdrawn_ip, old.withdrawn_user_agent)) then
    raise exception 'An e-signature consent cannot be changed';
  end if;
  return new;
end $$;
create trigger esign_consents_guard before update or delete on public.esign_consents
  for each row execute function public.esign_consents_guard();

-- Disclosures: a published version's text never changes.
create or replace function public.esign_disclosures_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.esign_is_admin() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' or new.body is distinct from old.body or new.body_sha256 is distinct from old.body_sha256
     or new.title is distinct from old.title or new.version is distinct from old.version then
    raise exception 'A published e-signature disclosure cannot be changed; add a new version';
  end if;
  return new;
end $$;
create trigger esign_disclosures_guard before update or delete on public.esign_disclosures
  for each row execute function public.esign_disclosures_guard();

-- -------------------------------------------------------------- verification
-- Anyone in the account holding a PDF can check it is a sealed original: the
-- page hashes the file and this looks the hash up.
create or replace function public.esign_verify_pdf(p_sha256 text)
returns table (
  envelope_id uuid, title text, source_type text, source_id uuid, version int,
  status text, sent_at timestamptz, completed_at timestamptz, sealed_at timestamptz,
  document_hash text, signers jsonb
) language sql stable security definer set search_path = public as $$
  select e.id, e.title, e.source_type, e.source_id, e.version, e.status, e.sent_at, e.completed_at,
         e.sealed_at, e.document_hash,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'name', r.name, 'email', r.email, 'role', r.role, 'label', r.label,
                     'signed_at', r.signed_at, 'kind', r.signature_kind) order by r.routing_order, r.created_at)
                   from public.esign_recipients r where r.envelope_id = e.id and r.role <> 'cc'), '[]'::jsonb)
  from public.esign_envelopes e
  where e.sealed_pdf_sha256 = lower(trim(p_sha256)) and e.account_id = public.auth_account_id()
$$;
grant execute on function public.esign_verify_pdf(text) to authenticated;

-- ---------------------------------------------------------------- realtime
do $$
begin
  begin
    alter publication supabase_realtime add table public.purchase_requests;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.esign_events;
  exception when duplicate_object then null;
  end;
end $$;

-- --------------------------------------------------------- the disclosure
insert into public.esign_disclosures (version, title, body, body_sha256, active)
select v.version, v.title, v.body, encode(sha256(convert_to(v.body, 'UTF8')), 'hex'), true
from (values (
  '2026-11-13',
  'Electronic Record and Signature Disclosure',
  $body${company} uses Operator to send, receive, and sign purchase requests, approvals, and related records electronically. Please read this disclosure. It explains your rights and what you agree to when you choose to use electronic records and electronic signatures. It is provided under the federal Electronic Signatures in Global and National Commerce Act (15 U.S.C. 7001 et seq.) and the Texas Uniform Electronic Transactions Act (Texas Business and Commerce Code, Chapter 322).

## What this covers
This consent covers every purchase request, approval, notice, and related record that {company} sends to you, or that you send, sign, or approve in Operator, until you withdraw it.

## Your electronic signature
When you select Sign, you adopt the signature you drew or typed as your electronic signature. It has the same legal effect as your handwritten signature on the same record. Your signature is linked to the exact version of the record you reviewed, together with the date and time, your Operator account, your IP address, and your device. Operator keeps that information as a secure audit trail, and seals the completed record so any later change can be detected.

## Paper copies
You can view, download, and print any record you sign, including the sealed PDF and its certificate of completion, from the Purchase Requests page at any time. You may also ask the sender of a request, or Accounts Payable, for a paper copy at no charge.

## Signing on paper instead
You are not required to sign electronically. If you would rather sign on paper, choose Sign on paper instead when you open the request, or tell the sender or Accounts Payable before you sign. They will give you a paper copy to sign by hand, and the signed copy will be added to the record. Signing on paper may take longer.

## Withdrawing your consent
You may withdraw this consent at any time from Purchase Requests > E-signature settings, or by telling Accounts Payable. Withdrawal takes effect once it is received and has had a reasonable time to be processed. It does not affect the legal effect, validity, or enforceability of records you signed or received electronically before it took effect. After you withdraw, any request that needs your signature will be handled on paper. There is no fee or penalty for withdrawing.

## What you need
- A current version of Chrome, Edge, Safari, or Firefox, with JavaScript turned on, on a computer, tablet, or phone.
- A way to open PDF files (every current browser can).
- A working email address on your Operator account.
- The ability to download, save, or print files, so you can keep copies of your records.
If these requirements change in a way that could keep you from opening or keeping your records, you will be told what changed, and you may withdraw your consent without any fee.

## Keeping your information current
Notices are sent to the email address on your Operator account. If it changes, ask your Operator administrator to update it.

## Your agreement
By checking the box, you confirm that you have read this disclosure, that you can open and read it and PDF files on the device you are using, that you can keep copies of your records, and that you agree to use electronic records and electronic signatures with {company}.$body$
)) as v(version, title, body)
on conflict (version) do nothing;
