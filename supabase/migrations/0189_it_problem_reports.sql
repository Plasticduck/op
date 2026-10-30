-- IT Inventory (2026-10-30): "Report a problem" from a scanned sticker. A
-- report becomes a Work Request (the existing issue flow) linked to the IT
-- asset, and shows on the asset's Timeline as problem_reported. Reports are
-- filed by the it-scan-public edge function (service role), signed in or not.

alter table public.work_requests
  add column if not exists it_asset_id uuid references public.it_assets(id) on delete set null;
create index if not exists work_requests_it_asset_idx
  on public.work_requests (it_asset_id, created_at desc) where it_asset_id is not null;

alter table public.it_activity_log drop constraint if exists it_activity_log_action_check;
alter table public.it_activity_log add constraint it_activity_log_action_check check (action in (
  'created', 'updated', 'checked_out', 'checked_in', 'status_changed', 'audited',
  'maintenance_logged', 'health_changed', 'imported', 'deleted', 'secret_revealed',
  'label_printed', 'tag_applied', 'tag_retired', 'problem_reported'));
