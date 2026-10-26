-- IT Field Checklist (IT section), 2026-10-26. One row per site visit by an IT
-- field tech: they work through the checklist items (check off, add photos or
-- videos, comment), can leave and come back while it's a draft, then submit it as
-- a record. `items` is a jsonb snapshot of the checklist at the time:
-- [{ key, section, label, checked, comment, media: [{ path, kind, name }] }] so a
-- later wording change never rewrites an old record. Media files live in the
-- private it-field-checklist-media bucket under <account_id>/<checklist_id>/.
create table if not exists public.it_field_checklists (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  location_id  uuid references public.locations(id) on delete set null,
  tech_id      uuid references public.users(id) on delete set null,
  tech_name    text,
  status       text not null default 'draft' check (status in ('draft', 'submitted')),
  items        jsonb not null default '[]'::jsonb,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  submitted_at timestamptz
);
create index if not exists it_field_checklists_acct_idx
  on public.it_field_checklists (account_id, created_at desc);

alter table public.it_field_checklists enable row level security;

-- Techs see their own checklists; managers and owners see the ones for sites
-- they cover.
create policy it_field_checklists_select on public.it_field_checklists
  for select using (
    account_id = auth_account_id()
    and (
      tech_id = auth.uid()
      or (auth_is_manager_plus() and (location_id is null or auth_has_location(location_id)))
    )
  );
create policy it_field_checklists_insert on public.it_field_checklists
  for insert with check (
    account_id = auth_account_id()
    and tech_id = auth.uid()
    and (location_id is null or auth_has_location(location_id))
  );
-- Only the tech edits, and only while it's a draft (submitting is the last edit).
create policy it_field_checklists_update on public.it_field_checklists
  for update using (account_id = auth_account_id() and tech_id = auth.uid() and status = 'draft')
  with check (account_id = auth_account_id() and tech_id = auth.uid());
create policy it_field_checklists_delete on public.it_field_checklists
  for delete using (
    account_id = auth_account_id()
    and ((tech_id = auth.uid() and status = 'draft') or auth_role() = 'owner')
  );

-- Photos and videos. 50 MB per file (the project's upload limit).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('it-field-checklist-media', 'it-field-checklist-media', false, 52428800, array['image/*', 'video/*'])
on conflict (id) do nothing;

create policy it_field_media_read on storage.objects
  for select using (
    bucket_id = 'it-field-checklist-media'
    and (storage.foldername(name))[1] = auth_account_id()::text
  );
create policy it_field_media_insert on storage.objects
  for insert with check (
    bucket_id = 'it-field-checklist-media'
    and (storage.foldername(name))[1] = auth_account_id()::text
  );
create policy it_field_media_delete on storage.objects
  for delete using (
    bucket_id = 'it-field-checklist-media'
    and owner = auth.uid()
  );
