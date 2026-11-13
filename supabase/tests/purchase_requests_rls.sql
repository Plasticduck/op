-- Purchase Request + e-signature: RLS and record-integrity tests (migration 0238).
--
-- Runs inside a transaction that is rolled back, so it leaves nothing behind.
-- It impersonates real users the way PostgREST does (JWT claims + the
-- authenticated role), and acts as the edge function with the service_role role.
-- Demo account: the manager is the requester, the owner is AP, the employee is an
-- outsider. Any failure raises "FAIL n: ..." and aborts; success ends with ALL PASS.
--
--   sql.sh supabase/tests/purchase_requests_rls.sql

begin;

select set_config('t.acct', (select id::text from public.accounts where name = 'WashLyfe Demo'), true);
select set_config('t.owner', (select id::text from public.users where account_id = current_setting('t.acct')::uuid and role = 'owner' limit 1), true);
select set_config('t.mgr', (select id::text from public.users where account_id = current_setting('t.acct')::uuid and role = 'manager' limit 1), true);
select set_config('t.emp', (select id::text from public.users where account_id = current_setting('t.acct')::uuid and role = 'employee' limit 1), true);

do $$
declare
  acct uuid := current_setting('t.acct')::uuid;
  own uuid := current_setting('t.owner')::uuid;
  mgr uuid := current_setting('t.mgr')::uuid;
  emp uuid := current_setting('t.emp')::uuid;
  pr uuid; pr2 uuid; env uuid; rec uuid; n int; r record;
begin
  if own is null or mgr is null or emp is null then raise exception 'FAIL 0: demo users missing'; end if;

  -- The requester drafts, trying to set server-managed fields.
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.purchase_requests (title, status, requester_id, requester_name, total, line_items, shipping, tax, ever_sent, po_number)
  values ('RLS test', 'approved', own, 'Fake', 999999,
    '[{"description":"A","quantity":2,"unit_price":125.5},{"description":"B","quantity":1,"unit_price":40}]', 10, 5.25, true, 'PO-X')
  returning id into pr;
  select * into r from public.purchase_requests where id = pr;
  if r.status <> 'draft' or r.requester_id <> mgr or r.requester_name = 'Fake' or r.ever_sent or r.po_number is not null then
    raise exception 'FAIL 1: client set server-managed fields';
  end if;
  if r.subtotal <> 291.00 or r.total <> 306.25 then raise exception 'FAIL 2: totals % / %', r.subtotal, r.total; end if;
  update public.purchase_requests set title = 'Edited', status = 'approved' where id = pr;
  select * into r from public.purchase_requests where id = pr;
  if r.title <> 'Edited' or r.status <> 'draft' then raise exception 'FAIL 3: draft edit or status guard'; end if;
  insert into public.purchase_request_files (request_id, account_id, path, name, locked) values (pr, acct, acct || '/' || pr || '/a.pdf', 'a.pdf', true);
  if (select locked from public.purchase_request_files where request_id = pr) then raise exception 'FAIL 4: client locked a file'; end if;
  execute 'reset role';

  -- AP (owner) sees it; an outsider doesn't; nobody can attach to another's draft.
  perform set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if (select count(*) from public.purchase_requests where id = pr) <> 1 then raise exception 'FAIL 5: AP cannot see the request'; end if;
  insert into public.purchase_requests (title) values ('Owner draft') returning id into pr2;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', emp, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if (select count(*) from public.purchase_requests where id in (pr, pr2)) <> 0 then raise exception 'FAIL 6: outsider sees requests'; end if;
  begin
    insert into public.purchase_request_files (request_id, account_id, path, name) values (pr, acct, acct || '/' || pr || '/x.pdf', 'x.pdf');
    raise exception 'FAIL 7: attached a file to someone else''s draft';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    insert into public.esign_events (envelope_id, account_id, event) values (gen_random_uuid(), acct, 'signed');
    raise exception 'FAIL 8: a client wrote an audit event';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  execute 'reset role';

  -- The edge function (service_role) sends it, with the employee as approver.
  execute 'set local role service_role';
  insert into public.esign_envelopes (account_id, source_type, source_id, title, document, document_hash, created_by, created_by_name, created_by_email)
  values (acct, 'purchase_request', pr, 'PR test', '{"a":1}', 'abc', mgr, 'M', 'm@x') returning id into env;
  insert into public.esign_recipients (envelope_id, account_id, user_id, name, email, role, routing_order, status)
  values (env, acct, emp, 'E', 'e@x', 'signer', 1, 'sent') returning id into rec;
  update public.purchase_requests set status = 'pending', envelope_id = env, ever_sent = true where id = pr;
  insert into public.esign_events (envelope_id, account_id, event) values (env, acct, 'sent');
  begin
    update public.esign_envelopes set document = '{"a":2}' where id = env;
    raise exception 'FAIL 9: signed content changed';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    delete from public.esign_events where envelope_id = env;
    raise exception 'FAIL 10: audit event deleted';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    update public.esign_events set detail = '{"x":1}' where envelope_id = env;
    raise exception 'FAIL 11: audit event edited';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  update public.esign_recipients set status = 'signed', signed_at = now(), signature_image = 'data:image/png;base64,AAA' where id = rec;
  begin
    update public.esign_recipients set signature_image = 'data:image/png;base64,BBB' where id = rec;
    raise exception 'FAIL 12: a signature was swapped';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  update public.esign_envelopes set status = 'completed', completed_at = now(), sealed_pdf_sha256 = 'deadbeef' where id = env;
  begin
    update public.esign_envelopes set status = 'voided' where id = env;
    raise exception 'FAIL 13: a finished envelope changed status';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    update public.esign_envelopes set sealed_pdf_sha256 = 'beef' where id = env;
    raise exception 'FAIL 14: a seal fingerprint changed';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    delete from public.esign_envelopes where id = env;
    raise exception 'FAIL 15: an envelope was deleted';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  execute 'reset role';

  -- The approver now sees it all; the requester can't edit or delete it.
  perform set_config('request.jwt.claims', json_build_object('sub', emp, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if (select count(*) from public.purchase_requests where id = pr) <> 1
     or (select count(*) from public.esign_envelopes where id = env) <> 1
     or (select count(*) from public.esign_recipients where envelope_id = env) <> 1
     or (select count(*) from public.esign_events where envelope_id = env) <> 1 then
    raise exception 'FAIL 16: the signer cannot see the request and its record';
  end if;
  if (select count(*) from public.esign_verify_pdf('DEADBEEF')) <> 1 then raise exception 'FAIL 17: verify lookup'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.purchase_requests set title = 'Sneaky' where id = pr;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 18: edited after sending'; end if;
  delete from public.purchase_requests where id = pr;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 19: deleted after sending'; end if;
  if (select count(*) from public.esign_verify_pdf('deadbeef')) <> 1 then raise exception 'FAIL 20: requester verify lookup'; end if;
  execute 'reset role';

  -- Saved signatures are private.
  insert into public.esign_saved_signatures (user_id, kind, image) values (mgr, 'typed', 'data:image/png;base64,AAA');
  perform set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if (select count(*) from public.esign_saved_signatures where user_id = mgr) <> 0 then raise exception 'FAIL 21: saw someone else''s saved signature'; end if;
  execute 'reset role';
end $$;

select 'ALL PASS' as result;
rollback;
