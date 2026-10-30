-- IT Inventory (IT section), 2026-10-30. One record per piece of IT gear or
-- recurring IT service the company has: computers, POS and pay stations, LPR and
-- security cameras, network gear, tunnel controllers, plus internet circuits,
-- phone plans and software licenses. A record with no site is at the office or
-- in storage. `category` is a key from src/features/it/itInventorySchema.ts and
-- is deliberately unconstrained here so adding a category needs no migration.
create table if not exists public.it_assets (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  -- Shown as the tag IT-0001. Insert 0 and the trigger below assigns the next one.
  asset_number     integer not null default 0,
  location_id      uuid references public.locations(id) on delete set null,
  placement        text,
  name             text not null,
  category         text not null default 'other_device',
  status           text not null default 'in_use'
                   check (status in ('in_use', 'spare', 'on_order', 'in_repair', 'retired', 'lost')),
  manufacturer     text,
  model            text,
  serial_number    text,
  assigned_to      text,
  hostname         text,
  ip_address       text,
  mac_address      text,
  operating_system text,
  remote_access_id text,
  vendor           text,
  purchase_date    date,
  purchase_cost    numeric(12, 2),
  warranty_expires date,
  monthly_cost     numeric(12, 2),
  renewal_date     date,
  last_verified_at timestamptz,
  notes            text,
  created_by       uuid references public.users(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (account_id, asset_number)
);
create index if not exists it_assets_location_idx on public.it_assets (location_id);

-- Per-account tag numbers. Security definer so the max is taken over the whole
-- account, not just the sites the caller can see (a manager would otherwise
-- reuse a number and hit the unique key). The advisory lock keeps two
-- simultaneous adds from taking the same number.
create or replace function public.it_assets_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.asset_number, 0) <= 0 then
    perform pg_advisory_xact_lock(hashtext('it_assets:' || new.account_id::text));
    select coalesce(max(asset_number), 0) + 1 into new.asset_number
      from public.it_assets where account_id = new.account_id;
  end if;
  return new;
end $$;
drop trigger if exists it_assets_number_trg on public.it_assets;
create trigger it_assets_number_trg
before insert on public.it_assets
for each row execute function public.it_assets_number();

create or replace function public.touch_it_asset_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists it_assets_touch on public.it_assets;
create trigger it_assets_touch
before update on public.it_assets
for each row execute function public.touch_it_asset_updated_at();

alter table public.it_assets enable row level security;

-- IT staff: owners, managers and technicians (auth_is_manager_plus covers all
-- three). Managers only see their own sites' gear plus anything with no site.
create policy it_assets_select on public.it_assets
  for select using (
    account_id = auth_account_id()
    and auth_is_manager_plus()
    and (location_id is null or auth_has_location(location_id))
  );
create policy it_assets_insert on public.it_assets
  for insert with check (
    account_id = auth_account_id()
    and auth_is_manager_plus()
    and (location_id is null or auth_has_location(location_id))
  );
create policy it_assets_update on public.it_assets
  for update using (
    account_id = auth_account_id()
    and auth_is_manager_plus()
    and (location_id is null or auth_has_location(location_id))
  ) with check (
    account_id = auth_account_id()
    and auth_is_manager_plus()
    and (location_id is null or auth_has_location(location_id))
  );
-- Deleting is for mistakes (owner, or whoever added it). Real gear that goes
-- away gets marked Retired or Lost so its history stays.
create policy it_assets_delete on public.it_assets
  for delete using (
    account_id = auth_account_id()
    and (auth_role() = 'owner' or (auth_is_manager_plus() and created_by = auth.uid()))
  );

-- History of each record, append-only. Adds, moves, status changes,
-- reassignments and in-person checks are written by the trigger below so the
-- log is complete however the record was edited; people add notes and repairs.
create table if not exists public.it_asset_events (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  asset_id    uuid not null references public.it_assets(id) on delete cascade,
  kind        text not null
              check (kind in ('created', 'moved', 'status', 'assigned', 'verified', 'note', 'repair')),
  summary     text not null,
  actor_id    uuid references public.users(id) on delete set null,
  actor_name  text,
  created_at  timestamptz not null default now()
);
create index if not exists it_asset_events_asset_idx
  on public.it_asset_events (asset_id, created_at desc);

alter table public.it_asset_events enable row level security;

-- Visible when the record itself is visible (the subquery runs under
-- it_assets' own policies).
create policy it_asset_events_select on public.it_asset_events
  for select using (
    account_id = auth_account_id()
    and auth_is_manager_plus()
    and exists (select 1 from public.it_assets a where a.id = asset_id)
  );
create policy it_asset_events_insert on public.it_asset_events
  for insert with check (
    account_id = auth_account_id()
    and auth_is_manager_plus()
    and actor_id = auth.uid()
    and kind in ('note', 'repair')
    and exists (select 1 from public.it_assets a where a.id = asset_id)
  );

create or replace function public.it_assets_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  actor_nm text;
  from_site text;
  to_site text;
begin
  select name into actor_nm from public.users where id = actor;

  if tg_op = 'INSERT' then
    select name into to_site from public.locations where id = new.location_id;
    insert into public.it_asset_events (account_id, asset_id, kind, summary, actor_id, actor_name)
    values (new.account_id, new.id, 'created',
            'Added to inventory' || coalesce(' at ' || to_site, ''), actor, actor_nm);
    return new;
  end if;

  if new.location_id is distinct from old.location_id then
    select name into from_site from public.locations where id = old.location_id;
    select name into to_site from public.locations where id = new.location_id;
    insert into public.it_asset_events (account_id, asset_id, kind, summary, actor_id, actor_name)
    values (new.account_id, new.id, 'moved',
            'Moved from ' || coalesce(from_site, 'office or storage') || ' to ' || coalesce(to_site, 'office or storage'),
            actor, actor_nm);
  end if;

  if new.status is distinct from old.status then
    insert into public.it_asset_events (account_id, asset_id, kind, summary, actor_id, actor_name)
    values (new.account_id, new.id, 'status',
            'Status changed from '
              || case old.status when 'in_use' then 'In use' when 'spare' then 'Spare' when 'on_order' then 'On order'
                   when 'in_repair' then 'In repair' when 'retired' then 'Retired' when 'lost' then 'Lost or stolen'
                   else old.status end
              || ' to '
              || case new.status when 'in_use' then 'In use' when 'spare' then 'Spare' when 'on_order' then 'On order'
                   when 'in_repair' then 'In repair' when 'retired' then 'Retired' when 'lost' then 'Lost or stolen'
                   else new.status end,
            actor, actor_nm);
  end if;

  if nullif(btrim(new.assigned_to), '') is distinct from nullif(btrim(old.assigned_to), '') then
    insert into public.it_asset_events (account_id, asset_id, kind, summary, actor_id, actor_name)
    values (new.account_id, new.id, 'assigned',
            case when nullif(btrim(new.assigned_to), '') is null
                 then 'Unassigned from ' || btrim(old.assigned_to)
                 else 'Assigned to ' || btrim(new.assigned_to) end,
            actor, actor_nm);
  end if;

  if new.last_verified_at is not null and new.last_verified_at is distinct from old.last_verified_at then
    select name into to_site from public.locations where id = new.location_id;
    insert into public.it_asset_events (account_id, asset_id, kind, summary, actor_id, actor_name)
    values (new.account_id, new.id, 'verified',
            'Checked in person' || coalesce(' at ' || to_site, ''), actor, actor_nm);
  end if;

  return new;
end $$;
drop trigger if exists it_assets_log_trg on public.it_assets;
create trigger it_assets_log_trg
after insert or update on public.it_assets
for each row execute function public.it_assets_log();
