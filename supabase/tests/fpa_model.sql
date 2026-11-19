-- FP&A Model (migration 0253): who can read the model's data, and who can load a
-- new version. Runs against the loaded Mighty Wash model inside a transaction
-- that is rolled back. Any failure raises "FAIL n: ..."; success ends with ALL PASS.
--   sql.sh supabase/tests/fpa_model.sql

begin;

select set_config('t.mw', '54f3e299-1f61-4ed2-9921-3d02160b72e6', true);
select set_config('t.reader', (select id::text from public.users where lower(email) = 'ssspore@mighty-wash.com'), true);
select set_config('t.kevan', (select id::text from public.users where lower(email) = 'kevan@washlyfe.com'), true);
-- An Admin who is not on the list.
select set_config('t.other_owner', (select id::text from public.users where lower(email) = 'lkeith@mighty-wash.com'), true);
select set_config('t.demo_owner', (select u.id::text from public.users u join public.accounts a on a.id = u.account_id where a.name = 'WashLyfe Demo' and u.role = 'owner' limit 1), true);

do $$ begin
  if coalesce(current_setting('t.reader', true), '') = '' or coalesce(current_setting('t.other_owner', true), '') = ''
     or coalesce(current_setting('t.kevan', true), '') = '' or coalesce(current_setting('t.demo_owner', true), '') = '' then
    raise exception 'FAIL 0: fixtures missing';
  end if;
  if not exists (select 1 from public.fpa_versions where account_id = current_setting('t.mw')::uuid and status = 'current') then
    raise exception 'FAIL 0: no current model loaded';
  end if;
end $$;

create temp table t_out (k text primary key, v text) on commit drop;
grant all on t_out to authenticated;

-- ---- A reader (Scott Spore) ----
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.reader'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare n numeric;
begin
  if not public.fpa_can_read() then raise exception 'FAIL 1: a listed reader cannot read'; end if;
  select value into n from public.fpa_current_metrics where entity_key = 'S33' and metric = 'Net Revenue' and month = '2026-10-01';
  if n is distinct from 63800.26 then raise exception 'FAIL 2: S33 Oct net revenue %', n; end if;
  if (select count(*) from public.fpa_current_pl_lines) < 30000 then raise exception 'FAIL 3: P&L lines not visible'; end if;
  if (select revenue_actual from public.fpa_current_budget_ytd where key = 'TOTAL') is distinct from 38009500.20 then raise exception 'FAIL 4: budget total'; end if;
  if (select count(*) from public.fpa_current_version) <> 1 then raise exception 'FAIL 5: one current version'; end if;
  if (select count(*) from public.fpa_current_forecast) = 0 or (select count(*) from public.fpa_current_sites) <> 37 then raise exception 'FAIL 6: forecast or sites'; end if;
  if exists (select 1 from public.fpa_readers) then raise exception 'FAIL 7: a reader can read the reader list'; end if;
  -- Readers can't load.
  begin
    perform public.fpa_begin(current_setting('t.mw')::uuid, 'x', null, null, '{}');
    raise exception 'FAIL 8: a reader started a load';
  exception when others then
    if sqlerrm not like '%not_allowed%' then raise exception 'FAIL 8: %', sqlerrm; end if;
  end;
  -- No direct writes either.
  begin
    insert into public.fpa_metric_values (version_id, entity_key, metric, month, value)
    select id, 'S01', 'Net Revenue', '2030-01-01', 1 from public.fpa_versions limit 1;
    raise exception 'FAIL 9: a reader wrote a value';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;

-- ---- An Admin who isn't on the list (Laramie) sees nothing ----
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.other_owner'), 'role', 'authenticated')::text, true);

do $$ begin
  if public.fpa_can_read() then raise exception 'FAIL 10: an unlisted Admin can read'; end if;
  if exists (select 1 from public.fpa_current_metrics) or exists (select 1 from public.fpa_current_pl_lines)
     or exists (select 1 from public.fpa_current_version) or exists (select 1 from public.fpa_current_budget_ytd)
     or exists (select 1 from public.fpa_metric_values) or exists (select 1 from public.fpa_versions) then
    raise exception 'FAIL 11: an unlisted Admin sees model data';
  end if;
  begin
    perform public.fpa_activate((select id from public.fpa_versions limit 1));
    raise exception 'FAIL 12: an unlisted Admin activated';
  exception when others then
    if sqlerrm not like '%not_allowed%' then raise exception 'FAIL 12: %', sqlerrm; end if;
  end;
end $$;

-- ---- Another account sees nothing ----
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.demo_owner'), 'role', 'authenticated')::text, true);
do $$ begin
  if exists (select 1 from public.fpa_current_metrics) or exists (select 1 from public.fpa_sites) then
    raise exception 'FAIL 13: another account sees model data';
  end if;
end $$;

-- ---- Kevan loads a new version; it replaces the old one only when activated ----
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.kevan'), 'role', 'authenticated')::text, true);

do $$
declare v uuid; old uuid; c jsonb;
begin
  select id into old from public.fpa_current_version;
  begin
    perform public.fpa_begin('00000000-0000-0000-0000-000000000000', 'x', null, null, '{}');
    raise exception 'FAIL 14: loaded into another account';
  exception when others then
    if sqlerrm not like '%not_allowed%' then raise exception 'FAIL 14: %', sqlerrm; end if;
  end;
  v := public.fpa_begin(current_setting('t.mw')::uuid, 'Test version', 'test.xlsx', '2026-10-01', '{"subtitle":"t"}');
  -- Loading isn't visible yet.
  if (select id from public.fpa_current_version) is distinct from old then raise exception 'FAIL 15: a loading version became current'; end if;
  begin
    perform public.fpa_activate(v);
    raise exception 'FAIL 16: an empty version activated';
  exception when others then
    if sqlerrm not like '%incomplete%' then raise exception 'FAIL 16: %', sqlerrm; end if;
  end;
  begin
    perform public.fpa_load(v, 'nonsense', '[]');
    raise exception 'FAIL 17: bad kind accepted';
  exception when others then
    if sqlerrm not like '%bad_kind%' then raise exception 'FAIL 17: %', sqlerrm; end if;
  end;
  perform public.fpa_load(v, 'entities', '[{"key":"G_CONS","label":"Consolidated","kind":"group","filter_field":"all","filter_value":"All","sort":0}]');
  perform public.fpa_load(v, 'sites', '[{"key":"S01","site_number":1,"name":"LBK 82nd","region":"Lubbock","same_store":true,"sort":0}]');
  perform public.fpa_load(v, 'metrics', '[{"e":"G_CONS","m":"Net Revenue","d":"2026-10-01","v":123.45}]');
  perform public.fpa_load(v, 'pl', '[{"n":1,"d":"2026-10-01","c":"01 - LBK 82nd","k":"S01","a":"60001 · Wash Sales","gl":"60001","v":123.45,"g":"Wash Sales","t":"Income"}]');
  c := public.fpa_activate(v);
  if (c->>'metrics')::int <> 1 then raise exception 'FAIL 18: counts %', c; end if;
  if (select id from public.fpa_current_version) is distinct from v then raise exception 'FAIL 19: new version not current'; end if;
  if exists (select 1 from public.fpa_versions where id = old) then raise exception 'FAIL 20: the replaced version was kept'; end if;
  if (select value from public.fpa_current_metrics where entity_key = 'G_CONS') is distinct from 123.45 then raise exception 'FAIL 21: new values not served'; end if;
  begin
    perform public.fpa_load(v, 'metrics', '[]');
    raise exception 'FAIL 22: loaded into a current version';
  exception when others then
    if sqlerrm not like '%not_loading%' then raise exception 'FAIL 22: %', sqlerrm; end if;
  end;
  if not exists (select 1 from public.fpa_readers) then raise exception 'FAIL 23: Kevan cannot see the reader list'; end if;
end $$;

select 'ALL PASS' as result;
rollback;
