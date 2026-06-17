-- 0030_parts_closeouts_extensions.sql
-- Two small schema additions for the parts vendor + closeouts DRB-GSR work:
--
-- 1) parts_inventory: vendor, manufacturer, link_url. The UI now lets the
--    operator record where a part came from and link to a supplier page.
--
-- 2) closeouts: sales_data jsonb + gsr_extracted_at. sales_data stores either
--    manually-entered category totals or the structured JSON the DRB GSR
--    extractor returns; gsr_extracted_at flags rows that came from the auto
--    extractor so the UI can show a "verify these" badge.
--
-- ops_attachments.entity_type has no check constraint, so new entity_types
-- like 'closeout' and 'part' can be used without a schema change.

alter table public.parts_inventory add column if not exists vendor text;
alter table public.parts_inventory add column if not exists manufacturer text;
alter table public.parts_inventory add column if not exists link_url text;

alter table public.closeouts add column if not exists sales_data jsonb;
alter table public.closeouts add column if not exists gsr_extracted_at timestamptz;
