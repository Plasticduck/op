-- 0050_checklist_photo_verification.sql
-- Photo + AI verification for checklist items.
--  * checklist_items.requires_photo: manager flags which tasks need a photo.
--  * checklist_item_baselines: the per-site "base level submission" a manager
--    captures once. AI judges each submission against this reference.
--  * checklist_submissions: an employee's photo for a task on a given instance,
--    with the AI verdict (pass / discrepancy / unclear) and notes.
-- Images are stored as base64 data URIs (same approach as sales reports), so the
-- verify edge function can forward them straight to Claude vision.

alter table public.checklist_items
  add column if not exists requires_photo boolean not null default false;

-- Per-site baseline reference for a task. One per (item, location).
create table if not exists public.checklist_item_baselines (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.checklist_items(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  data_uri    text not null,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (item_id, location_id)
);
create index if not exists checklist_item_baselines_item_loc_idx
  on public.checklist_item_baselines (item_id, location_id);

-- An employee's submitted photo for a task on a specific daily instance, plus
-- the AI verdict. ai_status starts 'pending'; the verify function fills it in.
create table if not exists public.checklist_submissions (
  id                uuid primary key default gen_random_uuid(),
  instance_id       uuid not null references public.checklist_instances(id) on delete cascade,
  item_id           uuid not null references public.checklist_items(id) on delete cascade,
  location_id       uuid not null references public.locations(id) on delete cascade,
  data_uri          text not null,
  submitted_by      uuid references public.users(id) on delete set null,
  submitted_by_name text,
  ai_status         text not null default 'pending'
                      check (ai_status in ('pending','pass','discrepancy','unclear','error')),
  ai_notes          text,
  ai_model          text,
  created_at        timestamptz not null default now()
);
create index if not exists checklist_submissions_instance_item_idx
  on public.checklist_submissions (instance_id, item_id, created_at desc);

alter table public.checklist_item_baselines enable row level security;
alter table public.checklist_submissions enable row level security;

-- Baselines: anyone with the site can view; manager+ manages them.
drop policy if exists checklist_item_baselines_select on public.checklist_item_baselines;
create policy checklist_item_baselines_select on public.checklist_item_baselines for select
  using (public.auth_has_location(location_id));
drop policy if exists checklist_item_baselines_write on public.checklist_item_baselines;
create policy checklist_item_baselines_write on public.checklist_item_baselines for all
  using (public.auth_has_location(location_id) and public.auth_is_manager_plus())
  with check (public.auth_has_location(location_id) and public.auth_is_manager_plus());

-- Submissions: viewable by anyone with the site; any member with the site can
-- record their own. AI fields are written by the service-role edge function.
drop policy if exists checklist_submissions_select on public.checklist_submissions;
create policy checklist_submissions_select on public.checklist_submissions for select
  using (public.auth_has_location(location_id));
drop policy if exists checklist_submissions_insert on public.checklist_submissions;
create policy checklist_submissions_insert on public.checklist_submissions for insert
  with check (submitted_by = auth.uid() and public.auth_has_location(location_id));

-- Latest submission per (instance, item) for the daily view.
create or replace view public.checklist_submission_latest as
select distinct on (s.instance_id, s.item_id)
  s.id, s.instance_id, s.item_id, s.location_id,
  s.submitted_by_name, s.ai_status, s.ai_notes, s.created_at
from public.checklist_submissions s
order by s.instance_id, s.item_id, s.created_at desc;

grant select on public.checklist_submission_latest to authenticated;
