-- IT Inventory slice E (2026-10-30): one search across the inventory, and CSV
-- import for assets, models and subscriptions.
--
-- Search runs as the caller (RLS decides what it finds). The importers run
-- with owner rights instead: evaluating RLS on every lookup made a 500-row
-- import take 44 s (the request limit is 8 s). They check access themselves:
-- every lookup is scoped to the caller's account, every site written to (and
-- every existing item's current site) must pass it_can_write(), new
-- categories need it_is_admin(), and the asset triggers still enforce tags,
-- duplicates and logging as the caller.

create index if not exists it_assets_site_name_idx
  on public.it_assets (location_id, lower(name)) where deleted_at is null;

-- ---- Search ----------------------------------------------------------------------------
-- Tag, name, serial, model, manufacturer, IP, MAC, hostname and notes, with
-- trigram matching for typos in names. An exact tag or serial (what a USB
-- barcode scanner types) comes first and is flagged so the caller can jump
-- straight to it.
create or replace function public.it_search(p_q text, p_limit integer default 12)
returns table (id uuid, asset_tag text, name text, site text, category text, matched text, exact boolean)
language sql stable security invoker set search_path = public, extensions as $$
  with q as (
    select btrim(p_q) as raw,
           upper(btrim(p_q)) as up,
           lower(btrim(p_q)) as low,
           '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  )
  select a.id, a.asset_tag, a.name, l.name, c.name,
         case
           when a.asset_tag = q.up then 'tag'
           when upper(a.serial) = q.up then 'serial'
           when host(a.ip_address) = q.raw then 'ip'
           when a.mac_address::text = replace(q.low, '-', ':') then 'mac'
         end,
         (a.asset_tag = q.up or upper(a.serial) = q.up)
    from public.it_assets a
    cross join q
    join public.locations l on l.id = a.location_id
    join public.it_categories c on c.id = a.category_id
    left join public.it_asset_models m on m.id = a.model_id
    left join public.it_manufacturers mf on mf.id = m.manufacturer_id
   where a.deleted_at is null
     and length(q.raw) >= 2
     and (a.asset_tag ilike q.pat or a.name ilike q.pat or a.serial ilike q.pat or a.hostname ilike q.pat
          or a.notes ilike q.pat or m.name ilike q.pat or m.model_number ilike q.pat or mf.name ilike q.pat
          or host(a.ip_address) like btrim(p_q) || '%'
          or a.mac_address::text like replace(q.low, '-', ':') || '%'
          or a.name % q.raw)
   order by 7 desc, similarity(a.name, q.raw) desc, a.asset_tag
   limit greatest(1, least(p_limit, 50))
$$;

-- ---- Import helpers ----------------------------------------------------------------------

-- A site by its name, or by the start of its name when that's unambiguous
-- ("MW12" finds "MW12 Lubbock 50th St").
create or replace function public.it_find_site(p_name text)
returns uuid language plpgsql stable security invoker set search_path = public as $$
declare
  v_id uuid;
  n    integer;
begin
  if nullif(btrim(p_name), '') is null then return null; end if;
  select id into v_id from public.locations
   where account_id = auth_account_id() and not coalesce(archived, false) and lower(name) = lower(btrim(p_name));
  if v_id is not null then return v_id; end if;
  select count(*), min(id::text)::uuid into n, v_id from public.locations
   where account_id = auth_account_id() and not coalesce(archived, false) and lower(name) like lower(btrim(p_name)) || '%';
  return case when n = 1 then v_id end;
end $$;

-- Text to a number, ignoring $ and thousands separators. Blank is null.
create or replace function public.it_num(p text)
returns numeric language sql immutable as $$
  select nullif(regexp_replace(coalesce(p, ''), '[$,\s]', '', 'g'), '')::numeric
$$;

-- One summary row per import in the activity log (who, what file, how many,
-- where the error report is). The rows themselves are logged as 'imported'.
create or replace function public.it_log_import(p_summary jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if auth_account_id() is null or not it_is_staff() then
    raise exception 'Not allowed';
  end if;
  insert into public.it_activity_log (account_id, entity_type, entity_id, action, actor_user_id, actor_name, after)
  values (auth_account_id(), 'import', v_id, 'imported', auth.uid(),
          (select name from public.users where id = auth.uid()), p_summary);
  return v_id;
end $$;

-- ---- Import: assets --------------------------------------------------------------------------
-- p_rows: [{ row, tag, name, site, area, category, model, manufacturer, serial,
--   mac, ip, hostname, status, purchase_date, purchase_cost, supplier,
--   order_number, warranty_end, notes, custom: {key: value} }]
-- p_create: { manufacturers, models, areas, suppliers, categories } (booleans):
--   what may be created when a name isn't found. Categories need an admin.
-- An existing item is matched by tag, then serial, then site + name +
-- category, and updated with whatever the row fills in (blank cells keep the
-- current value), so importing the same file twice never makes duplicates.
-- Returns [{ row, action: create | update | error, asset_id, tag, error }].
-- With p_commit false nothing is saved (and no tag numbers are used).
create or replace function public.it_import_assets(p_rows jsonb, p_commit boolean, p_create jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  acct    uuid := auth_account_id();
  r       jsonb;
  out     jsonb := '[]'::jsonb;
  v_loc   uuid;
  v_area  uuid;
  v_cat   uuid;
  v_mf    uuid;
  v_model uuid;
  v_stat  uuid;
  v_sup   uuid;
  v_id    uuid;
  v_tag   text;
  v_act   text;
  n       integer;
  t       text;
  c_mf    boolean := coalesce((p_create ->> 'manufacturers')::boolean, false);
  c_model boolean := coalesce((p_create ->> 'models')::boolean, false);
  c_area  boolean := coalesce((p_create ->> 'areas')::boolean, false);
  c_sup   boolean := coalesce((p_create ->> 'suppliers')::boolean, false);
  c_cat   boolean := coalesce((p_create ->> 'categories')::boolean, false);
begin
  if acct is null or not it_is_staff() then
    raise exception 'Only admins, managers and technicians can import';
  end if;
  perform set_config('it.action', 'imported', true);

  begin -- everything below is undone for a dry run
    for r in select * from jsonb_array_elements(p_rows) loop
      v_loc := null; v_area := null; v_cat := null; v_mf := null; v_model := null;
      v_stat := null; v_sup := null; v_id := null; v_tag := null;
      begin
        v_loc := it_find_site(r ->> 'site');
        if v_loc is null then
          raise exception 'Site "%" not found', coalesce(r ->> 'site', '');
        end if;
        if not it_can_write(v_loc) then
          raise exception 'You don''t manage %', (select name from public.locations where id = v_loc);
        end if;

        t := nullif(btrim(r ->> 'manufacturer'), '');
        if t is not null then
          select id into v_mf from public.it_manufacturers where account_id = acct and lower(name) = lower(t) and deleted_at is null;
          if v_mf is null then
            if not c_mf then raise exception 'Manufacturer "%" is new (allow creating manufacturers)', t; end if;
            insert into public.it_manufacturers (account_id, name) values (acct, t) returning id into v_mf;
          end if;
        end if;

        t := nullif(btrim(r ->> 'category'), '');
        if t is not null then
          select id into v_cat from public.it_categories where account_id = acct and lower(name) = lower(t) and deleted_at is null;
          if v_cat is null then
            if not (c_cat and it_is_admin()) then raise exception 'Category "%" doesn''t exist', t; end if;
            insert into public.it_categories (account_id, name, kind) values (acct, t, 'asset') returning id into v_cat;
          end if;
        end if;

        t := nullif(btrim(r ->> 'model'), '');
        if t is not null then
          select id into v_model from public.it_asset_models
           where account_id = acct and lower(name) = lower(t) and deleted_at is null
             and (v_mf is null or manufacturer_id = v_mf)
           order by (manufacturer_id = v_mf) desc nulls last limit 1;
          if v_model is null then
            if not c_model then raise exception 'Model "%" is new (allow creating models)', t; end if;
            if v_cat is null then raise exception 'New model "%" needs a category', t; end if;
            insert into public.it_asset_models (account_id, name, manufacturer_id, category_id)
            values (acct, t, v_mf, v_cat) returning id into v_model;
          end if;
          if v_cat is null then select category_id into v_cat from public.it_asset_models where id = v_model; end if;
        end if;

        t := nullif(btrim(r ->> 'area'), '');
        if t is not null then
          select id into v_area from public.it_site_areas where location_id = v_loc and lower(name) = lower(t) and deleted_at is null;
          if v_area is null then
            if not c_area then raise exception 'Area "%" is new at that site (allow creating areas)', t; end if;
            insert into public.it_site_areas (account_id, location_id, name, sort_order)
            values (acct, v_loc, t, 900) returning id into v_area;
          end if;
        end if;

        t := nullif(btrim(r ->> 'status'), '');
        if t is not null then
          select id into v_stat from public.it_status_labels where account_id = acct and lower(name) = lower(t) and deleted_at is null;
          if v_stat is null then raise exception 'Status "%" doesn''t exist', t; end if;
        end if;

        t := nullif(btrim(r ->> 'supplier'), '');
        if t is not null then
          select id into v_sup from public.it_suppliers where account_id = acct and lower(name) = lower(t) and deleted_at is null;
          if v_sup is null then
            if not c_sup then raise exception 'Supplier "%" is new (allow creating suppliers)', t; end if;
            insert into public.it_suppliers (account_id, name) values (acct, t) returning id into v_sup;
          end if;
        end if;

        -- Find the item this row is about.
        v_tag := nullif(upper(btrim(r ->> 'tag')), '');
        if v_tag is not null then
          select id into v_id from public.it_assets where account_id = acct and asset_tag = v_tag;
        end if;
        if v_id is null and nullif(btrim(r ->> 'serial'), '') is not null then
          select id into v_id from public.it_assets
           where account_id = acct and serial is not null and upper(serial) = upper(btrim(r ->> 'serial')) and deleted_at is null;
        end if;
        if v_id is null and v_tag is null and nullif(btrim(r ->> 'serial'), '') is null and v_cat is not null then
          select count(*), min(id::text)::uuid into n, v_id from public.it_assets
           where account_id = acct and location_id = v_loc and category_id = v_cat and deleted_at is null
             and lower(name) = lower(btrim(coalesce(r ->> 'name', '')));
          if n > 1 then raise exception 'Several items at that site are called "%". Add a tag or serial to this row.', r ->> 'name'; end if;
        end if;
        if v_id is not null and not it_can_write((select location_id from public.it_assets where id = v_id)) then
          raise exception 'That item is at a site you don''t manage';
        end if;

        if v_id is not null then
          update public.it_assets set
            location_id       = v_loc,
            area_id           = coalesce(v_area, case when location_id = v_loc then area_id end),
            name              = coalesce(nullif(btrim(r ->> 'name'), ''), name),
            category_id       = coalesce(v_cat, category_id),
            model_id          = coalesce(v_model, model_id),
            serial            = coalesce(nullif(btrim(r ->> 'serial'), ''), serial),
            mac_address       = coalesce(nullif(btrim(r ->> 'mac'), '')::macaddr, mac_address),
            ip_address        = coalesce(nullif(btrim(r ->> 'ip'), '')::inet, ip_address),
            hostname          = coalesce(nullif(btrim(r ->> 'hostname'), ''), hostname),
            status_label_id   = coalesce(v_stat, status_label_id),
            purchase_date     = coalesce(nullif(btrim(r ->> 'purchase_date'), '')::date, purchase_date),
            purchase_cost     = coalesce(it_num(r ->> 'purchase_cost'), purchase_cost),
            supplier_id       = coalesce(v_sup, supplier_id),
            order_number      = coalesce(nullif(btrim(r ->> 'order_number'), ''), order_number),
            warranty_end_date = coalesce(nullif(btrim(r ->> 'warranty_end'), '')::date, warranty_end_date),
            notes             = coalesce(nullif(btrim(r ->> 'notes'), ''), notes),
            custom_values     = custom_values || coalesce(r -> 'custom', '{}'::jsonb)
           where id = v_id
          returning asset_tag into v_tag;
          v_act := 'update';
        else
          if v_cat is null then raise exception 'Pick a category or a model for this row'; end if;
          insert into public.it_assets (
            account_id, location_id, area_id, asset_tag, name, category_id, model_id, serial, mac_address,
            ip_address, hostname, status_label_id, purchase_date, purchase_cost, supplier_id, order_number,
            warranty_end_date, notes, custom_values
          ) values (
            acct, v_loc, v_area, coalesce(v_tag, ''), coalesce(btrim(r ->> 'name'), ''), v_cat, v_model,
            nullif(btrim(r ->> 'serial'), ''), nullif(btrim(r ->> 'mac'), '')::macaddr, nullif(btrim(r ->> 'ip'), '')::inet,
            nullif(btrim(r ->> 'hostname'), ''),
            coalesce(v_stat, (select id from public.it_status_labels where account_id = acct and is_default and deleted_at is null)),
            nullif(btrim(r ->> 'purchase_date'), '')::date, it_num(r ->> 'purchase_cost'), v_sup,
            nullif(btrim(r ->> 'order_number'), ''), nullif(btrim(r ->> 'warranty_end'), '')::date,
            nullif(btrim(r ->> 'notes'), ''), coalesce(r -> 'custom', '{}'::jsonb)
          ) returning id, asset_tag into v_id, v_tag;
          v_act := 'create';
        end if;
        out := out || jsonb_build_object('row', r -> 'row', 'action', v_act, 'asset_id', v_id, 'tag', v_tag);
      exception when others then
        out := out || jsonb_build_object('row', r -> 'row', 'action', 'error', 'error', sqlerrm);
      end;
    end loop;
    if not p_commit then
      raise exception 'it_dry_run';
    end if;
  exception when raise_exception then
    if sqlerrm <> 'it_dry_run' then raise; end if;
  end;
  return out;
end $$;

-- ---- Import: models -----------------------------------------------------------------------------
-- p_rows: [{ row, name, manufacturer, category, model_number, warranty_months, eol_months, notes }]
-- Matched by manufacturer + name.
create or replace function public.it_import_models(p_rows jsonb, p_commit boolean, p_create jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  acct  uuid := auth_account_id();
  r     jsonb;
  out   jsonb := '[]'::jsonb;
  v_mf  uuid;
  v_cat uuid;
  v_id  uuid;
  v_act text;
  t     text;
begin
  if acct is null or not it_is_staff() then
    raise exception 'Only admins, managers and technicians can import';
  end if;
  perform set_config('it.action', 'imported', true);
  begin
    for r in select * from jsonb_array_elements(p_rows) loop
      v_mf := null; v_cat := null; v_id := null;
      begin
        if nullif(btrim(r ->> 'name'), '') is null then raise exception 'Every model needs a name'; end if;
        t := nullif(btrim(r ->> 'manufacturer'), '');
        if t is not null then
          select id into v_mf from public.it_manufacturers where account_id = acct and lower(name) = lower(t) and deleted_at is null;
          if v_mf is null then
            if not coalesce((p_create ->> 'manufacturers')::boolean, false) then
              raise exception 'Manufacturer "%" is new (allow creating manufacturers)', t;
            end if;
            insert into public.it_manufacturers (account_id, name) values (acct, t) returning id into v_mf;
          end if;
        end if;
        t := nullif(btrim(r ->> 'category'), '');
        if t is not null then
          select id into v_cat from public.it_categories where account_id = acct and lower(name) = lower(t) and deleted_at is null;
          if v_cat is null then
            if not (coalesce((p_create ->> 'categories')::boolean, false) and it_is_admin()) then
              raise exception 'Category "%" doesn''t exist', t;
            end if;
            insert into public.it_categories (account_id, name, kind) values (acct, t, 'asset') returning id into v_cat;
          end if;
        end if;
        select id into v_id from public.it_asset_models
         where account_id = acct and lower(name) = lower(btrim(r ->> 'name')) and deleted_at is null
           and manufacturer_id is not distinct from v_mf;
        if v_id is not null then
          update public.it_asset_models set
            category_id             = coalesce(v_cat, category_id),
            model_number            = coalesce(nullif(btrim(r ->> 'model_number'), ''), model_number),
            default_warranty_months = coalesce(it_num(r ->> 'warranty_months')::integer, default_warranty_months),
            eol_months              = coalesce(it_num(r ->> 'eol_months')::integer, eol_months),
            notes                   = coalesce(nullif(btrim(r ->> 'notes'), ''), notes)
           where id = v_id;
          v_act := 'update';
        else
          if v_cat is null then raise exception 'A new model needs a category'; end if;
          insert into public.it_asset_models (account_id, name, manufacturer_id, category_id, model_number,
                                              default_warranty_months, eol_months, notes)
          values (acct, btrim(r ->> 'name'), v_mf, v_cat, nullif(btrim(r ->> 'model_number'), ''),
                  it_num(r ->> 'warranty_months')::integer, it_num(r ->> 'eol_months')::integer, nullif(btrim(r ->> 'notes'), ''))
          returning id into v_id;
          v_act := 'create';
        end if;
        out := out || jsonb_build_object('row', r -> 'row', 'action', v_act, 'id', v_id);
      exception when others then
        out := out || jsonb_build_object('row', r -> 'row', 'action', 'error', 'error', sqlerrm);
      end;
    end loop;
    if not p_commit then raise exception 'it_dry_run'; end if;
  exception when raise_exception then
    if sqlerrm <> 'it_dry_run' then raise; end if;
  end;
  return out;
end $$;

-- ---- Import: subscriptions ---------------------------------------------------------------------------
-- p_rows: [{ row, name, site (blank = every site), provider, category,
--   account_number, seats, cost, billing_cycle, start_date, renewal_date,
--   auto_renew, cancel_notice_days, notes }]
-- Matched by account number, or by name + site.
create or replace function public.it_import_subscriptions(p_rows jsonb, p_commit boolean, p_create jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  acct    uuid := auth_account_id();
  r       jsonb;
  out     jsonb := '[]'::jsonb;
  v_loc   uuid;
  v_sup   uuid;
  v_cat   uuid;
  v_id    uuid;
  v_act   text;
  v_cycle text;
  v_auto  boolean;
  t       text;
begin
  if acct is null or not it_is_staff() then
    raise exception 'Only admins, managers and technicians can import';
  end if;
  perform set_config('it.action', 'imported', true);
  begin
    for r in select * from jsonb_array_elements(p_rows) loop
      v_loc := null; v_sup := null; v_cat := null; v_id := null;
      begin
        if nullif(btrim(r ->> 'name'), '') is null then raise exception 'Every subscription needs a name'; end if;
        if nullif(btrim(r ->> 'site'), '') is not null then
          v_loc := it_find_site(r ->> 'site');
          if v_loc is null then raise exception 'Site "%" not found', r ->> 'site'; end if;
        end if;
        -- No site means every site, which only an admin can add (as in RLS).
        if not it_can_write(v_loc) then
          raise exception '%', case when v_loc is null then 'Only an admin can add a subscription for every site'
                                    else 'You don''t manage that site' end;
        end if;
        t := nullif(btrim(r ->> 'provider'), '');
        if t is not null then
          select id into v_sup from public.it_suppliers where account_id = acct and lower(name) = lower(t) and deleted_at is null;
          if v_sup is null then
            if not coalesce((p_create ->> 'suppliers')::boolean, false) then
              raise exception 'Provider "%" is new (allow creating suppliers)', t;
            end if;
            insert into public.it_suppliers (account_id, name) values (acct, t) returning id into v_sup;
          end if;
        end if;
        t := nullif(btrim(r ->> 'category'), '');
        if t is not null then
          select id into v_cat from public.it_categories
           where account_id = acct and lower(name) = lower(t) and deleted_at is null and kind = 'subscription';
          if v_cat is null then
            if not (coalesce((p_create ->> 'categories')::boolean, false) and it_is_admin()) then
              raise exception 'Subscription category "%" doesn''t exist', t;
            end if;
            insert into public.it_categories (account_id, name, kind, icon) values (acct, t, 'subscription', 'key') returning id into v_cat;
          end if;
        end if;
        t := lower(coalesce(nullif(btrim(r ->> 'billing_cycle'), ''), 'monthly'));
        v_cycle := case
          when t in ('monthly', 'month', 'mo', 'per month') then 'monthly'
          when t in ('quarterly', 'quarter', 'qtr') then 'quarterly'
          when t in ('annual', 'annually', 'yearly', 'year', 'yr') then 'annual'
          when t = 'other' then 'other'
        end;
        if v_cycle is null then raise exception 'Billing cycle "%" should be monthly, quarterly, annual or other', r ->> 'billing_cycle'; end if;
        t := lower(nullif(btrim(r ->> 'auto_renew'), ''));
        v_auto := case when t is null then null when t in ('yes', 'y', 'true', '1') then true when t in ('no', 'n', 'false', '0') then false end;
        if t is not null and v_auto is null then raise exception 'Auto renew "%" should be yes or no', r ->> 'auto_renew'; end if;

        if nullif(btrim(r ->> 'account_number'), '') is not null then
          select id into v_id from public.it_subscriptions
           where account_id = acct and deleted_at is null and account_number = btrim(r ->> 'account_number');
        end if;
        if v_id is null then
          select id into v_id from public.it_subscriptions
           where account_id = acct and deleted_at is null and lower(name) = lower(btrim(r ->> 'name'))
             and location_id is not distinct from v_loc;
        end if;

        if v_id is not null and not it_can_write((select location_id from public.it_subscriptions where id = v_id)) then
          raise exception 'That subscription is at a site you don''t manage';
        end if;
        if v_id is not null then
          update public.it_subscriptions set
            name               = btrim(r ->> 'name'),
            location_id        = v_loc,
            supplier_id        = coalesce(v_sup, supplier_id),
            category_id        = coalesce(v_cat, category_id),
            account_number     = coalesce(nullif(btrim(r ->> 'account_number'), ''), account_number),
            seats              = coalesce(it_num(r ->> 'seats')::integer, seats),
            cost               = coalesce(it_num(r ->> 'cost'), cost),
            billing_cycle      = v_cycle,
            start_date         = coalesce(nullif(btrim(r ->> 'start_date'), '')::date, start_date),
            renewal_date       = coalesce(nullif(btrim(r ->> 'renewal_date'), '')::date, renewal_date),
            auto_renew         = coalesce(v_auto, auto_renew),
            cancel_notice_days = coalesce(it_num(r ->> 'cancel_notice_days')::integer, cancel_notice_days),
            notes              = coalesce(nullif(btrim(r ->> 'notes'), ''), notes)
           where id = v_id;
          v_act := 'update';
        else
          insert into public.it_subscriptions (account_id, location_id, name, supplier_id, category_id, account_number,
            seats, cost, billing_cycle, start_date, renewal_date, auto_renew, cancel_notice_days, notes)
          values (acct, v_loc, btrim(r ->> 'name'), v_sup, v_cat, nullif(btrim(r ->> 'account_number'), ''),
            it_num(r ->> 'seats')::integer, it_num(r ->> 'cost'), v_cycle,
            nullif(btrim(r ->> 'start_date'), '')::date, nullif(btrim(r ->> 'renewal_date'), '')::date,
            coalesce(v_auto, true), it_num(r ->> 'cancel_notice_days')::integer, nullif(btrim(r ->> 'notes'), ''))
          returning id into v_id;
          v_act := 'create';
        end if;
        out := out || jsonb_build_object('row', r -> 'row', 'action', v_act, 'id', v_id);
      exception when others then
        out := out || jsonb_build_object('row', r -> 'row', 'action', 'error', 'error', sqlerrm);
      end;
    end loop;
    if not p_commit then raise exception 'it_dry_run'; end if;
  exception when raise_exception then
    if sqlerrm <> 'it_dry_run' then raise; end if;
  end;
  return out;
end $$;

revoke execute on function public.it_search(text, integer), public.it_find_site(text), public.it_log_import(jsonb),
  public.it_import_assets(jsonb, boolean, jsonb), public.it_import_models(jsonb, boolean, jsonb),
  public.it_import_subscriptions(jsonb, boolean, jsonb) from public, anon;
grant execute on function public.it_search(text, integer), public.it_find_site(text), public.it_log_import(jsonb),
  public.it_import_assets(jsonb, boolean, jsonb), public.it_import_models(jsonb, boolean, jsonb),
  public.it_import_subscriptions(jsonb, boolean, jsonb) to authenticated, service_role;
