-- Purchase Request delete (migration 0254): only the super admin can delete a
-- request, sent and signed ones included, and it takes the envelope, signatures,
-- audit trail, files and notifications with it, keeps the signer's consent, and
-- logs the deletion. Runs in the Mighty Wash account (the super admin's) inside
-- a transaction that is rolled back. Note: inserting a request uses up one
-- request number even though it's rolled back.
--   sql.sh supabase/tests/purchase_request_delete.sql

begin;

select set_config('t.acct', '54f3e299-1f61-4ed2-9921-3d02160b72e6', true);
select set_config('t.kevan', (select id::text from public.users where lower(email) = 'kevan@washlyfe.com'), true);
select set_config('t.other', (select id::text from public.users where lower(email) = 'lkeith@mighty-wash.com'), true);

create temp table t_ids (k text primary key, id uuid) on commit drop;
grant all on t_ids to authenticated;

-- A sent, signed request with everything attached (as the database admin).
do $$
declare acct uuid := current_setting('t.acct')::uuid; kev uuid := current_setting('t.kevan')::uuid;
  pr uuid; env uuid; con uuid; rec uuid;
begin
  if kev is null or current_setting('t.other', true) is null then raise exception 'FAIL 0: fixtures missing'; end if;
  insert into public.purchase_requests (account_id, requester_id, requester_name, title, status, ever_sent, total)
  values (acct, kev, 'Kevan Jowers', 'E2E TEST delete', 'approved', true, 123.45) returning id into pr;
  insert into public.esign_consents (account_id, user_id, user_name, user_email, disclosure_version, disclosure_sha256)
  values (acct, kev, 'Kevan Jowers', 'kevan@washlyfe.com', (select version from public.esign_disclosures limit 1), 'x') returning id into con;
  insert into public.esign_envelopes (account_id, source_type, source_id, title, document, document_hash, created_by, created_by_name, created_by_email, status, sealed_pdf_path)
  values (acct, 'purchase_request', pr, 'E2E TEST', '{"a":1}', 'abc', kev, 'Kevan', 'kevan@washlyfe.com', 'completed', acct || '/' || pr || '/sealed/x.pdf') returning id into env;
  insert into public.esign_recipients (envelope_id, account_id, user_id, name, email, role, routing_order, status, signed_at, consent_id)
  values (env, acct, kev, 'Kevan', 'kevan@washlyfe.com', 'signer', 1, 'signed', now(), con) returning id into rec;
  insert into public.esign_events (envelope_id, account_id, recipient_id, event) values (env, acct, rec, 'signed');
  update public.purchase_requests set envelope_id = env where id = pr;
  insert into public.purchase_request_files (request_id, account_id, path, name, locked) values (pr, acct, acct || '/' || pr || '/files/a.pdf', 'a.pdf', true);
  insert into public.notifications (user_id, kind, payload) values (kev, 'purchase_request', jsonb_build_object('request_id', pr, 'text', 'E2E TEST'));
  insert into t_ids values ('pr', pr), ('env', env), ('con', con);
end $$;

-- ---- Another Admin can't delete it, or read the log ----
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.other'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.purchase_request_delete((select id from t_ids where k = 'pr'));
    raise exception 'FAIL 1: another Admin deleted a request';
  exception when others then
    if sqlerrm not like '%not_allowed%' then raise exception 'FAIL 1: %', sqlerrm; end if;
  end;
  -- And the e-signature records still can't be deleted directly.
  delete from public.esign_envelopes where id = (select id from t_ids where k = 'env');
end $$;

-- ---- The super admin deletes it ----
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.kevan'), 'role', 'authenticated')::text, true);
do $$
declare res jsonb; pr uuid := (select id from t_ids where k = 'pr'); env uuid := (select id from t_ids where k = 'env');
begin
  -- Direct deletes are still refused for him too: only the function gets past the guards.
  begin
    delete from public.esign_envelopes where id = env;
    if not exists (select 1 from public.esign_envelopes where id = env) then raise exception 'FAIL 2: a direct delete removed an envelope'; end if;
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  res := public.purchase_request_delete(pr);
  if (res->>'envelopes')::int <> 1 or (res->>'files')::int <> 1 or res->>'title' <> 'E2E TEST delete' then raise exception 'FAIL 3: result %', res; end if;
  if not (res->'paths' ? (current_setting('t.acct') || '/' || pr || '/files/a.pdf')) or not (res->'paths' ? (current_setting('t.acct') || '/' || pr || '/sealed/x.pdf')) then
    raise exception 'FAIL 4: paths %', res->'paths';
  end if;
  if not exists (select 1 from public.purchase_request_deletions where request_id = pr and title = 'E2E TEST delete' and status = 'approved' and envelope_count = 1) then
    raise exception 'FAIL 5: no deletion log row';
  end if;
  begin
    perform public.purchase_request_delete(pr);
    raise exception 'FAIL 6: deleted twice';
  exception when others then
    if sqlerrm not like '%not_found%' then raise exception 'FAIL 6: %', sqlerrm; end if;
  end;
end $$;

reset role;
do $$
declare pr uuid := (select id from t_ids where k = 'pr'); env uuid := (select id from t_ids where k = 'env');
begin
  if exists (select 1 from public.purchase_requests where id = pr) then raise exception 'FAIL 7: request kept'; end if;
  if exists (select 1 from public.purchase_request_files where request_id = pr) then raise exception 'FAIL 8: file rows kept'; end if;
  if exists (select 1 from public.esign_envelopes where id = env) then raise exception 'FAIL 9: envelope kept'; end if;
  if exists (select 1 from public.esign_recipients where envelope_id = env) or exists (select 1 from public.esign_events where envelope_id = env) then
    raise exception 'FAIL 10: signatures or audit trail kept';
  end if;
  if exists (select 1 from public.notifications where payload->>'request_id' = pr::text) then raise exception 'FAIL 11: notification kept'; end if;
  if not exists (select 1 from public.esign_consents where id = (select id from t_ids where k = 'con')) then raise exception 'FAIL 12: the signer''s consent was deleted'; end if;
end $$;

select 'ALL PASS' as result;
rollback;
