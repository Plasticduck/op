-- 0234_secret_shopper_signup.sql
-- Secret Shopper app (/ss), two changes from Kevan (2026-11-12):
--   * PINs are 4 to 6 digits (0233 made them 6 to 8). PINs already set at 7 or
--     8 digits keep signing in.
--   * Shoppers can create their own PIN from the app ("Create a PIN"), not
--     only get one from an admin. Those rows are marked self_signup, with the
--     IP they came from so the secret-shopper function can cap sign-ups per
--     address.

alter table public.secret_shoppers
  add column self_signup boolean not null default false,
  add column signup_ip   text;
create index secret_shoppers_signup_idx on public.secret_shoppers (signup_ip, created_at desc) where self_signup;

create or replace function public.secret_shopper_hash_pin(p_pin text)
returns text language plpgsql security definer
set search_path = public, extensions as $$
begin
  if p_pin !~ '^\d{4,6}$' then raise exception 'PIN must be 4 to 6 digits'; end if;
  return crypt(p_pin, gen_salt('bf'));
end $$;

-- The active shopper, in any account, whose PIN this is; or null. Accepts 4 to
-- 8 digits so PINs set while 0233's 6-8 rule stood still work.
create or replace function public.secret_shopper_find_by_pin(p_pin text)
returns uuid language sql stable security definer
set search_path = public, extensions as $$
  select s.id
    from public.secret_shoppers s
   where s.active
     and p_pin ~ '^\d{4,8}$'
     and s.pin_hash = crypt(p_pin, s.pin_hash)
   limit 1
$$;
