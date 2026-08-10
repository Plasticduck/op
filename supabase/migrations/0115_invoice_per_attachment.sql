-- Multiple invoices per email: invoice-inbound now files one ops_invoices row per
-- invoice attachment (and skips non-invoice files). Relax the per-message
-- idempotency to per-attachment so the second attachment on an email is not
-- rejected as a duplicate of the first.
drop index if exists public.ops_invoices_account_message_key;
alter table public.ops_invoices add column if not exists email_attachment_key text;
create unique index if not exists ops_invoices_account_message_attachment_key
  on public.ops_invoices (account_id, email_message_id, email_attachment_key)
  where email_message_id is not null;
