-- 0093_invoice_inbound.sql
-- Inbound-email pipeline for Invoice Approval. Vendors email invoices to a
-- wash's inbox address (company_settings.invoiceInboxEmail override, e.g.
-- mwinvoices@washlyfe.com, or the generated <token>@invoices.washlyfe.com). The
-- invoice-inbound edge function parses the message, stores the attachment, and
-- inserts an ops_invoices row with status 'unassigned' so it lands on the
-- Unassigned tab. These columns capture the email provenance + stored file.

alter table public.ops_invoices
  add column if not exists email_from text,
  add column if not exists email_subject text,
  add column if not exists file_path text,
  add column if not exists email_message_id text;

-- Dedupe re-deliveries of the same message (providers can retry the webhook).
create unique index if not exists ops_invoices_account_message_key
  on public.ops_invoices (account_id, email_message_id)
  where email_message_id is not null;

-- Private bucket for emailed-in invoice files. Path: {account_id}/{invoice_id}/{name}.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ops-invoices', 'ops-invoices', false, 25 * 1024 * 1024,
        array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif','application/octet-stream'])
on conflict (id) do nothing;

create policy "ops invoices files read" on storage.objects for select
  using (
    bucket_id = 'ops-invoices'
    and (storage.foldername(name))[1]::uuid = public.auth_account_id()
  );
create policy "ops invoices files write" on storage.objects for insert
  with check (
    bucket_id = 'ops-invoices'
    and (storage.foldername(name))[1]::uuid = public.auth_account_id()
  );
