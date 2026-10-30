-- IT Inventory, Phase 1 label printing and attachments (2026-10-30).

-- ---- Print jobs ---------------------------------------------------------------------
-- One row per sticker print. Stamps each printed tag's count, clears a faded or
-- missing sticker back to "unknown" (a new one is on the way, not yet
-- verified), and is logged per asset as label_printed by 0185.

create table if not exists public.it_label_print_jobs (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  template_id uuid references public.it_label_templates(id) on delete set null,
  asset_ids   uuid[] not null default '{}',
  tag_ids     uuid[] not null default '{}',
  -- Labels on the page(s): assets x copies, plus blank pool tags.
  quantity    integer not null check (quantity > 0),
  copies      integer not null default 1 check (copies between 1 and 10),
  printed_by  uuid references public.users(id) on delete set null default auth.uid(),
  printed_at  timestamptz not null default now(),
  pdf_path    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.users(id) on delete set null default auth.uid()
);
create index if not exists it_label_print_jobs_idx on public.it_label_print_jobs (account_id, printed_at desc);

create or replace function public.it_label_print_jobs_apply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.it_asset_tags t
     set printed_count = t.printed_count + new.copies, last_printed_at = new.printed_at
   where t.account_id = new.account_id
     and (t.id = any (new.tag_ids)
          or t.tag in (select a.asset_tag from public.it_assets a
                        where a.id = any (new.asset_ids) and a.account_id = new.account_id));
  update public.it_assets
     set sticker_condition = 'unknown'
   where id = any (new.asset_ids) and account_id = new.account_id
     and sticker_condition in ('faded', 'missing');
  return new;
end $$;
create trigger it_label_print_jobs_apply_trg after insert on public.it_label_print_jobs
  for each row execute function public.it_label_print_jobs_apply();

alter table public.it_label_print_jobs enable row level security;
create policy it_label_print_jobs_select on public.it_label_print_jobs
  for select using (account_id = auth_account_id() and it_can_read(location_id));
-- Every asset printed must be one the caller can manage.
create policy it_label_print_jobs_insert on public.it_label_print_jobs
  for insert with check (
    account_id = auth_account_id()
    and it_is_staff()
    and printed_by = auth.uid()
    and not exists (
      select 1 from unnest(asset_ids) x(id)
      where not exists (select 1 from public.it_assets a where a.id = x.id and it_can_write(a.location_id))
    )
  );

-- ---- Attachments -------------------------------------------------------------------------
-- Photos, receipts, manuals, warranty papers and config backups for any IT
-- record. Files live in the private it-inventory bucket under
-- <account_id>/<entity_type>/<entity_id>/<uuid>.<ext>, read via signed URLs.

create table if not exists public.it_attachments (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  location_id  uuid references public.locations(id) on delete cascade,
  entity_type  text not null check (entity_type in ('asset', 'subscription', 'maintenance', 'consumable', 'model')),
  entity_id    uuid not null,
  storage_path text not null,
  mime_type    text,
  kind         text not null default 'photo'
               check (kind in ('photo', 'receipt', 'manual', 'warranty', 'config_backup', 'other')),
  caption      text,
  uploaded_by  uuid references public.users(id) on delete set null default auth.uid(),
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.users(id) on delete set null default auth.uid()
);
create index if not exists it_attachments_entity_idx on public.it_attachments (entity_type, entity_id);
create trigger it_attachments_touch before update on public.it_attachments
  for each row execute function public.it_touch();
alter table public.it_attachments enable row level security;
create policy it_attachments_select on public.it_attachments
  for select using (account_id = auth_account_id() and it_can_read(location_id));
create policy it_attachments_insert on public.it_attachments
  for insert with check (account_id = auth_account_id() and it_can_write(location_id) and uploaded_by = auth.uid());
create policy it_attachments_update on public.it_attachments
  for update using (account_id = auth_account_id() and it_can_write(location_id))
  with check (account_id = auth_account_id() and it_can_write(location_id));
create policy it_attachments_delete on public.it_attachments
  for delete using (account_id = auth_account_id() and (it_is_admin() or uploaded_by = auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('it-inventory', 'it-inventory', false, 52428800,
        array['image/*', 'video/*', 'application/pdf', 'text/plain', 'application/octet-stream',
              'application/zip', 'application/json'])
on conflict (id) do nothing;

create policy it_inventory_files_read on storage.objects
  for select using (
    bucket_id = 'it-inventory' and (storage.foldername(name))[1] = auth_account_id()::text
  );
create policy it_inventory_files_insert on storage.objects
  for insert with check (
    bucket_id = 'it-inventory' and (storage.foldername(name))[1] = auth_account_id()::text and it_is_staff()
  );
create policy it_inventory_files_delete on storage.objects
  for delete using (
    bucket_id = 'it-inventory' and (storage.foldername(name))[1] = auth_account_id()::text
    and (owner = auth.uid() or it_is_admin())
  );
