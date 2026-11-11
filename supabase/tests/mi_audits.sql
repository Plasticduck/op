-- Equipment audits (0230): start or join, scanning (found, moved, wrong site, unknown,
-- blank), finishing and what it changes.
--
-- One transaction that always rolls back. "FAIL n: ..." on failure, "ALL PASS" at the end.
--
--   npx supabase db query --remote -f supabase/tests/mi_audits.sql

begin;

select set_config('t.acct', '54f3e299-1f61-4ed2-9921-3d02160b72e6', true);
select set_config('t.mw02', (select id::text from public.locations where account_id = current_setting('t.acct')::uuid and name = 'MW02'), true);
select set_config('t.mw19', (select id::text from public.locations where account_id = current_setting('t.acct')::uuid and name = 'MW19'), true);
select set_config('t.tb1', (select id::text from public.equipment where location_id = current_setting('t.mw02')::uuid and type = 'Top Brush 1' and parent_asset_id is null), true);
select set_config('t.eq19', (select id::text from public.equipment where location_id = current_setting('t.mw19')::uuid and parent_asset_id is null limit 1), true);
select set_config('t.eq19_qr', (select qr_code from public.equipment where id = current_setting('t.eq19')::uuid), true);
select set_config('t.machines', (select count(*)::text from public.equipment where location_id = current_setting('t.mw02')::uuid and parent_asset_id is null and status <> 'retired'), true);

do $$
declare
  a uuid := current_setting('t.acct')::uuid;
  u record;
begin
  if current_setting('t.eq19_qr', true) is null then raise exception 'FAIL 0: MW19 machine has no QR code'; end if;
  delete from public.mi_tags where entity_type = 'asset' and entity_id = current_setting('t.tb1')::uuid;
  update public.mi_audit_runs set status = 'cancelled' where location_id = current_setting('t.mw02')::uuid and status = 'in_progress';
  for u in select * from (values
    ('tech', 'site_tech', array[current_setting('t.mw02')::uuid]),
    ('mgr', 'site_manager', array[current_setting('t.mw02')::uuid]),
    ('mgr_nm', 'site_manager', array[current_setting('t.mw19')::uuid])) v(k, r, sites)
  loop
    perform set_config('t.' || u.k, gen_random_uuid()::text, true);
    insert into auth.users (id, email, instance_id, aud, role)
    values (current_setting('t.' || u.k)::uuid, u.k || '@mi-audit-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.users (id, account_id, location_ids, role, name, email)
    values (current_setting('t.' || u.k)::uuid, a, u.sites, 'manager', 'Test ' || u.k, u.k || '@mi-audit-test.invalid');
    insert into public.mi_members (user_id, account_id, role, site_ids) values (current_setting('t.' || u.k)::uuid, a, u.r, u.sites);
  end loop;
  perform set_config('t.zone', public.mi__area_for(a, current_setting('t.mw02')::uuid, 'TEST Audit Zone')::text, true);
end $$;

-- Put a sticker on Top Brush 1 and make a blank.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  r jsonb := public.mi_generate_blank_tags(2, current_setting('t.mw02')::uuid);
begin
  perform set_config('t.tag', r -> 'codes' ->> 0, true);
  perform set_config('t.blank', r -> 'codes' ->> 1, true);
  perform public.mi_claim_tag(current_setting('t.tag'), current_setting('t.tb1')::uuid);
end $$;
reset role;

-- ===== Start and join =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_nm'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mi_audit_start(current_setting('t.mw02')::uuid);
  raise exception 'FAIL 1: the MW19 manager started an MW02 audit';
exception when insufficient_privilege then null; end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  run uuid := public.mi_audit_start(current_setting('t.mw02')::uuid, 'all');
  d jsonb;
begin
  perform set_config('t.run', run::text, true);
  if public.mi_audit_start(current_setting('t.mw02')::uuid, 'all') <> run then raise exception 'FAIL 2: a second audit started instead of joining'; end if;
  d := public.mi_audit_detail(run);
  if jsonb_array_length(d -> 'items') <> current_setting('t.machines')::int then raise exception 'FAIL 3: % items for % machines', jsonb_array_length(d -> 'items'), current_setting('t.machines'); end if;

  -- ===== Scanning =====
  d := public.mi_audit_scan(run, current_setting('t.tag'), current_setting('t.zone')::uuid);
  if d ->> 'result' <> 'found' or not (d ->> 'moved')::boolean then raise exception 'FAIL 4: %', d; end if;
  d := public.mi_audit_scan(run, current_setting('t.tag'));
  if not (d ->> 'again')::boolean then raise exception 'FAIL 5: second scan didn''t say already found: %', d; end if;
  d := public.mi_audit_scan(run, current_setting('t.eq19_qr'));
  if d ->> 'result' <> 'wrong_site' or d ->> 'other_site' <> 'MW19' then raise exception 'FAIL 6: %', d; end if;
  d := public.mi_audit_scan(run, 'MF-A-99999X');
  if d ->> 'result' <> 'unregistered' then raise exception 'FAIL 7: %', d; end if;
  d := public.mi_audit_scan(run, current_setting('t.blank'));
  if d ->> 'result' <> 'blank' then raise exception 'FAIL 8: %', d; end if;
  perform public.mi_audit_mark((select i.id from public.mi_audit_items i where i.run_id = run and i.equipment_id = current_setting('t.tb1')::uuid), 'found', 'faded');
  begin
    perform public.mi_audit_complete(run);
    raise exception 'FAIL 9: finished with machines not checked';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  d := public.mi_audit_complete(run, 'TEST walk', true);
  if (d ->> 'found')::int <> 1 or (d ->> 'missing')::int <> current_setting('t.machines')::int - 1 or (d ->> 'moved')::int <> 1
     or (d ->> 'wrong_site')::int <> 1 or (d ->> 'unregistered')::int <> 1 or (d ->> 'stickers_bad')::int <> 1 then
    raise exception 'FAIL 10: summary %', d;
  end if;
  begin
    perform public.mi_audit_scan(run, current_setting('t.tag'));
    raise exception 'FAIL 11: scanned into a finished audit';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
reset role;

do $$ begin
  if (select area_id from public.equipment where id = current_setting('t.tb1')::uuid) <> current_setting('t.zone')::uuid then raise exception 'FAIL 12: found machine wasn''t moved to its zone'; end if;
  if (select last_audited_at from public.equipment where id = current_setting('t.tb1')::uuid) is null then raise exception 'FAIL 13: not marked audited'; end if;
  if (select condition from public.mi_tags where code = current_setting('t.tag')) <> 'faded' then raise exception 'FAIL 14: sticker condition not applied'; end if;
  if not exists (select 1 from public.mi_equipment_events where equipment_id = current_setting('t.tb1')::uuid and action = 'audited') then raise exception 'FAIL 15: no audited event'; end if;
  if (select count(*) from public.mi_equipment_events e join public.mi_audit_items i on i.equipment_id = e.equipment_id
      where i.run_id = current_setting('t.run')::uuid and i.result = 'missing' and e.action = 'audited' and e.note = 'Not found in the audit') = 0 then
    raise exception 'FAIL 16: missing machines have no history line';
  end if;
end $$;

-- ===== Stickered scope only lists machines with stickers =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  run uuid := public.mi_audit_start(current_setting('t.mw02')::uuid, 'stickered');
begin
  if jsonb_array_length(public.mi_audit_detail(run) -> 'items') <> 1 then raise exception 'FAIL 17: stickered audit lists %', jsonb_array_length(public.mi_audit_detail(run) -> 'items'); end if;
  perform public.mi_audit_cancel(run);
  if (select status from public.mi_audit_runs where id = run) <> 'cancelled' then raise exception 'FAIL 18: cancel'; end if;
end $$;
reset role;

do $$ begin
  raise exception 'ALL PASS';
end $$;

rollback;
