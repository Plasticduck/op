-- 0037_punch_verification.sql
-- Adds two stop-the-buddy-punch features to time clocking:
--   1) Geofencing: per-location lat/lng + radius. Punches outside the radius
--      are recorded with the distance + a flag so managers can spot-check.
--   2) Punch photos: every clock-in/out optionally captures a selfie from
--      the device's front camera. The Shape Detection API checks that a face
--      is present before allowing the punch on supported devices.
--
-- Enforcement is configurable per location (so a shop using a kiosk in the
-- back office can keep geofencing off). Defaults to OFF so existing accounts
-- aren't disrupted. Toggle from /app/settings/locations.

alter table public.locations
  add column geofence_radius_m integer not null default 200,
  add column require_punch_photo  boolean not null default false,
  add column require_geofence     boolean not null default false;

alter table public.time_entries
  add column punch_in_lat            numeric,
  add column punch_in_lng            numeric,
  add column punch_in_distance_m     integer,
  add column punch_in_outside_fence  boolean,
  add column punch_in_photo_path     text,
  add column punch_in_face_detected  boolean,
  add column punch_out_lat           numeric,
  add column punch_out_lng           numeric,
  add column punch_out_distance_m    integer,
  add column punch_out_outside_fence boolean,
  add column punch_out_photo_path    text,
  add column punch_out_face_detected boolean;

-- Private bucket for punch selfies. Path layout:
--   {account_id}/{employee_id}/{time_entry_id}-{in|out}.jpg
-- Path-first segment is account_id so RLS can compare it directly with
-- auth_account_id() without a database lookup.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('punch-photos', 'punch-photos', false, 4 * 1024 * 1024,
        array['image/jpeg','image/webp','image/png'])
on conflict (id) do nothing;

create policy "punch photos read for same account" on storage.objects for select
  using (
    bucket_id = 'punch-photos'
    and (storage.foldername(name))[1]::uuid = public.auth_account_id()
  );

-- Employees can only upload to their own folder; managers/owners can upload
-- for anyone in the account (covers the kiosk case where one device punches
-- for multiple employees).
create policy "punch photos write" on storage.objects for insert
  with check (
    bucket_id = 'punch-photos'
    and (storage.foldername(name))[1]::uuid = public.auth_account_id()
    and (
      public.auth_is_manager_plus()
      or (storage.foldername(name))[2]::uuid = public.auth_employee_id()
    )
  );

create policy "punch photos delete for managers" on storage.objects for delete
  using (
    bucket_id = 'punch-photos'
    and (storage.foldername(name))[1]::uuid = public.auth_account_id()
    and public.auth_is_manager_plus()
  );
