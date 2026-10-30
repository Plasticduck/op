-- IT Inventory, Phase 1 activity log (2026-10-30). Append-only history of every
-- IT Inventory change, written by triggers so it can't be skipped. The app
-- roles can read it (by site, like everything else) but cannot insert, update
-- or delete rows; only the security definer trigger functions write here.

create table if not exists public.it_activity_log (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  location_id   uuid,
  -- The asset the row is about, for the asset Timeline. No FK: history
  -- outlives a hard-deleted asset.
  asset_id      uuid,
  entity_type   text not null,
  entity_id     uuid not null,
  action        text not null check (action in (
                  'created', 'updated', 'checked_out', 'checked_in', 'status_changed', 'audited',
                  'maintenance_logged', 'health_changed', 'imported', 'deleted', 'secret_revealed',
                  'label_printed', 'tag_applied', 'tag_retired')),
  actor_user_id uuid,
  actor_name    text,
  actor_system  text,
  before        jsonb,
  after         jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists it_activity_log_asset_idx on public.it_activity_log (asset_id, created_at desc) where asset_id is not null;
create index if not exists it_activity_log_account_idx on public.it_activity_log (account_id, created_at desc);
create index if not exists it_activity_log_entity_idx on public.it_activity_log (entity_type, entity_id);

alter table public.it_activity_log enable row level security;
create policy it_activity_log_select on public.it_activity_log
  for select using (account_id = auth_account_id() and it_can_read(location_id));
revoke insert, update, delete, truncate on public.it_activity_log from public, anon, authenticated;

-- Generic logger. tg_argv[0] = entity type. Updates store only the changed
-- columns (before and after). Bookkeeping columns are ignored, and so are the
-- assignment columns on assets (it_assignments logs check-out and check-in).
-- Set `it.action` (e.g. 'imported') for the transaction to label bulk writes.
create or replace function public.it_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ent     text := tg_argv[0];
  r_new   jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r_old   jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  rec     jsonb;
  skip    text[] := array['updated_at', 'created_at', 'created_by', 'last_seen_at', 'warranty_end_manual',
                          'assigned_type', 'assigned_id', 'assigned_label', 'printed_count', 'last_printed_at'];
  b       jsonb := '{}'::jsonb;
  a       jsonb := '{}'::jsonb;
  k       text;
  act     text;
  forced  text := nullif(current_setting('it.action', true), '');
  uid     uuid := auth.uid();
  nm      text;
  v_asset uuid;
begin
  rec := coalesce(r_new, r_old);
  if rec ->> 'account_id' is null then
    return null; -- system rows (shared label templates) belong to no account
  end if;

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(r_new) loop
      if not (k = any (skip)) and (r_new -> k) is distinct from (r_old -> k) then
        b := b || jsonb_build_object(k, r_old -> k);
        a := a || jsonb_build_object(k, r_new -> k);
      end if;
    end loop;
    if a = '{}'::jsonb then
      return null;
    end if;
  end if;

  if ent = 'tag' then
    -- Only tag status moves are history; the asset row covers the rest.
    if tg_op <> 'UPDATE' or not (a ? 'status') then
      return null;
    end if;
    act := case r_new ->> 'status' when 'applied' then 'tag_applied' when 'retired' then 'tag_retired' else 'updated' end;
  elsif tg_op = 'INSERT' then
    act := case ent
      when 'assignment' then 'checked_out'
      when 'maintenance' then 'maintenance_logged'
      else coalesce(forced, 'created') end;
    a := jsonb_strip_nulls(r_new) - skip;
    b := null;
  elsif tg_op = 'DELETE' then
    act := 'deleted';
    b := jsonb_strip_nulls(r_old) - skip;
    a := null;
  elsif ent = 'assignment' and (r_old ->> 'checked_in_at') is null and (r_new ->> 'checked_in_at') is not null then
    act := 'checked_in';
  elsif (r_old ->> 'deleted_at') is null and (r_new ->> 'deleted_at') is not null then
    act := 'deleted';
  elsif ent = 'asset' and a ? 'status_label_id' then
    act := 'status_changed';
  elsif ent = 'asset' and a ? 'health_state' then
    act := 'health_changed';
  else
    act := coalesce(forced, 'updated');
  end if;

  v_asset := case when ent = 'asset' then (rec ->> 'id')::uuid else (rec ->> 'asset_id')::uuid end;
  if uid is not null then
    select name into nm from public.users where id = uid;
  end if;

  insert into public.it_activity_log
    (account_id, location_id, asset_id, entity_type, entity_id, action, actor_user_id, actor_name, actor_system, before, after)
  values
    ((rec ->> 'account_id')::uuid, (rec ->> 'location_id')::uuid, v_asset, ent, (rec ->> 'id')::uuid, act,
     uid, nm, case when uid is null then coalesce(nullif(current_setting('it.actor_system', true), ''), 'system') end,
     b, a);
  return null;
end $$;

create trigger it_assets_log after insert or update or delete on public.it_assets
  for each row execute function public.it_log('asset');
create trigger it_assignments_log after insert or update on public.it_assignments
  for each row execute function public.it_log('assignment');
create trigger it_maintenances_log after insert or update or delete on public.it_maintenances
  for each row execute function public.it_log('maintenance');
create trigger it_asset_tags_log after update on public.it_asset_tags
  for each row execute function public.it_log('tag');
create trigger it_subscriptions_log after insert or update or delete on public.it_subscriptions
  for each row execute function public.it_log('subscription');
create trigger it_subscription_assets_log after insert or delete on public.it_subscription_assets
  for each row execute function public.it_log('subscription_asset');
create trigger it_consumables_log after insert or delete on public.it_consumables
  for each row execute function public.it_log('consumable');
create trigger it_consumable_events_log after insert on public.it_consumable_events
  for each row execute function public.it_log('consumable_event');
create trigger it_attachments_log after insert or update or delete on public.it_attachments
  for each row execute function public.it_log('attachment');
create trigger it_site_areas_log after insert or update or delete on public.it_site_areas
  for each row execute function public.it_log('area');
create trigger it_asset_models_log after insert or update or delete on public.it_asset_models
  for each row execute function public.it_log('model');
create trigger it_manufacturers_log after insert or update or delete on public.it_manufacturers
  for each row execute function public.it_log('manufacturer');
create trigger it_suppliers_log after insert or update or delete on public.it_suppliers
  for each row execute function public.it_log('supplier');
create trigger it_categories_log after insert or update or delete on public.it_categories
  for each row execute function public.it_log('category');
create trigger it_status_labels_log after insert or update or delete on public.it_status_labels
  for each row execute function public.it_log('status_label');
create trigger it_custom_fields_log after insert or update or delete on public.it_custom_fields
  for each row execute function public.it_log('custom_field');
create trigger it_fieldsets_log after insert or update or delete on public.it_fieldsets
  for each row execute function public.it_log('fieldset');
create trigger it_label_templates_log after insert or update or delete on public.it_label_templates
  for each row execute function public.it_log('label_template');
create trigger it_maintenance_types_log after insert or update or delete on public.it_maintenance_types
  for each row execute function public.it_log('maintenance_type');
create trigger it_settings_log after update on public.it_settings
  for each row execute function public.it_log('settings');

-- Consumable stock moves are logged by their event rows; the running total on
-- the consumable itself would just repeat them. Other consumable edits log.
create or replace function public.it_log_consumable_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (to_jsonb(new) - 'qty_on_hand' - 'updated_at') is distinct from (to_jsonb(old) - 'qty_on_hand' - 'updated_at') then
    insert into public.it_activity_log
      (account_id, location_id, entity_type, entity_id, action, actor_user_id, actor_name, before, after)
    select new.account_id, new.location_id, 'consumable', new.id,
           case when old.deleted_at is null and new.deleted_at is not null then 'deleted' else 'updated' end,
           auth.uid(), (select name from public.users where id = auth.uid()),
           (select jsonb_object_agg(k, to_jsonb(old) -> k) from jsonb_object_keys(to_jsonb(new)) k
             where k not in ('qty_on_hand', 'updated_at') and (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k)),
           (select jsonb_object_agg(k, to_jsonb(new) -> k) from jsonb_object_keys(to_jsonb(new)) k
             where k not in ('qty_on_hand', 'updated_at') and (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k));
  end if;
  return null;
end $$;
create trigger it_consumables_log_update after update on public.it_consumables
  for each row execute function public.it_log_consumable_update();

-- One label_printed row per asset on the job (so each asset's Timeline shows
-- it), plus one for any blank pool tags printed.
create or replace function public.it_log_print()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  nm    text;
  tname text;
begin
  select name into nm from public.users where id = new.printed_by;
  select name into tname from public.it_label_templates where id = new.template_id;
  insert into public.it_activity_log
    (account_id, location_id, asset_id, entity_type, entity_id, action, actor_user_id, actor_name, after)
  select new.account_id, a.location_id, a.id, 'asset', a.id, 'label_printed', new.printed_by, nm,
         jsonb_build_object('job_id', new.id, 'template', tname, 'copies', new.copies, 'quantity', new.quantity)
    from public.it_assets a
   where a.id = any (new.asset_ids) and a.account_id = new.account_id;
  if coalesce(array_length(new.tag_ids, 1), 0) > 0 then
    insert into public.it_activity_log
      (account_id, location_id, entity_type, entity_id, action, actor_user_id, actor_name, after)
    values (new.account_id, new.location_id, 'label_print_job', new.id, 'label_printed', new.printed_by, nm,
            jsonb_build_object('template', tname, 'blank_tags', array_length(new.tag_ids, 1), 'copies', new.copies));
  end if;
  return null;
end $$;
create trigger it_label_print_jobs_log after insert on public.it_label_print_jobs
  for each row execute function public.it_log_print();
