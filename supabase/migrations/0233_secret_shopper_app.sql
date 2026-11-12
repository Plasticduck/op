-- 0233_secret_shopper_app.sql
-- Secret Shoppers move to their own phone app (/shop) with no Operator login:
-- the PIN alone says who the shopper is and which company they report to.
-- So, on top of 0232:
--   * PINs are unique across every account, not just within one.
--   * New PINs are 6 to 8 digits (was 4 to 8), and only 6-8 digit PINs sign in,
--     since anyone with the link can now try one.
--   * Wrong PINs are logged by IP address (the secret-shopper function caps them
--     per address and overall) instead of by Operator login.
-- Everything still goes through the secret-shopper function (service role).

-- ---- Wrong-PIN log: by IP address now -----------------------------------------
delete from public.secret_shopper_bad_pins;
alter table public.secret_shopper_bad_pins drop column user_id;
alter table public.secret_shopper_bad_pins add column ip text not null default '';
create index secret_shopper_bad_pins_ip_idx on public.secret_shopper_bad_pins (ip, created_at desc);
create index secret_shopper_bad_pins_created_idx on public.secret_shopper_bad_pins (created_at desc);

comment on column public.secret_shopper_visits.submitted_by is
  'Operator login that submitted the report, if any. Null for reports from the /shop phone app, which has no Operator login.';

-- ---- PIN helpers (service role only) ---------------------------------------

create or replace function public.secret_shopper_hash_pin(p_pin text)
returns text language plpgsql security definer
set search_path = public, extensions as $$
begin
  if p_pin !~ '^\d{6,8}$' then raise exception 'PIN must be 6 to 8 digits'; end if;
  return crypt(p_pin, gen_salt('bf'));
end $$;

-- The active shopper, in any account, whose PIN this is; or null.
create or replace function public.secret_shopper_find_by_pin(p_pin text)
returns uuid language sql stable security definer
set search_path = public, extensions as $$
  select s.id
    from public.secret_shoppers s
   where s.active
     and p_pin ~ '^\d{6,8}$'
     and s.pin_hash = crypt(p_pin, s.pin_hash)
   limit 1
$$;

-- PINs identify the shopper on their own, so they're unique everywhere
-- (inactive shoppers included, so turning one back on can't clash).
create or replace function public.secret_shopper_pin_in_use(p_pin text, p_except uuid default null)
returns boolean language sql stable security definer
set search_path = public, extensions as $$
  select exists (
    select 1
      from public.secret_shoppers s
     where (p_except is null or s.id <> p_except)
       and s.pin_hash = crypt(p_pin, s.pin_hash)
  )
$$;

revoke execute on function public.secret_shopper_find_by_pin(text) from public, anon, authenticated;
revoke execute on function public.secret_shopper_pin_in_use(text, uuid) from public, anon, authenticated;
grant execute on function public.secret_shopper_find_by_pin(text) to service_role;
grant execute on function public.secret_shopper_pin_in_use(text, uuid) to service_role;

-- The per-account versions from 0232 are replaced by the two above.
drop function public.secret_shopper_match_pin(uuid, text);
drop function public.secret_shopper_pin_taken(uuid, text, uuid);
