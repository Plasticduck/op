-- 0001_core.sql — accounts, locations, users, invitations + RLS helpers
-- Foundation tables shared by every module. Run first.

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- accounts: top-level tenant. One per car wash company.
-- ---------------------------------------------------------------------------
create table public.accounts (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  account_type        text not null default 'carwash',
  plan                text,                    -- 'single' | 'multi' | null (trial)
  stripe_customer_id  text,
  is_demo             boolean not null default false,
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- locations: physical sites. Belong to an account. Carry per-site op settings.
-- ---------------------------------------------------------------------------
create table public.locations (
  id                       uuid primary key default gen_random_uuid(),
  account_id               uuid not null references public.accounts(id) on delete cascade,
  name                     text not null,
  address                  text,
  timezone                 text not null default 'America/New_York',
  closeout_time            time not null default '21:00',
  overtime_threshold_hours numeric not null default 40,
  pay_period_type          text not null default 'biweekly', -- 'weekly'|'biweekly'|'semimonthly'
  downtime_alert_hours     numeric not null default 4,
  archived                 boolean not null default false,
  created_at               timestamptz not null default now()
);
create index on public.locations (account_id);

-- ---------------------------------------------------------------------------
-- users: app profile, 1:1 with auth.users. Holds role + location scoping.
-- ---------------------------------------------------------------------------
create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  account_id    uuid not null references public.accounts(id) on delete cascade,
  location_ids  uuid[] not null default '{}',
  role          text not null check (role in ('owner','manager','employee')),
  name          text not null,
  email         text not null,
  avatar_url    text,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index on public.users (account_id);

-- ---------------------------------------------------------------------------
-- invitations: tokenized team invites. 72h expiry enforced at app layer + here.
-- ---------------------------------------------------------------------------
create table public.invitations (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  invited_by    uuid references public.users(id) on delete set null,
  email         text not null,
  role          text not null check (role in ('manager','employee')),
  location_ids  uuid[] not null default '{}',
  token         uuid not null unique default gen_random_uuid(),
  status        text not null default 'pending' check (status in ('pending','accepted','expired')),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '72 hours')
);
create index on public.invitations (account_id);
create index on public.invitations (token);

-- ---------------------------------------------------------------------------
-- RLS helper functions. SECURITY DEFINER so policies can read `users` without
-- recursing into users' own RLS. STABLE — evaluated once per statement.
-- ---------------------------------------------------------------------------
create or replace function public.auth_account_id()
returns uuid language sql stable security definer set search_path = public as $$
  select account_id from public.users where id = auth.uid()
$$;

create or replace function public.auth_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid()
$$;

-- True if the current user can act on `loc`. Owners see all locations in their
-- account; managers/employees only their assigned ones.
create or replace function public.auth_has_location(loc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and (
        u.role = 'owner'
        and exists (select 1 from public.locations l where l.id = loc and l.account_id = u.account_id)
        or loc = any(u.location_ids)
      )
  )
$$;

create or replace function public.auth_is_manager_plus()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.users where id = auth.uid()) in ('owner','manager'), false)
$$;
