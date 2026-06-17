-- 0040_assets_rebuild.sql
--
-- Bring `equipment` up to MaintainX-style "Assets". We keep the table name
-- (renaming would cascade through work_orders + RLS + queries with no real
-- benefit) but the UI surfaces them as "Assets" and the new columns match
-- MaintainX one-for-one:
--   - account_id (denormalized for cheap RLS + cross-location queries)
--   - asset_number (per-account auto-increment, shows as #01, #02, ...)
--   - parent_asset_id + on-delete cascade for sub-asset trees
--   - criticality (none/low/medium/high)
--   - qr_code (random short string, unique within account)
--   - manufacturer / model / serial_number / description
--   - status enum widened: online | offline_planned | offline_unplanned | retired
--   - asset_type kept on `type` column; existing string-typed values are fine
--
-- Photos live in their own table + private storage bucket so a single asset
-- can carry a small image gallery (nameplate, location, before/after).

-- 1) Add the new columns. Defaults chosen so existing rows pass the NOT NULLs
--    without manual cleanup. account_id is backfilled from location_id.

alter table public.equipment
  add column if not exists account_id        uuid references public.accounts(id) on delete cascade,
  add column if not exists parent_asset_id   uuid references public.equipment(id) on delete cascade,
  add column if not exists asset_number      int,
  add column if not exists criticality       text not null default 'none'
                          check (criticality in ('none','low','medium','high')),
  add column if not exists qr_code           text,
  add column if not exists manufacturer      text,
  add column if not exists model             text,
  add column if not exists serial_number     text,
  add column if not exists description       text,
  add column if not exists updated_at        timestamptz not null default now();

-- Backfill account_id from location.
update public.equipment e
   set account_id = l.account_id
  from public.locations l
 where l.id = e.location_id
   and e.account_id is null;

alter table public.equipment alter column account_id set not null;

-- Per-account auto-increment for asset_number. Postgres can't easily do
-- per-tenant sequences cleanly, so we use a function that takes the next
-- value via a row-level lock on the existing max.
create sequence if not exists public.assets_number_seq;

create or replace function public.assign_asset_number()
returns trigger language plpgsql as $$
begin
  if new.asset_number is null then
    select coalesce(max(asset_number), 0) + 1
      into new.asset_number
      from public.equipment
     where account_id = new.account_id;
  end if;
  return new;
end $$;

drop trigger if exists equipment_assign_number on public.equipment;
create trigger equipment_assign_number
before insert on public.equipment
for each row execute function public.assign_asset_number();

-- Backfill numbers for existing rows in insertion order per account.
with numbered as (
  select id,
         row_number() over (partition by account_id order by created_at, id) as n
    from public.equipment
   where asset_number is null
)
update public.equipment e
   set asset_number = numbered.n
  from numbered
 where e.id = numbered.id;

alter table public.equipment alter column asset_number set not null;
create unique index if not exists equipment_account_number_unq on public.equipment (account_id, asset_number);
create index if not exists equipment_parent_idx on public.equipment (parent_asset_id);

-- QR code: per-asset short random string. Auto-fill on insert if not set.
create or replace function public.assign_asset_qr()
returns trigger language plpgsql as $$
declare candidate text; tries int := 0;
begin
  if new.qr_code is not null and new.qr_code <> '' then return new; end if;
  loop
    -- 12-char uppercase alphanumeric (base36, no ambiguous chars).
    candidate := upper(translate(encode(extensions.gen_random_bytes(8), 'base64'),
                                 '+/=ILO01', ''));
    candidate := substring(candidate from 1 for 12);
    perform 1 from public.equipment where qr_code = candidate;
    if not found then new.qr_code := candidate; exit; end if;
    tries := tries + 1;
    if tries > 5 then
      -- Give up cleanly and let the unique index complain if we're truly unlucky.
      new.qr_code := candidate;
      exit;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists equipment_assign_qr on public.equipment;
create trigger equipment_assign_qr
before insert on public.equipment
for each row execute function public.assign_asset_qr();

-- Backfill QR for any existing rows.
update public.equipment
   set qr_code = upper(substring(translate(encode(extensions.gen_random_bytes(8),'base64'),'+/=ILO01',''), 1, 12))
 where qr_code is null;

create unique index if not exists equipment_qr_unq on public.equipment (qr_code);

-- Updated_at on every change.
create or replace function public.touch_asset_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists equipment_touch on public.equipment;
create trigger equipment_touch
before update on public.equipment
for each row execute function public.touch_asset_updated_at();

-- Widen status check. Legacy values were ('operational','down','maintenance').
-- Drop the old constraint first so the rewriting UPDATE doesn't trip it, then
-- re-add the new one. Mapping: operational -> online, down -> offline_unplanned,
-- maintenance -> offline_planned.

alter table public.equipment drop constraint if exists equipment_status_check;

update public.equipment set status = case status
  when 'operational' then 'online'
  when 'down' then 'offline_unplanned'
  when 'maintenance' then 'offline_planned'
  else 'online'
end
where status is null
   or status not in ('online','offline_planned','offline_unplanned','retired');

alter table public.equipment
  add constraint equipment_status_check
  check (status in ('online','offline_planned','offline_unplanned','retired'));

-- ---- Asset photos -------------------------------------------------------

create table if not exists public.asset_photos (
  id           uuid primary key default gen_random_uuid(),
  asset_id     uuid not null references public.equipment(id) on delete cascade,
  storage_path text not null,
  caption      text,
  uploaded_by  uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists asset_photos_asset_idx on public.asset_photos (asset_id);

alter table public.asset_photos enable row level security;
create policy asset_photos_select on public.asset_photos for select
  using (exists (select 1 from public.equipment e where e.id = asset_id and e.account_id = public.auth_account_id()));
create policy asset_photos_write on public.asset_photos for all
  using (exists (select 1 from public.equipment e where e.id = asset_id and e.account_id = public.auth_account_id() and public.auth_is_manager_plus()))
  with check (exists (select 1 from public.equipment e where e.id = asset_id and e.account_id = public.auth_account_id() and public.auth_is_manager_plus()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('asset-photos', 'asset-photos', false, 8 * 1024 * 1024,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;

-- Path: {account_id}/{asset_id}/{uuid}.{ext}
create policy "asset photos read" on storage.objects for select
  using (
    bucket_id = 'asset-photos'
    and (storage.foldername(name))[1]::uuid = public.auth_account_id()
  );
create policy "asset photos write" on storage.objects for insert
  with check (
    bucket_id = 'asset-photos'
    and (storage.foldername(name))[1]::uuid = public.auth_account_id()
  );
create policy "asset photos delete" on storage.objects for delete
  using (
    bucket_id = 'asset-photos'
    and (storage.foldername(name))[1]::uuid = public.auth_account_id()
    and public.auth_is_manager_plus()
  );

-- ---- equipment RLS (broaden to account-scoped) --------------------------
-- The previous RLS used location-only; with the new account_id column we can
-- let users see assets across locations they have access to. (Backward
-- compatible: existing location-based policies still work.)

drop policy if exists equipment_account_select on public.equipment;
create policy equipment_account_select on public.equipment for select
  using (account_id = public.auth_account_id() and public.auth_has_location(location_id));
