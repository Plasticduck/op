-- Invoice Approval: a verification step between approval and Approved
-- (Kevan, 2026-10-30). The final approval now moves an invoice to
-- 'needs_verification'; AP (the full-access list on the page) checks every
-- entry and marks it Verified, which moves it to 'approved' (ready to export
-- or send to QuickBooks). These record who verified it and when. Status is
-- free text (no check constraint), so the new status needs no change there.

alter table public.ops_invoices
  add column if not exists verified_by      uuid references public.users(id) on delete set null,
  add column if not exists verified_by_name text,
  add column if not exists verified_at      timestamptz;
