-- Every submitted IT Field Checklist is emailed (with its PDF) to Mighty Wash
-- (requested 2026-10-26). The it-field-checklist-email function stamps this on
-- success, so the page can offer a re-send when it didn't go out.
alter table public.it_field_checklists add column if not exists emailed_at timestamptz;
