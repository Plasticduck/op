-- 0022_violations_data_and_attachments.sql
-- The old app's "Site Violations" data lived in the `notes` table (most rows are
-- *_Violation note types). It carries a department and a base64 PDF. Bring that
-- structure onto site_violations, and add the missing invoice attachment column.
-- Attachment payloads are base64 data URIs stored in *_data text columns; list
-- queries must select explicit columns to avoid pulling these megabyte blobs.

alter table public.site_violations
  add column if not exists department text,
  add column if not exists attachment_name text,
  add column if not exists attachment_type text,
  add column if not exists attachment_data text;

alter table public.ops_invoices
  add column if not exists file_data text;
