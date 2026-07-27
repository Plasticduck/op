-- Store the source MaintainX ids on locations and equipment so the incremental
-- work-order sync can resolve a changed WO's site/asset by a fast id lookup
-- instead of re-fetching and name-matching the full catalog every run.
alter table public.locations add column if not exists maintainx_id bigint;
alter table public.equipment add column if not exists maintainx_id bigint;

create index if not exists locations_maintainx_id_idx on public.locations (maintainx_id) where maintainx_id is not null;
create index if not exists equipment_maintainx_id_idx on public.equipment (maintainx_id) where maintainx_id is not null;
