-- IT Inventory, Phase 1 subscriptions and consumables (2026-10-30).

-- ---- Subscriptions ---------------------------------------------------------------
-- Recurring IT spend: ISP circuits, POS software, LPR service, camera cloud,
-- signage SaaS, cellular plans. A null site means account-wide.

create table if not exists public.it_subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  location_id        uuid references public.locations(id) on delete cascade,
  name               text not null check (btrim(name) <> ''),
  supplier_id        uuid references public.it_suppliers(id) on delete set null,
  category_id        uuid references public.it_categories(id) on delete set null,
  account_number     text,
  seats              integer check (seats > 0),
  cost               numeric(12, 2),
  billing_cycle      text not null default 'monthly' check (billing_cycle in ('monthly', 'quarterly', 'annual', 'other')),
  start_date         date,
  renewal_date       date,
  auto_renew         boolean not null default true,
  cancel_notice_days integer check (cancel_notice_days >= 0),
  owner_user_id      uuid references public.users(id) on delete set null,
  notes              text,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.users(id) on delete set null default auth.uid()
);
create index if not exists it_subscriptions_site_idx on public.it_subscriptions (account_id, location_id);
create index if not exists it_subscriptions_renewal_idx on public.it_subscriptions (account_id, renewal_date);
create trigger it_subscriptions_touch before update on public.it_subscriptions
  for each row execute function public.it_touch();
alter table public.it_subscriptions enable row level security;
create policy it_subscriptions_select on public.it_subscriptions
  for select using (account_id = auth_account_id() and it_can_read(location_id));
create policy it_subscriptions_insert on public.it_subscriptions
  for insert with check (account_id = auth_account_id() and it_can_write(location_id));
create policy it_subscriptions_update on public.it_subscriptions
  for update using (account_id = auth_account_id() and it_can_write(location_id))
  with check (account_id = auth_account_id() and it_can_write(location_id));
create policy it_subscriptions_delete on public.it_subscriptions
  for delete using (account_id = auth_account_id() and it_is_admin());

-- Which devices a subscription covers (e.g. the LPR service and its cameras).
create table if not exists public.it_subscription_assets (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  subscription_id uuid not null references public.it_subscriptions(id) on delete cascade,
  asset_id        uuid not null references public.it_assets(id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.users(id) on delete set null default auth.uid(),
  unique (subscription_id, asset_id)
);
alter table public.it_subscription_assets enable row level security;
-- The subqueries run under the parent tables' own policies.
create policy it_subscription_assets_select on public.it_subscription_assets
  for select using (
    account_id = auth_account_id()
    and exists (select 1 from public.it_subscriptions s where s.id = subscription_id)
    and exists (select 1 from public.it_assets a where a.id = asset_id)
  );
create policy it_subscription_assets_write on public.it_subscription_assets
  for all using (
    account_id = auth_account_id()
    and exists (select 1 from public.it_assets a where a.id = asset_id and it_can_write(a.location_id))
  ) with check (
    account_id = auth_account_id()
    and exists (select 1 from public.it_subscriptions s where s.id = subscription_id and s.account_id = auth_account_id())
    and exists (select 1 from public.it_assets a where a.id = asset_id and it_can_write(a.location_id))
  );

-- ---- Consumables ---------------------------------------------------------------------
-- Receipt paper, label stock and the asset sticker stock itself, per site.
-- qty_on_hand only moves through it_consumable_events so every change is
-- explained.

create table if not exists public.it_consumables (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  location_id      uuid not null references public.locations(id) on delete cascade,
  category_id      uuid references public.it_categories(id) on delete set null,
  name             text not null check (btrim(name) <> ''),
  model_number     text,
  qty_on_hand      integer not null default 0,
  min_qty          integer not null default 0 check (min_qty >= 0),
  reorder_url      text,
  supplier_id      uuid references public.it_suppliers(id) on delete set null,
  -- The seeded "Sticker Stock" row, so label printing can count down from it.
  is_sticker_stock boolean not null default false,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.users(id) on delete set null default auth.uid()
);
create index if not exists it_consumables_site_idx on public.it_consumables (account_id, location_id);
create unique index if not exists it_consumables_sticker_unq
  on public.it_consumables (location_id) where is_sticker_stock and deleted_at is null;
create trigger it_consumables_touch before update on public.it_consumables
  for each row execute function public.it_touch();
alter table public.it_consumables enable row level security;
create policy it_consumables_select on public.it_consumables
  for select using (account_id = auth_account_id() and it_can_read(location_id));
create policy it_consumables_insert on public.it_consumables
  for insert with check (account_id = auth_account_id() and it_can_write(location_id));
create policy it_consumables_update on public.it_consumables
  for update using (account_id = auth_account_id() and it_can_write(location_id))
  with check (account_id = auth_account_id() and it_can_write(location_id));
create policy it_consumables_delete on public.it_consumables
  for delete using (account_id = auth_account_id() and it_is_admin());

create table if not exists public.it_consumable_events (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  location_id   uuid not null references public.locations(id) on delete cascade,
  consumable_id uuid not null references public.it_consumables(id) on delete cascade,
  delta         integer not null check (delta <> 0),
  reason        text not null check (reason in ('restock', 'used', 'adjustment')),
  user_id       uuid references public.users(id) on delete set null default auth.uid(),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.users(id) on delete set null default auth.uid()
);
create index if not exists it_consumable_events_idx on public.it_consumable_events (consumable_id, created_at desc);

create or replace function public.it_consumable_events_apply()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  loc uuid;
begin
  update public.it_consumables set qty_on_hand = qty_on_hand + new.delta
   where id = new.consumable_id and account_id = new.account_id
  returning location_id into loc;
  if loc is null then
    raise exception 'Unknown consumable';
  end if;
  return new;
end $$;

create or replace function public.it_consumable_events_site()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select location_id into new.location_id from public.it_consumables
   where id = new.consumable_id and account_id = new.account_id;
  if new.location_id is null then
    raise exception 'Unknown consumable';
  end if;
  return new;
end $$;
create trigger it_consumable_events_site_trg before insert on public.it_consumable_events
  for each row execute function public.it_consumable_events_site();
create trigger it_consumable_events_apply_trg after insert on public.it_consumable_events
  for each row execute function public.it_consumable_events_apply();

alter table public.it_consumable_events enable row level security;
create policy it_consumable_events_select on public.it_consumable_events
  for select using (account_id = auth_account_id() and it_can_read(location_id));
-- Append-only: no update or delete. Correct a mistake with an adjustment.
create policy it_consumable_events_insert on public.it_consumable_events
  for insert with check (account_id = auth_account_id() and it_can_write(location_id));
