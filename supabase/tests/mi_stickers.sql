-- Sticker lifecycle (0229): blank batches, claiming on scan, replacing, retiring,
-- condition and the print queue.
--
-- One transaction that always rolls back. "FAIL n: ..." on failure, "ALL PASS" at the end.
--
--   npx supabase db query --remote -f supabase/tests/mi_stickers.sql

begin;

select set_config('t.acct', '54f3e299-1f61-4ed2-9921-3d02160b72e6', true);
select set_config('t.mw02', (select id::text from public.locations where account_id = current_setting('t.acct')::uuid and name = 'MW02'), true);
select set_config('t.mw19', (select id::text from public.locations where account_id = current_setting('t.acct')::uuid and name = 'MW19'), true);
select set_config('t.tb1', (select id::text from public.equipment where location_id = current_setting('t.mw02')::uuid and type = 'Top Brush 1' and parent_asset_id is null), true);
select set_config('t.tb2', (select id::text from public.equipment where location_id = current_setting('t.mw02')::uuid and type = 'Top Brush 2' and parent_asset_id is null), true);

do $$
declare
  a uuid := current_setting('t.acct')::uuid;
  u record;
begin
  -- Start both brushes with no sticker.
  delete from public.mi_tags where entity_type = 'asset' and entity_id in (current_setting('t.tb1')::uuid, current_setting('t.tb2')::uuid);
  for u in select * from (values
    ('tech', 'site_tech', array[current_setting('t.mw02')::uuid]),
    ('mgr', 'site_manager', array[current_setting('t.mw02')::uuid]),
    ('mgr_nm', 'site_manager', array[current_setting('t.mw19')::uuid])) v(k, r, sites)
  loop
    perform set_config('t.' || u.k, gen_random_uuid()::text, true);
    insert into auth.users (id, email, instance_id, aud, role)
    values (current_setting('t.' || u.k)::uuid, u.k || '@mi-sticker-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.users (id, account_id, location_ids, role, name, email)
    values (current_setting('t.' || u.k)::uuid, a, u.sites, 'manager', 'Test ' || u.k, u.k || '@mi-sticker-test.invalid');
    insert into public.mi_members (user_id, account_id, role, site_ids) values (current_setting('t.' || u.k)::uuid, a, u.r, u.sites);
  end loop;
end $$;

-- ===== Blank batches =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mi_generate_blank_tags(3, current_setting('t.mw02')::uuid);
  raise exception 'FAIL 1: a site tech made blank stickers';
exception when insufficient_privilege then null; end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  r jsonb := public.mi_generate_blank_tags(3, current_setting('t.mw02')::uuid);
  s jsonb;
begin
  if jsonb_array_length(r -> 'codes') <> 3 or (r -> 'codes' ->> 0) !~ '^MF-A-[0-9]{5}$' then raise exception 'FAIL 2: %', r; end if;
  perform set_config('t.b1', r -> 'codes' ->> 0, true);
  perform set_config('t.b2', r -> 'codes' ->> 1, true);
  perform set_config('t.b3', r -> 'codes' ->> 2, true);
  if public.mi_resolve_scan(current_setting('t.b1')) ->> 'kind' <> 'blank' then raise exception 'FAIL 3: blank didn''t resolve as blank'; end if;
  s := public.mi_offline_snapshot();
  if exists (select 1 from jsonb_array_elements(s -> 'tags') x where x ->> 'code' = current_setting('t.b1')) then raise exception 'FAIL 4: blank in the offline snapshot'; end if;
  if not exists (select 1 from jsonb_array_elements(public.mi_blank_tags()) x where x ->> 'first' = current_setting('t.b1')) then raise exception 'FAIL 5: batch not listed'; end if;
end $$;
reset role;

-- ===== Claiming, replacing =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.mgr_nm'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mi_claim_tag(current_setting('t.b1'), current_setting('t.tb1')::uuid);
  raise exception 'FAIL 6: the MW19 manager put a sticker on an MW02 machine';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  r jsonb;
begin
  r := public.mi_claim_tag(lower(current_setting('t.b1')), current_setting('t.tb1')::uuid);
  if r ->> 'code' <> current_setting('t.b1') then raise exception 'FAIL 7: %', r; end if;
  if (public.mi_asset_detail(current_setting('t.tb1')::uuid) -> 'asset' ->> 'tag') <> current_setting('t.b1') then raise exception 'FAIL 8: machine doesn''t show its sticker'; end if;
  begin
    perform public.mi_claim_tag(current_setting('t.b2'), current_setting('t.tb1')::uuid);
    raise exception 'FAIL 9: a second sticker went on without asking';
  exception when raise_exception then
    if sqlerrm not like '%Replace it?' then raise; end if;
  end;
  r := public.mi_claim_tag(current_setting('t.b2'), current_setting('t.tb1')::uuid, true);
  if r ->> 'replaced' <> current_setting('t.b1') then raise exception 'FAIL 10: %', r; end if;
  r := public.mi_resolve_scan(current_setting('t.b1'));
  if r ->> 'kind' <> 'retired' or r ->> 'former_id' <> current_setting('t.tb1') or r ->> 'current_code' <> current_setting('t.b2') then raise exception 'FAIL 11: %', r; end if;
  begin
    perform public.mi_claim_tag(current_setting('t.b1'), current_setting('t.tb2')::uuid);
    raise exception 'FAIL 12: a retired sticker was used again';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.mi_claim_tag(current_setting('t.b2'), current_setting('t.tb2')::uuid);
    raise exception 'FAIL 13: one sticker went on two machines';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  if public.mi_resolve_scan(current_setting('t.b2')) ->> 'id' <> current_setting('t.tb1') then raise exception 'FAIL 14: new sticker doesn''t open the machine'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.mi_equipment_events where equipment_id = current_setting('t.tb1')::uuid and action in ('tag_applied', 'tag_retired')) <> 3 then
    raise exception 'FAIL 15: sticker events';
  end if;
  update public.mi_tags set entity_id = current_setting('t.tb2')::uuid where code = current_setting('t.b2');
  raise exception 'FAIL 16: an applied sticker moved to another machine';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;
do $$ begin
  update public.mi_tags set status = 'unused', entity_id = null where code = current_setting('t.b2');
  raise exception 'FAIL 17: a used sticker went back to blank';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;

-- ===== Condition and the print queue =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tech'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  q jsonb;
  t text;
begin
  perform public.mi_set_tag_condition(array[current_setting('t.b2')], 'faded');
  q := public.mi_sticker_queue(current_setting('t.mw02')::uuid);
  if (select x ->> 'reason' from jsonb_array_elements(q) x where x ->> 'id' = current_setting('t.tb1')) <> 'faded' then raise exception 'FAIL 18: faded sticker not queued'; end if;
  if (select x ->> 'reason' from jsonb_array_elements(q) x where x ->> 'id' = current_setting('t.tb2')) <> 'none' then raise exception 'FAIL 19: machine with no sticker not queued'; end if;
  if (select x ->> 'tag_condition' from jsonb_array_elements(public.mi_equipment_list() -> 'rows') x where x ->> 'id' = current_setting('t.tb1')) <> 'faded' then
    raise exception 'FAIL 20: list doesn''t show the condition';
  end if;
  perform public.mi_mark_printed(array[current_setting('t.b2')]);
  if exists (select 1 from jsonb_array_elements(public.mi_sticker_queue(current_setting('t.mw02')::uuid)) x where x ->> 'id' = current_setting('t.tb1')) then
    raise exception 'FAIL 21: still queued after printing';
  end if;
  -- Printing on demand still works, and makes an applied tag.
  t := public.mi_ensure_tag('asset', current_setting('t.tb2')::uuid);
  if (select status from public.mi_tags where code = t) <> 'applied' or (select applied_at from public.mi_tags where code = t) is null then raise exception 'FAIL 22: ensure_tag'; end if;
  if split_part(t, '-', 3)::int <= split_part(current_setting('t.b3'), '-', 3)::int then raise exception 'FAIL 23: counter went backwards (% after %)', t, current_setting('t.b3'); end if;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.mi_equipment_events where equipment_id = current_setting('t.tb1')::uuid and action = 'label_printed') then raise exception 'FAIL 24: print not in history'; end if;
end $$;

do $$ begin
  raise exception 'ALL PASS';
end $$;

rollback;
