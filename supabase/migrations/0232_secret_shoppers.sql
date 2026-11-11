-- 0232_secret_shoppers.sql
-- Secret Shoppers: people who visit a site unannounced, buy a wash and rate
-- the visit. A shopper signs in to the Secret Shoppers page with a PIN (the
-- page itself is limited to named people while it's tested), fills in a 1-5
-- star report with photos and videos, and the report is emailed to leadership.
--
-- Everything goes through the secret-shopper edge function (service role),
-- which checks the shopper's PIN, or the admin email list for managing
-- shoppers. So these tables have RLS on and no client policies, and the PIN
-- helpers below are service-role only.

create table public.secret_shoppers (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 100),
  phone           text,
  email           text,
  pin_hash        text not null,           -- bcrypt, like the kiosk PINs (never plaintext)
  active          boolean not null default true,
  last_sign_in_at timestamptz,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index secret_shoppers_account_idx on public.secret_shoppers (account_id);

-- One report per visit. `ratings` is [{ key, label, stars, comment }] in form
-- order; `overall_rating` is the Overall experience stars, kept as a column for
-- sorting. A report sits in 'uploading' while its photos and videos go up,
-- then becomes 'submitted' and is emailed.
create table public.secret_shopper_visits (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  location_id    uuid not null references public.locations(id) on delete restrict,
  shopper_id     uuid not null references public.secret_shoppers(id) on delete restrict,
  shopper_name   text not null,
  submitted_by   uuid references public.users(id) on delete set null, -- the Operator login the page was open on
  visited_at     timestamptz not null,
  wash_package   text,
  team_members   text,
  ratings        jsonb not null,
  overall_rating smallint not null check (overall_rating between 1 and 5),
  comments       text not null,
  media          jsonb not null default '[]'::jsonb,                  -- [{ path, kind, name, size }]
  status         text not null default 'uploading' check (status in ('uploading', 'submitted')),
  submitted_at   timestamptz,
  emailed_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index secret_shopper_visits_account_idx on public.secret_shopper_visits (account_id, created_at desc);
create index secret_shopper_visits_shopper_idx on public.secret_shopper_visits (shopper_id, created_at desc);

-- Wrong PINs per Operator login, so the PIN box can't be guessed through
-- (the function allows a handful per 15 minutes).
create table public.secret_shopper_bad_pins (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  created_at timestamptz not null default now()
);
create index secret_shopper_bad_pins_user_idx on public.secret_shopper_bad_pins (user_id, created_at desc);

alter table public.secret_shoppers enable row level security;
alter table public.secret_shopper_visits enable row level security;
alter table public.secret_shopper_bad_pins enable row level security;

-- ---- PIN helpers (service role only) ---------------------------------------

create or replace function public.secret_shopper_hash_pin(p_pin text)
returns text language plpgsql security definer
set search_path = public, extensions as $$
begin
  if p_pin !~ '^\d{4,8}$' then raise exception 'PIN must be 4 to 8 digits'; end if;
  return crypt(p_pin, gen_salt('bf'));
end $$;

-- The active shopper in this account whose PIN this is, or null.
create or replace function public.secret_shopper_match_pin(p_account_id uuid, p_pin text)
returns uuid language sql stable security definer
set search_path = public, extensions as $$
  select s.id
    from public.secret_shoppers s
   where s.account_id = p_account_id
     and s.active
     and p_pin ~ '^\d{4,8}$'
     and s.pin_hash = crypt(p_pin, s.pin_hash)
   limit 1
$$;

-- PINs identify the shopper, so they're unique within an account (inactive
-- shoppers included, so turning one back on can't clash).
create or replace function public.secret_shopper_pin_taken(p_account_id uuid, p_pin text, p_except uuid default null)
returns boolean language sql stable security definer
set search_path = public, extensions as $$
  select exists (
    select 1
      from public.secret_shoppers s
     where s.account_id = p_account_id
       and (p_except is null or s.id <> p_except)
       and s.pin_hash = crypt(p_pin, s.pin_hash)
  )
$$;

revoke execute on function public.secret_shopper_hash_pin(text) from public, anon, authenticated;
revoke execute on function public.secret_shopper_match_pin(uuid, text) from public, anon, authenticated;
revoke execute on function public.secret_shopper_pin_taken(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.secret_shopper_hash_pin(text) to service_role;
grant execute on function public.secret_shopper_match_pin(uuid, text) to service_role;
grant execute on function public.secret_shopper_pin_taken(uuid, text, uuid) to service_role;

-- ---- Photos and videos ------------------------------------------------------
-- <account_id>/<visit_id>/<uuid>.<ext>. 50 MB per file (the project's upload
-- limit). No storage policies: the edge function hands out signed upload URLs
-- once the PIN checks out, and signed read URLs for the email.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('secret-shopper-media', 'secret-shopper-media', false, 52428800, array['image/*', 'video/*'])
on conflict (id) do nothing;
