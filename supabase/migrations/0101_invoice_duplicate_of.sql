-- Duplicate detection: when an emailed-in invoice carries an invoice number that
-- already exists for the same vendor on this account, invoice-inbound records
-- the original it duplicates here. The row is still filed (so it's reviewable),
-- just labeled "Duplicate" in the UI. Distinct from the (account, message-id)
-- idempotency check, which only catches the exact same email arriving twice.
alter table ops_invoices
  add column if not exists duplicate_of uuid references ops_invoices(id) on delete set null;
