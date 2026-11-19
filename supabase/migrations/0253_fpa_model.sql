-- FP&A Model (Kevan, 2026-11-19): Mighty Wash's FP&A workbook (QuickBooks P&L
-- by site and month, budget vs actual, KPIs, forecast) kept in Operator so its
-- numbers can be read on the Finance > FP&A Model page and through Operator AI.
--
-- Who sees what:
--  * The data: only the people in fpa_readers (by email, so a login made later
--    is covered as soon as it exists). Operator AI's SQL runs as the person
--    asking, so these policies are what keep it to that list.
--  * Loading a new version: only the super admin (kevan@washlyfe.com), through
--    fpa_begin / fpa_load / fpa_activate. The page is Kevan's alone too.
--
-- A workbook is loaded as a version: rows go in while it's 'loading', then
-- fpa_activate makes it 'current' and deletes the version it replaces, so a
-- failed load never leaves a half-made model behind. Values are the workbook's
-- own calculated results (its Calc engine, forecast engine and Budget vs Actual
-- tab), so they match the file exactly; the QuickBooks lines are kept too, for
-- drilling into GL accounts. The fpa_current_* views show the current version.

create table if not exists public.fpa_versions (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  label             text not null,
  file_name         text,
  last_closed_month date,
  info              jsonb not null default '{}'::jsonb,
  status            text not null default 'loading' check (status in ('loading', 'current')),
  row_counts        jsonb,
  loaded_by         uuid references public.users(id) on delete set null,
  loaded_by_name    text,
  loaded_at         timestamptz not null default now(),
  activated_at      timestamptz
);
create unique index if not exists fpa_versions_one_current on public.fpa_versions (account_id) where status = 'current';

create table if not exists public.fpa_readers (
  account_id uuid not null references public.accounts(id) on delete cascade,
  email      text not null check (email = lower(btrim(email))),
  added_at   timestamptz not null default now(),
  primary key (account_id, email)
);

insert into public.fpa_readers (account_id, email)
select '54f3e299-1f61-4ed2-9921-3d02160b72e6', e
from unnest(array[
  'kspiller@mighty-wash.com', 'kellyspiller@mighty-wash.com', 'kevan@washlyfe.com',
  'jjowers@mighty-wash.com', 'arodriguez@mighty-wash.com', 'ssspore@mighty-wash.com'
]) e
where exists (select 1 from public.accounts where id = '54f3e299-1f61-4ed2-9921-3d02160b72e6')
on conflict do nothing;

-- On the list for their own account.
create or replace function public.fpa_can_read() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users u
    join public.fpa_readers r on r.account_id = u.account_id and r.email = lower(u.email)
    where u.id = auth.uid()
  )
$$;
revoke all on function public.fpa_can_read() from public, anon;
grant execute on function public.fpa_can_read() to authenticated;

create table if not exists public.fpa_entities (
  version_id   uuid not null references public.fpa_versions(id) on delete cascade,
  key          text not null,
  label        text not null,
  kind         text not null check (kind in ('group', 'site', 'other')),
  filter_field text,
  filter_value text,
  sort         int not null default 0,
  primary key (version_id, key)
);

create table if not exists public.fpa_sites (
  version_id     uuid not null references public.fpa_versions(id) on delete cascade,
  key            text not null,
  site_number    int,
  name           text,
  region         text,
  segment        text,
  price_tier     text,
  format         text,
  status         text,
  open_date      date,
  closed_from    date,
  reopen_date    date,
  interior_start date,
  same_store     boolean,
  in_forecast    boolean,
  notes          text,
  sort           int not null default 0,
  primary key (version_id, key)
);

-- The Calc engine: every entity (site, region, segment, group) x line or KPI x month.
create table if not exists public.fpa_metric_values (
  version_id uuid not null references public.fpa_versions(id) on delete cascade,
  entity_key text not null,
  metric     text not null,
  month      date not null,
  value      numeric not null,
  primary key (version_id, entity_key, metric, month)
);
create index if not exists fpa_metric_values_metric_idx on public.fpa_metric_values (version_id, metric, month);

-- QuickBooks P&L lines (Data_PL), one per month x class x account.
create table if not exists public.fpa_pl_lines (
  version_id    uuid not null references public.fpa_versions(id) on delete cascade,
  line_no       int not null,
  month         date not null,
  qb_class      text,
  site_key      text,
  account       text,
  gl            text,
  amount        numeric not null,
  kpi_group     text,
  dashboard_row text,
  region        text,
  segment       text,
  same_store    boolean,
  qb_type       text,
  primary key (version_id, line_no)
);
create index if not exists fpa_pl_lines_group_idx on public.fpa_pl_lines (version_id, kpi_group, month);

create table if not exists public.fpa_coa_map (
  version_id     uuid not null references public.fpa_versions(id) on delete cascade,
  account        text not null,
  gl             text,
  qb_type        text,
  kpi_group      text,
  dashboard_row  text,
  ebitda_addback text,
  primary key (version_id, account)
);

-- Budget vs Actual by location for the budget period (key 'TOTAL' = the company).
create table if not exists public.fpa_budget_ytd (
  version_id        uuid not null references public.fpa_versions(id) on delete cascade,
  key               text not null,
  location          text,
  region            text,
  landlord          text,
  in_budget         boolean,
  revenue_actual    numeric,
  revenue_budget    numeric,
  ebitda_actual     numeric,
  ebitda_budget     numeric,
  adj_ebitda_actual numeric,
  adj_ebitda_budget numeric,
  sort              int not null default 0,
  primary key (version_id, key)
);

-- The forecast engine (FC_Calc): per site x metric x future month, with the
-- site's region / segment / same-store flag so it rolls up like the workbook.
create table if not exists public.fpa_forecast_values (
  version_id uuid not null references public.fpa_versions(id) on delete cascade,
  entity_key text not null,
  region     text,
  segment    text,
  same_store boolean,
  metric     text not null,
  month      date not null,
  value      numeric not null,
  primary key (version_id, entity_key, metric, month)
);

alter table public.fpa_versions enable row level security;
alter table public.fpa_readers enable row level security;
alter table public.fpa_entities enable row level security;
alter table public.fpa_sites enable row level security;
alter table public.fpa_metric_values enable row level security;
alter table public.fpa_pl_lines enable row level security;
alter table public.fpa_coa_map enable row level security;
alter table public.fpa_budget_ytd enable row level security;
alter table public.fpa_forecast_values enable row level security;

drop policy if exists fpa_versions_select on public.fpa_versions;
create policy fpa_versions_select on public.fpa_versions for select
  using (account_id = public.auth_account_id() and public.fpa_can_read());
drop policy if exists fpa_readers_select on public.fpa_readers;
create policy fpa_readers_select on public.fpa_readers for select
  using (account_id = public.auth_account_id() and public.auth_is_super_admin());

do $$
declare t text;
begin
  foreach t in array array['fpa_entities', 'fpa_sites', 'fpa_metric_values', 'fpa_pl_lines', 'fpa_coa_map', 'fpa_budget_ytd', 'fpa_forecast_values'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format(
      'create policy %1$s_select on public.%1$s for select using (public.fpa_can_read() and exists (select 1 from public.fpa_versions v where v.id = version_id and v.account_id = public.auth_account_id()))',
      t);
  end loop;
end $$;

-- The current version only, for the page and Operator AI.
create or replace view public.fpa_current_version with (security_invoker = true) as
  select id, label, file_name, last_closed_month, info, row_counts, loaded_by_name, loaded_at, activated_at
  from public.fpa_versions where status = 'current';
create or replace view public.fpa_current_entities with (security_invoker = true) as
  select e.key, e.label, e.kind, e.filter_field, e.filter_value, e.sort
  from public.fpa_entities e join public.fpa_versions v on v.id = e.version_id and v.status = 'current';
create or replace view public.fpa_current_sites with (security_invoker = true) as
  select s.key, s.site_number, s.name, s.region, s.segment, s.price_tier, s.format, s.status, s.open_date,
         s.closed_from, s.reopen_date, s.interior_start, s.same_store, s.in_forecast, s.notes, s.sort
  from public.fpa_sites s join public.fpa_versions v on v.id = s.version_id and v.status = 'current';
create or replace view public.fpa_current_metrics with (security_invoker = true) as
  select m.entity_key, e.label as entity_label, m.metric, m.month, m.value
  from public.fpa_metric_values m
  join public.fpa_versions v on v.id = m.version_id and v.status = 'current'
  left join public.fpa_entities e on e.version_id = m.version_id and e.key = m.entity_key;
create or replace view public.fpa_current_pl_lines with (security_invoker = true) as
  select p.month, p.qb_class, p.site_key, p.account, p.gl, p.amount, p.kpi_group, p.dashboard_row, p.region, p.segment, p.same_store, p.qb_type
  from public.fpa_pl_lines p join public.fpa_versions v on v.id = p.version_id and v.status = 'current';
create or replace view public.fpa_current_coa_map with (security_invoker = true) as
  select c.account, c.gl, c.qb_type, c.kpi_group, c.dashboard_row, c.ebitda_addback
  from public.fpa_coa_map c join public.fpa_versions v on v.id = c.version_id and v.status = 'current';
create or replace view public.fpa_current_budget_ytd with (security_invoker = true) as
  select b.key, b.location, b.region, b.landlord, b.in_budget, b.revenue_actual, b.revenue_budget, b.ebitda_actual, b.ebitda_budget,
         b.adj_ebitda_actual, b.adj_ebitda_budget, b.sort
  from public.fpa_budget_ytd b join public.fpa_versions v on v.id = b.version_id and v.status = 'current';
create or replace view public.fpa_current_forecast with (security_invoker = true) as
  select f.entity_key, f.region, f.segment, f.same_store, f.metric, f.month, f.value
  from public.fpa_forecast_values f join public.fpa_versions v on v.id = f.version_id and v.status = 'current';

grant select on public.fpa_current_version, public.fpa_current_entities, public.fpa_current_sites, public.fpa_current_metrics,
  public.fpa_current_pl_lines, public.fpa_current_coa_map, public.fpa_current_budget_ytd, public.fpa_current_forecast to authenticated;

-- Loading: the super admin from the page, or a direct database session with
-- nobody signed in (the first load, run by hand). The app's sessions connect as
-- `authenticator`, so they only ever get the first.
create or replace function public.fpa_may_load() returns boolean
language sql stable security definer set search_path = public as $$
  select public.auth_is_super_admin()
      or (auth.uid() is null and session_user in ('postgres', 'supabase_admin'))
$$;
revoke all on function public.fpa_may_load() from public, anon, authenticated;

create or replace function public.fpa_begin(p_account uuid, p_label text, p_file_name text, p_last_closed date, p_info jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; acct uuid; me public.users;
begin
  if not public.fpa_may_load() then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into me from public.users where id = auth.uid();
  acct := coalesce(me.account_id, p_account);
  if acct is null or (me.id is not null and p_account is distinct from me.account_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if coalesce(btrim(p_label), '') = '' then raise exception 'label_required' using errcode = 'P0001'; end if;
  -- An abandoned load (closed tab) is cleared when the next one starts.
  delete from public.fpa_versions where account_id = acct and status = 'loading';
  insert into public.fpa_versions (account_id, label, file_name, last_closed_month, info, loaded_by, loaded_by_name)
  values (acct, btrim(p_label), p_file_name, p_last_closed, coalesce(p_info, '{}'::jsonb), me.id, me.name)
  returning id into v;
  return v;
end $$;
revoke all on function public.fpa_begin(uuid, text, text, date, jsonb) from public, anon;
grant execute on function public.fpa_begin(uuid, text, text, date, jsonb) to authenticated;

-- One batch of rows (up to 5000) of one kind into a version that's loading.
create or replace function public.fpa_load(p_version uuid, p_kind text, p_rows jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare n int; vrec public.fpa_versions;
begin
  if not public.fpa_may_load() then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into vrec from public.fpa_versions where id = p_version;
  if not found or vrec.status <> 'loading' then raise exception 'not_loading' using errcode = 'P0001'; end if;
  if auth.uid() is not null and vrec.account_id is distinct from public.auth_account_id() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then raise exception 'bad_batch' using errcode = 'P0001'; end if;

  case p_kind
    when 'entities' then
      insert into public.fpa_entities (version_id, key, label, kind, filter_field, filter_value, sort)
      select p_version, x.key, x.label, x.kind, x.filter_field, x.filter_value, coalesce(x.sort, 0)
      from jsonb_to_recordset(p_rows) as x(key text, label text, kind text, filter_field text, filter_value text, sort int);
    when 'sites' then
      insert into public.fpa_sites (version_id, key, site_number, name, region, segment, price_tier, format, status, open_date, closed_from, reopen_date, interior_start, same_store, in_forecast, notes, sort)
      select p_version, x.key, x.site_number, x.name, x.region, x.segment, x.price_tier, x.format, x.status, x.open_date, x.closed_from, x.reopen_date, x.interior_start, x.same_store, x.in_forecast, x.notes, coalesce(x.sort, 0)
      from jsonb_to_recordset(p_rows) as x(key text, site_number int, name text, region text, segment text, price_tier text, format text, status text, open_date date, closed_from date, reopen_date date, interior_start date, same_store boolean, in_forecast boolean, notes text, sort int);
    when 'metrics' then
      insert into public.fpa_metric_values (version_id, entity_key, metric, month, value)
      select p_version, x.e, x.m, x.d, x.v from jsonb_to_recordset(p_rows) as x(e text, m text, d date, v numeric);
    when 'pl' then
      insert into public.fpa_pl_lines (version_id, line_no, month, qb_class, site_key, account, gl, amount, kpi_group, dashboard_row, region, segment, same_store, qb_type)
      select p_version, x.n, x.d, x.c, x.k, x.a, x.gl, x.v, x.g, x.r, x.reg, x.seg, x.ss, x.t
      from jsonb_to_recordset(p_rows) as x(n int, d date, c text, k text, a text, gl text, v numeric, g text, r text, reg text, seg text, ss boolean, t text);
    when 'coa' then
      insert into public.fpa_coa_map (version_id, account, gl, qb_type, kpi_group, dashboard_row, ebitda_addback)
      select p_version, x.account, x.gl, x.qb_type, x.kpi_group, x.dashboard_row, x.ebitda_addback
      from jsonb_to_recordset(p_rows) as x(account text, gl text, qb_type text, kpi_group text, dashboard_row text, ebitda_addback text);
    when 'budget' then
      insert into public.fpa_budget_ytd (version_id, key, location, region, landlord, in_budget, revenue_actual, revenue_budget, ebitda_actual, ebitda_budget, adj_ebitda_actual, adj_ebitda_budget, sort)
      select p_version, x.key, x.location, x.region, x.landlord, x.in_budget, x.revenue_actual, x.revenue_budget, x.ebitda_actual, x.ebitda_budget, x.adj_ebitda_actual, x.adj_ebitda_budget, coalesce(x.sort, 0)
      from jsonb_to_recordset(p_rows) as x(key text, location text, region text, landlord text, in_budget boolean, revenue_actual numeric, revenue_budget numeric, ebitda_actual numeric, ebitda_budget numeric, adj_ebitda_actual numeric, adj_ebitda_budget numeric, sort int);
    when 'forecast' then
      insert into public.fpa_forecast_values (version_id, entity_key, region, segment, same_store, metric, month, value)
      select p_version, x.e, x.reg, x.seg, x.ss, x.m, x.d, x.v
      from jsonb_to_recordset(p_rows) as x(e text, reg text, seg text, ss boolean, m text, d date, v numeric);
    else
      raise exception 'bad_kind' using errcode = 'P0001';
  end case;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.fpa_load(uuid, text, jsonb) from public, anon;
grant execute on function public.fpa_load(uuid, text, jsonb) to authenticated;

-- Make a loaded version the current one, after checking it has the core data,
-- and delete the one it replaces.
create or replace function public.fpa_activate(p_version uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare vrec public.fpa_versions; counts jsonb;
begin
  if not public.fpa_may_load() then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into vrec from public.fpa_versions where id = p_version for update;
  if not found or vrec.status <> 'loading' then raise exception 'not_loading' using errcode = 'P0001'; end if;
  if auth.uid() is not null and vrec.account_id is distinct from public.auth_account_id() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  counts := jsonb_build_object(
    'entities', (select count(*) from public.fpa_entities where version_id = p_version),
    'sites', (select count(*) from public.fpa_sites where version_id = p_version),
    'metrics', (select count(*) from public.fpa_metric_values where version_id = p_version),
    'pl_lines', (select count(*) from public.fpa_pl_lines where version_id = p_version),
    'coa', (select count(*) from public.fpa_coa_map where version_id = p_version),
    'budget', (select count(*) from public.fpa_budget_ytd where version_id = p_version),
    'forecast', (select count(*) from public.fpa_forecast_values where version_id = p_version));
  if (counts->>'entities')::int = 0 or (counts->>'sites')::int = 0 or (counts->>'metrics')::int = 0 or (counts->>'pl_lines')::int = 0 then
    raise exception 'incomplete: %', counts using errcode = 'P0001';
  end if;
  delete from public.fpa_versions where account_id = vrec.account_id and status = 'current';
  update public.fpa_versions set status = 'current', activated_at = now(), row_counts = counts where id = p_version;
  return counts;
end $$;
revoke all on function public.fpa_activate(uuid) from public, anon;
grant execute on function public.fpa_activate(uuid) to authenticated;

create or replace function public.fpa_discard(p_version uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.fpa_may_load() then raise exception 'not_allowed' using errcode = '42501'; end if;
  delete from public.fpa_versions
  where id = p_version and status = 'loading'
    and (auth.uid() is null or account_id = public.auth_account_id());
end $$;
revoke all on function public.fpa_discard(uuid) from public, anon;
grant execute on function public.fpa_discard(uuid) to authenticated;
