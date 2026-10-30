-- IT Inventory slice F (2026-10-30): the overview numbers, supply counts that
-- know when they ran low, device heartbeats, "it's not working" reports, and
-- the sweep that marks silent devices offline. Reminders are the it-reminders
-- edge function (scheduled in 0193); they read it_reminder_candidates() below.

-- ---- Settings: reminders stay off until an admin turns them on ------------------
-- The rules ship with sensible thresholds, but nothing is texted or emailed
-- until the account says so (Settings > Reminders).
alter table public.it_settings add column if not exists reminders_enabled boolean not null default false;

-- ---- Supplies: counted, and low since when --------------------------------------
-- counted_at: the last time a person counted or restocked it. A supply nobody
-- has counted (like the seeded Sticker Stock at 0) is "not counted", never
-- "low", so it can't set off reminders.
-- low_since: the day it dropped to its minimum, cleared when it's back above.
-- Reminders use it as the due date, so a low supply reminds once per dip.
alter table public.it_consumables add column if not exists counted_at timestamptz;
alter table public.it_consumables add column if not exists low_since date;

create or replace function public.it_consumables_low()
returns trigger language plpgsql as $$
declare
  prev date;
begin
  if tg_op = 'UPDATE' then
    prev := old.low_since;
  end if;
  new.low_since := case
    when new.deleted_at is null and new.counted_at is not null and new.min_qty > 0 and new.qty_on_hand <= new.min_qty
    then coalesce(prev, current_date) end;
  return new;
end $$;
drop trigger if exists it_consumables_low on public.it_consumables;
create trigger it_consumables_low before insert or update on public.it_consumables
  for each row execute function public.it_consumables_low();

-- Restocks and adjustments mean a person counted it.
create or replace function public.it_consumable_events_apply()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  loc uuid;
begin
  update public.it_consumables
     set qty_on_hand = qty_on_hand + new.delta,
         counted_at = case when new.reason in ('restock', 'adjustment') then now() else counted_at end
   where id = new.consumable_id and account_id = new.account_id
  returning location_id into loc;
  if loc is null then
    raise exception 'Unknown consumable';
  end if;
  return new;
end $$;

-- Stock bookkeeping columns repeat the event rows, so they aren't edits.
create or replace function public.it_log_consumable_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  skip text[] := array['qty_on_hand', 'updated_at', 'counted_at', 'low_since'];
begin
  if (to_jsonb(new) - skip) is distinct from (to_jsonb(old) - skip) then
    insert into public.it_activity_log
      (account_id, location_id, entity_type, entity_id, action, actor_user_id, actor_name, before, after)
    select new.account_id, new.location_id, 'consumable', new.id,
           case when old.deleted_at is null and new.deleted_at is not null then 'deleted' else 'updated' end,
           auth.uid(), (select name from public.users where id = auth.uid()),
           (select jsonb_object_agg(k, to_jsonb(old) -> k) from jsonb_object_keys(to_jsonb(new)) k
             where not (k = any (skip)) and (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k)),
           (select jsonb_object_agg(k, to_jsonb(new) -> k) from jsonb_object_keys(to_jsonb(new)) k
             where not (k = any (skip)) and (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k));
  end if;
  return null;
end $$;

-- ---- Overview numbers -------------------------------------------------------------
-- Everything the dashboard tiles count, for one site or (null) every site the
-- caller can see. Runs as the caller, so RLS scopes it. p_today is the
-- caller's date so the counts match the list filters exactly.
create or replace function public.it_overview(p_location uuid default null, p_today date default current_date)
returns jsonb language sql stable security invoker set search_path = public as $$
  with a as materialized (
    select a.id, a.location_id, a.category_id, a.health_state, a.monitoring_enabled,
           a.warranty_end_date, a.next_audit_date, a.sticker_condition,
           st.type as st_type, lower(st.name) as st_name, coalesce(t.printed_count, 0) as printed
      from public.it_assets a
      left join public.it_status_labels st on st.id = a.status_label_id
      left join public.it_asset_tags t on t.account_id = a.account_id and t.tag = a.asset_tag
     where a.deleted_at is null and coalesce(st.type, '') <> 'archived'
       and (p_location is null or a.location_id = p_location)
  ),
  sub as materialized (
    select s.location_id,
           case s.billing_cycle when 'monthly' then s.cost when 'quarterly' then s.cost / 3 when 'annual' then s.cost / 12 end as monthly,
           case when s.auto_renew and coalesce(s.cancel_notice_days, 0) > 0
                then s.renewal_date - s.cancel_notice_days else s.renewal_date end as act_by
      from public.it_subscriptions s
     where s.deleted_at is null and (p_location is null or s.location_id = p_location)
  )
  select jsonb_build_object(
    'total', (select count(*) from a),
    'attention', jsonb_build_object(
      'offline',   (select count(*) from a where health_state = 'offline'),
      'repair',    (select count(*) from a where st_name = 'out for repair'),
      'warranty',  (select count(*) from a where warranty_end_date between p_today and p_today + 60),
      'audits',    (select count(*) from a where next_audit_date < p_today),
      'stickers',  (select count(*) from a where printed = 0 or sticker_condition in ('faded', 'missing')),
      'renewals',  (select count(*) from sub where act_by between p_today and p_today + 60),
      'low_stock', (select count(*) from public.it_consumables c
                     where c.deleted_at is null and c.low_since is not null
                       and (p_location is null or c.location_id = p_location))
    ),
    'health', jsonb_build_object(
      'monitored', (select count(*) from a where monitoring_enabled),
      'online',    (select count(*) from a where health_state = 'online'),
      'offline',   (select count(*) from a where health_state = 'offline'),
      'degraded',  (select count(*) from a where health_state = 'degraded')
    ),
    'by_site', (select coalesce(jsonb_agg(x order by x.name), '[]'::jsonb) from (
      select l.id, l.name, count(*) as total,
             count(*) filter (where a.monitoring_enabled) as monitored,
             count(*) filter (where a.health_state = 'online') as online,
             count(*) filter (where a.health_state = 'offline') as offline,
             count(*) filter (where a.st_name = 'out for repair') as repair,
             count(*) filter (where a.st_type = 'undeployable') as not_working
        from a join public.locations l on l.id = a.location_id
       group by l.id, l.name) x),
    'by_category', (select coalesce(jsonb_agg(x order by x.total desc, x.name), '[]'::jsonb) from (
      select c.id, c.name, c.icon, count(*) as total,
             count(*) filter (where a.health_state = 'offline') as offline
        from a join public.it_categories c on c.id = a.category_id
       group by c.id, c.name, c.icon) x),
    'spend', jsonb_build_object(
      'monthly', (select coalesce(sum(monthly), 0) from sub),
      'unpriced', (select count(*) from sub where monthly is null),
      'by_site', (select coalesce(jsonb_agg(x order by x.monthly desc), '[]'::jsonb) from (
        select sub.location_id as id, coalesce(l.name, 'Every site') as name, sum(sub.monthly) as monthly, count(*) as items
          from sub left join public.locations l on l.id = sub.location_id
         group by sub.location_id, l.name) x)
    ),
    'repair_spend_90d', (select coalesce(sum(m.cost), 0) from public.it_maintenances m
                          where coalesce(m.completion_date, m.start_date) >= p_today - 90
                            and (p_location is null or m.location_id = p_location))
  )
$$;
grant execute on function public.it_overview(uuid, date) to authenticated;

-- ---- Health: manual reports -----------------------------------------------------
-- Observation times are the moment of the row, not of the transaction, so
-- "the latest report" is well defined even when two land together.
alter table public.it_health_events alter column observed_at set default clock_timestamp();

-- A health event changes the asset's health badge. People record manual ones
-- ("it's not working", "it's working again"); heartbeats and the sweep below
-- record the rest. The asset update writes the health_changed log row, with
-- the event's note.
create or replace function public.it_health_events_apply()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a     public.it_assets%rowtype;
  state text := new.state;
begin
  select * into a from public.it_assets where id = new.asset_id;
  -- "It's working" on a device nothing monitors means no known problem, not online.
  if new.source = 'manual' and state = 'online' and not a.monitoring_enabled then
    state := 'unknown';
  end if;
  if a.health_state is distinct from state then
    perform set_config('it.note', coalesce(new.note, ''), true);
    update public.it_assets set health_state = state, health_changed_at = new.observed_at where id = a.id;
    perform set_config('it.note', '', true);
  end if;
  return null;
end $$;
drop trigger if exists it_health_events_apply_trg on public.it_health_events;
create trigger it_health_events_apply_trg after insert on public.it_health_events
  for each row execute function public.it_health_events_apply();

-- A person said it's not working, and nobody has said it's fixed since. That
-- holds even if the device keeps reporting in (a tablet with a cracked screen
-- still sends heartbeats).
create or replace function public.it_manual_down(p_asset uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select e.source = 'manual' and e.state = 'offline'
                     from public.it_health_events e
                    where e.asset_id = p_asset
                    order by e.observed_at desc, e.created_at desc
                    limit 1), false)
$$;

-- ---- Health: device heartbeats ---------------------------------------------------
-- A tablet or kiosk browser that runs Operator is linked to its asset once
-- (it_link_device, from the asset page on that device). The device keeps the
-- key in its browser and reports in (it_heartbeat) while Operator is open,
-- signed in or not. Only the key's hash is stored.
create table if not exists public.it_device_links (
  asset_id    uuid primary key references public.it_assets(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  key_hash    text not null unique,
  device_info text,
  linked_at   timestamptz not null default now(),
  linked_by   uuid references public.users(id) on delete set null
);
alter table public.it_device_links enable row level security;
-- No policies: only the functions below read or write it.

create index if not exists it_assets_heartbeat_idx on public.it_assets (last_seen_at)
  where deleted_at is null and monitoring_enabled and monitor_method = 'heartbeat';

create or replace function public.it_link_device(p_asset uuid, p_device text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  a public.it_assets%rowtype;
  k text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  select * into a from public.it_assets
   where id = p_asset and account_id = auth_account_id() and deleted_at is null;
  if not found or not it_can_write(a.location_id) then
    raise exception 'You can''t set up monitoring at this site' using errcode = '42501';
  end if;
  insert into public.it_device_links (asset_id, account_id, key_hash, device_info, linked_by)
  values (a.id, a.account_id, encode(sha256(convert_to(k, 'UTF8')), 'hex'), left(p_device, 200), auth.uid())
  on conflict (asset_id) do update
    set key_hash = excluded.key_hash, device_info = excluded.device_info, linked_at = now(), linked_by = excluded.linked_by;
  perform set_config('it.note', 'Linked ' || coalesce(nullif(left(p_device, 80), ''), 'a device') || ' to report in while Operator is open', true);
  update public.it_assets
     set monitoring_enabled = true, monitor_method = 'heartbeat'
   where id = a.id and (not monitoring_enabled or monitor_method <> 'heartbeat');
  perform set_config('it.note', '', true);
  return k;
end $$;
grant execute on function public.it_link_device(uuid, text) to authenticated;

create or replace function public.it_unlink_device(p_asset uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  a     public.it_assets%rowtype;
  state text;
begin
  select * into a from public.it_assets
   where id = p_asset and account_id = auth_account_id();
  if not found or not it_can_write(a.location_id) then
    raise exception 'You can''t change monitoring at this site' using errcode = '42501';
  end if;
  delete from public.it_device_links where asset_id = a.id;
  -- Unmonitored devices have no known health, unless a person reported them down.
  state := case when it_manual_down(a.id) then 'offline' else 'unknown' end;
  perform set_config('it.note', 'Stopped monitoring', true);
  update public.it_assets
     set monitoring_enabled = false, monitor_method = 'none', health_state = state,
         health_changed_at = case when a.health_state = state then a.health_changed_at else now() end
   where id = a.id;
  perform set_config('it.note', '', true);
end $$;
grant execute on function public.it_unlink_device(uuid) to authenticated;

-- Called every minute by a linked device. Writes at most twice a minute per
-- device and logs only state changes.
create or replace function public.it_heartbeat(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.it_device_links%rowtype;
  a public.it_assets%rowtype;
begin
  if coalesce(length(p_key), 0) < 32 then
    return jsonb_build_object('ok', false, 'reason', 'unlinked');
  end if;
  select * into l from public.it_device_links where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex');
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unlinked');
  end if;
  select * into a from public.it_assets where id = l.asset_id;
  if a.deleted_at is not null or not a.monitoring_enabled or a.monitor_method <> 'heartbeat' then
    return jsonb_build_object('ok', false, 'reason', 'not_monitored');
  end if;

  -- Report as the system, not as whoever happens to be signed in on the device.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('it.actor_system', 'heartbeat', true);

  if a.health_state = 'online' or it_manual_down(a.id) then
    if a.last_seen_at is null or a.last_seen_at < now() - interval '30 seconds' then
      update public.it_assets set last_seen_at = now() where id = a.id;
    end if;
  else
    update public.it_assets set last_seen_at = now() where id = a.id;
    insert into public.it_health_events (account_id, asset_id, state, source, note)
    values (a.account_id, a.id, 'online', 'heartbeat', 'Reporting in');
  end if;
  return jsonb_build_object('ok', true, 'tag', a.asset_tag, 'name', a.name, 'interval', a.monitor_interval_seconds);
end $$;
grant execute on function public.it_heartbeat(text) to anon, authenticated;

-- The offline rule (spec J.3): no heartbeat within 2 x the device's interval
-- means offline. Runs every 2 minutes from pg_cron.
create or replace function public.it_health_sweep()
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  perform set_config('it.actor_system', 'health check', true);
  insert into public.it_health_events (account_id, asset_id, state, source, note)
  select a.account_id, a.id, 'offline', 'heartbeat', 'Stopped reporting in'
    from public.it_assets a
   where a.deleted_at is null and a.monitoring_enabled and a.monitor_method = 'heartbeat'
     and a.health_state in ('online', 'degraded')
     and a.last_seen_at < now() - make_interval(secs => 2 * a.monitor_interval_seconds);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---- Reminder candidates -----------------------------------------------------------
-- Everything with a date coming up (or a supply that ran low) for one account,
-- for the it-reminders edge function, which picks thresholds, people and
-- channels and keeps the it_reminder_sends ledger. Subscriptions are due on
-- their cancel-by date when they renew by themselves with a notice period,
-- otherwise on the renewal date.
create or replace function public.it_reminder_candidates(p_account uuid, p_today date, p_horizon integer)
returns table (kind text, entity_type text, entity_id uuid, location_id uuid, site text, due_date date, info jsonb)
language sql stable security definer set search_path = public as $$
  with a as (
    select a.*, l.name as site
      from public.it_assets a
      join public.locations l on l.id = a.location_id
      left join public.it_status_labels st on st.id = a.status_label_id
     where a.account_id = p_account and a.deleted_at is null and coalesce(st.type, '') <> 'archived'
  )
  select 'warranty', 'asset', a.id, a.location_id, a.site, a.warranty_end_date,
         jsonb_build_object('tag', a.asset_tag, 'name', a.name)
    from a where a.warranty_end_date between p_today and p_today + p_horizon
  union all
  select 'eol', 'asset', a.id, a.location_id, a.site, a.eol_date,
         jsonb_build_object('tag', a.asset_tag, 'name', a.name)
    from a where a.eol_date between p_today and p_today + p_horizon
  union all
  select 'audit_due', 'asset', a.id, a.location_id, a.site, a.next_audit_date,
         jsonb_build_object('tag', a.asset_tag, 'name', a.name)
    from a where a.next_audit_date between p_today and p_today + p_horizon
  union all
  select 'subscription_renewal', 'subscription', s.id, s.location_id, l.name, s.act_by,
         jsonb_build_object('name', s.name, 'renewal_date', s.renewal_date, 'auto_renew', s.auto_renew,
                            'cancel_by', case when s.act_by <> s.renewal_date then s.act_by end,
                            'cost', s.cost, 'cycle', s.billing_cycle, 'provider', sp.name,
                            'owner_user_id', s.owner_user_id)
    from (select s.*, case when s.auto_renew and coalesce(s.cancel_notice_days, 0) > 0
                           then s.renewal_date - s.cancel_notice_days else s.renewal_date end as act_by
            from public.it_subscriptions s
           where s.account_id = p_account and s.deleted_at is null and s.renewal_date is not null) s
    left join public.locations l on l.id = s.location_id
    left join public.it_suppliers sp on sp.id = s.supplier_id
   where s.act_by between p_today and p_today + p_horizon
  union all
  select 'low_stock', 'consumable', c.id, c.location_id, l.name, c.low_since,
         jsonb_build_object('name', c.name, 'qty', c.qty_on_hand, 'min', c.min_qty, 'reorder_url', c.reorder_url)
    from public.it_consumables c
    join public.locations l on l.id = c.location_id
   where c.account_id = p_account and c.deleted_at is null and c.low_since is not null
$$;

revoke execute on function public.it_health_sweep() from public, anon, authenticated;
revoke execute on function public.it_reminder_candidates(uuid, date, integer) from public, anon, authenticated;
revoke execute on function public.it_manual_down(uuid) from public, anon, authenticated;

-- ---- Schedules ---------------------------------------------------------------------
select cron.unschedule('it-health-sweep') where exists (select 1 from cron.job where jobname = 'it-health-sweep');
select cron.schedule('it-health-sweep', '*/2 * * * *', $$select public.it_health_sweep()$$);

-- Raw observations are kept 90 days; state changes stay in it_activity_log.
select cron.unschedule('it-health-prune') where exists (select 1 from cron.job where jobname = 'it-health-prune');
select cron.schedule('it-health-prune', '5 9 * * *',
  $$delete from public.it_health_events where observed_at < now() - interval '90 days'$$);
