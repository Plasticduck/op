-- Past weather forecasts, as they were issued (Kevan, 2026-11-18): what the
-- forecast thought a day would be, 0 to 10 days ahead, next to what happened.
--
-- weather_days keeps one row per site per day and the daily sync overwrites it
-- (a forecast until the day passes, then the actual), so no forecast survived.
-- These come from the National Weather Service's National Blend of Models (NBM),
-- the basis of its official forecasts, archived by the Iowa Environmental
-- Mesonet (free; government data). NBM text forecasts are per airport weather
-- station, so each site is matched to its nearest station that has them.
--
--  * weather_forecast_stations: each site's station (ICAO, e.g. KLBB) and how
--    far away it is. Filled by the sync-weather-forecasts function.
--  * weather_forecasts: one row per station, per morning's forecast (the 12Z run,
--    about 6-7am Central, or the closest run that morning), per day forecast.
--    Day 0 (the same day) is from the short-range blend (NBS), days 1-10 from
--    the extended blend (NBE). Daytime is 12Z-00Z (about 7am-7pm Central),
--    overnight is the 00Z-12Z before it.
--  * weather_forecast_vs_actual: per site, each forecast next to that day's
--    weather_days (Open-Meteo at the site itself, so small differences from the
--    airport are expected).

create table if not exists public.weather_forecast_stations (
  location_id  uuid primary key references public.locations(id) on delete cascade,
  account_id   uuid not null references public.accounts(id) on delete cascade,
  station      text not null,
  station_name text,
  distance_mi  numeric(6, 1),
  assigned_at  timestamptz not null default now()
);
create index if not exists weather_forecast_stations_station_idx on public.weather_forecast_stations (station);

create table if not exists public.weather_forecasts (
  station             text not null,
  issued_at           timestamptz not null,
  forecast_date       date not null,
  issued_date         date not null,
  lead_days           int not null,
  model               text not null check (model in ('NBS', 'NBE')),
  temp_max            int,           -- °F, daytime high
  temp_min            int,           -- °F, overnight low ending that morning (none on day 0)
  precip_chance       int,           -- % chance of precipitation, daytime
  precip_chance_night int,           -- % chance, the overnight before
  precip_in           numeric(5, 2), -- forecast amount, daytime (inches, liquid)
  precip_in_night     numeric(5, 2), -- forecast amount, the overnight before
  created_at          timestamptz not null default now(),
  -- One forecast per station per morning: a later fetch of the same morning
  -- replaces it rather than adding a second.
  primary key (station, issued_date, forecast_date)
);
create index if not exists weather_forecasts_day_idx on public.weather_forecasts (station, forecast_date, lead_days);

alter table public.weather_forecast_stations enable row level security;
alter table public.weather_forecasts enable row level security;

-- Stations follow the site's account. Forecasts are public data per station,
-- readable by anyone signed in. Only the service role writes either.
drop policy if exists weather_forecast_stations_select on public.weather_forecast_stations;
create policy weather_forecast_stations_select on public.weather_forecast_stations for select
  using (account_id = public.auth_account_id() and public.auth_has_location(location_id));

drop policy if exists weather_forecasts_select on public.weather_forecasts;
create policy weather_forecasts_select on public.weather_forecasts for select
  to authenticated using (true);

create or replace view public.weather_forecast_vs_actual
with (security_invoker = true) as
select
  s.account_id,
  s.location_id,
  l.name as location_name,
  s.station,
  f.forecast_date,
  f.issued_date,
  f.lead_days,
  f.temp_max as forecast_high,
  w.temp_max as actual_high,
  f.temp_min as forecast_low,
  w.temp_min as actual_low,
  f.precip_chance,
  f.precip_chance_night,
  f.precip_in as forecast_precip_in,
  f.precip_in_night as forecast_precip_in_night,
  w.precip_in as actual_precip_in,
  w.conditions as actual_conditions
from public.weather_forecast_stations s
join public.locations l on l.id = s.location_id
join public.weather_forecasts f on f.station = s.station
left join public.weather_days w on w.location_id = s.location_id and w.date = f.forecast_date;

grant select on public.weather_forecast_vs_actual to authenticated;
