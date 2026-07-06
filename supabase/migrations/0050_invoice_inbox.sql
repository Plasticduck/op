-- 0050_invoice_inbox.sql
-- Per-wash (per-account) invoice inbox. Each account gets a unique, random,
-- email-safe token. Vendors forward invoices to
--   <token>@invoices.washlyfe.com
-- and the inbound-email service looks the account up by the local-part token
-- and files the invoice against that wash (all of its sites). This replaces the
-- single shared payables@washlyfe.com address.
--
-- The token is system-assigned (16 hex chars = 64 bits, unguessable) and never
-- user-editable. accounts_select RLS already lets any account member read their
-- own account row, so the app can show the address; writes stay owner-gated.

alter table public.accounts
  add column if not exists invoice_inbox_token text;

-- Email-safe random token: 8 random bytes -> 16 lowercase hex chars.
create or replace function public.gen_invoice_inbox_token()
returns text language sql volatile
set search_path = public, extensions as $$
  select encode(gen_random_bytes(8), 'hex')
$$;

-- Backfill existing accounts (volatile fn -> distinct token per row).
update public.accounts
   set invoice_inbox_token = public.gen_invoice_inbox_token()
 where invoice_inbox_token is null;

alter table public.accounts alter column invoice_inbox_token set not null;
create unique index if not exists accounts_invoice_inbox_token_key
  on public.accounts (invoice_inbox_token);

-- Auto-assign on insert so every new wash gets one.
create or replace function public.assign_invoice_inbox_token()
returns trigger language plpgsql
set search_path = public, extensions as $$
begin
  if new.invoice_inbox_token is null or new.invoice_inbox_token = '' then
    new.invoice_inbox_token := public.gen_invoice_inbox_token();
  end if;
  return new;
end $$;

drop trigger if exists accounts_assign_invoice_inbox_token on public.accounts;
create trigger accounts_assign_invoice_inbox_token
before insert on public.accounts
for each row execute function public.assign_invoice_inbox_token();

-- Service-role lookup helper for the inbound-email pipeline: map a local-part
-- token to its account. Returns null if unknown.
create or replace function public.account_for_invoice_token(p_token text)
returns uuid language sql stable
set search_path = public as $$
  select id from public.accounts where invoice_inbox_token = lower(p_token)
$$;
