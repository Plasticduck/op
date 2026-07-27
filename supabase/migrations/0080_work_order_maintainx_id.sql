-- Store the source MaintainX work order id on imported work orders so the
-- import is idempotent (upsert on conflict) and future syncs can match rows.
-- Nullable: only work orders imported from MaintainX carry a value.
alter table public.work_orders add column if not exists maintainx_id bigint;

create unique index if not exists work_orders_account_maintainx_id_key
  on public.work_orders (account_id, maintainx_id)
  where maintainx_id is not null;
