-- 0026_counseling_injury_depth.sql
-- Deepen counseling_records and injury_reports per user request (handwritten
-- to-do, 2026-05-26): both forms were too thin. Adds the structured fields a
-- manager / supervisor would actually fill out.

alter table public.counseling_records
  add column if not exists category text,
  add column if not exists action_plan text,
  add column if not exists follow_up_date date,
  add column if not exists recorded_by_name text,
  add column if not exists witnesses text;

alter table public.injury_reports
  add column if not exists incident_time time,
  add column if not exists area_description text,
  add column if not exists cause text,
  add column if not exists treatment_given text,
  add column if not exists doctor_visit boolean not null default false,
  add column if not exists days_lost integer,
  add column if not exists osha_recordable boolean not null default false,
  add column if not exists severity text,
  add column if not exists reported_by_name text;
