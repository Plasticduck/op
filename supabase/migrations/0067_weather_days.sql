-- Daily weather archive, one row per site per day. Populated by the sync-weather
-- edge function from Open-Meteo (keyless) and accumulated over time so a day's
-- results can be explained against its weather long after Open-Meteo's ~90-day
-- history window has rolled off. Operator AI reads this table (via run_sql) and
-- correlates it with the live car-count feed to answer "why was X day low?".
create table if not exists public.weather_days (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  date        date not null,
  weather_code int,
  conditions  text,          -- human label: Clear, Rain, Snow, Storm, ...
  temp_max    numeric,       -- fahrenheit
  temp_min    numeric,
  precip_in   numeric,       -- inches of precipitation that day
  source      text not null default 'open-meteo',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (location_id, date)
);
create index if not exists weather_days_loc_date_idx
  on public.weather_days (location_id, date desc);
create index if not exists weather_days_acct_date_idx
  on public.weather_days (account_id, date desc);

alter table public.weather_days enable row level security;

-- Read-only for the account's members who can see the site. Writes come only from
-- the service-role sync job (which bypasses RLS), so there are no write policies.
create policy weather_days_select on public.weather_days
  for select using (account_id = auth_account_id() and auth_has_location(location_id));
