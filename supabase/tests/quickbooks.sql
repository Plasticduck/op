-- QuickBooks sync (migration 0199): who can set it up, see it and send bills,
-- and that a bill can't be entered twice or changed behind the Web
-- Connector's back.
--
-- Runs inside a transaction that is rolled back. Impersonates users the way
-- PostgREST does: account A is the demo account (an Admin and a manager),
-- account B is another customer. Any failure raises "FAIL n: ..."; success
-- ends with ALL PASS.
--
--   sql.sh supabase/tests/quickbooks.sql

begin;

select set_config('t.a', (select id::text from public.accounts where name = 'WashLyfe Demo'), true);
select set_config('t.b', (select id::text from public.accounts where name = 'Cruise Car Wash'), true);
select set_config('t.a_owner', (select id::text from public.users where account_id = current_setting('t.a')::uuid and role = 'owner' limit 1), true);
select set_config('t.a_mgr', (select id::text from public.users where account_id = current_setting('t.a')::uuid and role = 'manager' limit 1), true);
select set_config('t.b_owner', (select id::text from public.users where account_id = current_setting('t.b')::uuid and role = 'owner' limit 1), true);

-- Two approved invoices and an exported one on A (as postgres).
with x as (
  insert into public.ops_invoices (account_id, vendor_name, amount, status, invoice_number)
  values (current_setting('t.a')::uuid, 'QBT vendor', 100, 'approved', 'QBT-1'),
         (current_setting('t.a')::uuid, 'QBT vendor', 200, 'approved', 'QBT-2'),
         (current_setting('t.a')::uuid, 'QBT vendor', 300, 'exported', 'QBT-3')
  returning id, invoice_number
) select set_config('t.inv1', (select id::text from x where invoice_number = 'QBT-1'), true),
         set_config('t.inv2', (select id::text from x where invoice_number = 'QBT-2'), true),
         set_config('t.inv3', (select id::text from x where invoice_number = 'QBT-3'), true);

-- ---- Admin of A: set up, queue, cancel, retry ---------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('t.login', (select row_to_json(p)::text from public.qb_new_password() p), true);
do $$
declare l jsonb := current_setting('t.login')::jsonb;
begin
  if coalesce(l ->> 'username', '') = '' or length(l ->> 'password') <> 20 then
    raise exception 'FAIL 1: an admin could not make a Web Connector login (%)', l;
  end if;
  if not exists (select 1 from public.qb_connections where username = l ->> 'username') then
    raise exception 'FAIL 2: an admin cannot see their connection';
  end if;
end $$;
do $$ begin
  perform password_hash from public.qb_connections;
  raise exception 'FAIL 3: the password hash is readable';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.qb_check_login('x', 'y');
  raise exception 'FAIL 4: people can call the login check';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.qb_replace_list(current_setting('t.a')::uuid, 'vendor', '[]'::jsonb);
  raise exception 'FAIL 5: people can replace the QuickBooks lists';
exception when insufficient_privilege then null;
end $$;
with j as (
  insert into public.qb_jobs (account_id, invoice_id, payload)
  values (current_setting('t.a')::uuid, current_setting('t.inv1')::uuid, '{"ref_number": "QBT-1"}')
  returning id
) select set_config('t.job1', id::text, true) from j;
do $$ begin
  insert into public.qb_jobs (account_id, invoice_id, payload)
  values (current_setting('t.a')::uuid, current_setting('t.inv1')::uuid, '{}');
  raise exception 'FAIL 6: the same invoice was queued twice';
exception when unique_violation then null;
end $$;
do $$ begin
  insert into public.qb_jobs (account_id, invoice_id, payload)
  values (current_setting('t.a')::uuid, current_setting('t.inv3')::uuid, '{}');
  raise exception 'FAIL 7: an exported invoice was queued';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;
do $$ begin
  insert into public.qb_jobs (account_id, invoice_id, payload, status, qb_txn_id)
  values (current_setting('t.a')::uuid, current_setting('t.inv2')::uuid, '{}', 'posted', 'FAKE');
  raise exception 'FAIL 8: a bill was recorded as entered by a person';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;
do $$ begin
  update public.qb_jobs set payload = '{"ref_number": "CHANGED"}' where id = current_setting('t.job1')::uuid;
  raise exception 'FAIL 9: a queued bill''s contents were changed';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;
do $$ begin
  update public.qb_jobs set status = 'posted' where id = current_setting('t.job1')::uuid;
  raise exception 'FAIL 10: a queued bill was marked entered';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;
do $$ begin
  delete from public.qb_jobs where id = current_setting('t.job1')::uuid;
  raise exception 'FAIL 11: a bill was deleted (people cancel instead)';
exception when insufficient_privilege then null;
end $$;
update public.qb_jobs set status = 'canceled' where id = current_setting('t.job1')::uuid;
reset role;
do $$ begin
  if (select status from public.qb_jobs where id = current_setting('t.job1')::uuid) is distinct from 'canceled' then
    raise exception 'FAIL 21: an admin could not cancel a queued bill';
  end if;
end $$;

-- After a cancel the invoice can go again; a failed bill can be retried; an
-- unanswered one can be marked found in QuickBooks.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
with j as (
  insert into public.qb_jobs (account_id, invoice_id, payload)
  values (current_setting('t.a')::uuid, current_setting('t.inv1')::uuid, '{"ref_number": "QBT-1"}')
  returning id
) select set_config('t.job2', id::text, true) from j;
reset role;
-- As the Web Connector would (no user).
select set_config('request.jwt.claims', '', true);
update public.qb_jobs set status = 'failed', error = 'QuickBooks said no', ticket = 'T' where id = current_setting('t.job2')::uuid;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.qb_jobs set status = 'queued' where id = current_setting('t.job2')::uuid;
reset role;
do $$ begin
  if (select status <> 'queued' or error is not null or ticket is not null from public.qb_jobs where id = current_setting('t.job2')::uuid) then
    raise exception 'FAIL 12: a failed bill could not be sent again cleanly';
  end if;
end $$;
select set_config('request.jwt.claims', '', true);
update public.qb_jobs set status = 'unknown', error = 'no answer' where id = current_setting('t.job2')::uuid;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.qb_jobs set status = 'posted' where id = current_setting('t.job2')::uuid;
reset role;
do $$ begin
  if (select status <> 'posted' or error is not null or done_at is null from public.qb_jobs where id = current_setting('t.job2')::uuid) then
    raise exception 'FAIL 13: an unanswered bill could not be marked found in QuickBooks';
  end if;
end $$;

-- ---- A manager of A: nothing -------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.a_mgr'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.qb_new_password();
  raise exception 'FAIL 14: a manager made a Web Connector login';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;
do $$ begin
  if exists (select 1 from public.qb_connections) or exists (select 1 from public.qb_jobs) then
    raise exception 'FAIL 15: a manager can see the QuickBooks sync';
  end if;
end $$;
do $$ begin
  insert into public.qb_jobs (account_id, invoice_id, payload)
  values (current_setting('t.a')::uuid, current_setting('t.inv2')::uuid, '{}');
  raise exception 'FAIL 16: a manager queued a bill';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;
reset role;

-- ---- Account B's Admin: none of A's ---------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.b_owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.qb_connections where account_id = current_setting('t.a')::uuid)
     or exists (select 1 from public.qb_jobs where account_id = current_setting('t.a')::uuid) then
    raise exception 'FAIL 17: another company can see this QuickBooks sync';
  end if;
end $$;
do $$ begin
  insert into public.qb_jobs (account_id, invoice_id, payload)
  values (current_setting('t.a')::uuid, current_setting('t.inv2')::uuid, '{}');
  raise exception 'FAIL 18: another company queued a bill here';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;
reset role;

-- ---- The login check (as the qbwc function would) ------------------------------------------
do $$
declare l jsonb := current_setting('t.login')::jsonb;
begin
  if public.qb_check_login(upper(l ->> 'username'), l ->> 'password') is distinct from current_setting('t.a')::uuid then
    raise exception 'FAIL 19: the right login was refused';
  end if;
  if public.qb_check_login(l ->> 'username', 'wrong') is not null then
    raise exception 'FAIL 20: a wrong password was let in';
  end if;
end $$;

select 'ALL PASS' as result;
rollback;
