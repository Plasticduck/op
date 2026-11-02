-- IT Inventory: picking "Other" on Add equipment asks what the item is. What's
-- typed becomes a category of its own, or finds the one already by that name, so
-- the item lists, filters and prints under that name and it's in the dropdown next
-- time. Categories are otherwise admin-only; this is the one way other staff can
-- add one, because anyone who can add equipment has to be able to use Other.

create or replace function public.it_category_from_other(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  acct  uuid := auth_account_id();
  v     text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  hit   public.it_categories%rowtype;
  other public.it_categories%rowtype;
  v_id  uuid;
begin
  if acct is null or coalesce(auth_role(), '') not in ('owner', 'manager', 'technician') then
    raise exception 'You don''t have access to do that.' using errcode = '42501';
  end if;
  if v = '' then
    raise exception 'Type what it is.';
  end if;
  if lower(v) = 'other' then
    raise exception 'Type what it actually is, like Laptop.';
  end if;
  if length(v) > 60 then
    raise exception 'Keep it under 60 characters.';
  end if;

  -- Names are unique across every kind of category, not just equipment.
  select * into hit from public.it_categories
   where account_id = acct and lower(name) = lower(v) and deleted_at is null;
  if found then
    if hit.kind = 'asset' then
      return hit.id;
    end if;
    raise exception '"%" is already a category for %. Call this something else.', hit.name,
      case hit.kind when 'accessory' then 'accessories' when 'consumable' then 'supplies' else 'subscriptions' end;
  end if;

  -- It prints and audits like Other, and sits just above Other in the list.
  select * into other from public.it_categories
   where account_id = acct and kind = 'asset' and lower(name) = 'other' and deleted_at is null;
  insert into public.it_categories (account_id, name, kind, icon, label_template_id, audit_interval_months, sort_order)
  values (acct, case when v = lower(v) then upper(left(v, 1)) || substr(v, 2) else v end, 'asset',
          coalesce(other.icon, 'package'), other.label_template_id, other.audit_interval_months,
          coalesce(other.sort_order, 200) - 1)
  on conflict (account_id, lower(name)) where deleted_at is null do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.it_categories
     where account_id = acct and lower(name) = lower(v) and deleted_at is null;
  end if;
  return v_id;
end $$;

revoke execute on function public.it_category_from_other(text) from public, anon;
grant execute on function public.it_category_from_other(text) to authenticated, service_role;
