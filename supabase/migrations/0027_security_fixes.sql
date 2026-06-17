-- 0027_security_fixes.sql
--
-- Two server-side hardenings surfaced by the security audit:
--
-- 1) kiosk_punch_by_pin now requires manager+ in addition to location access.
--    Per the product model, the kiosk is a shared device operated by a manager
--    or owner, not employees. The previous version only checked
--    auth_has_location, which meant any signed-in employee at that location
--    could call the RPC directly and brute-force the 4-digit PIN space (10,000
--    combinations) to clock co-workers in/out and learn their names.
--
-- 2) ai_insights refresh rate limit was check-then-insert, so two concurrent
--    "Refresh Insights" calls could both pass the per-hour gate before either
--    wrote its log row, doubling the Claude spend per refresh. Dedupe any
--    existing same-hour rows, then add a unique expression index so the insert
--    itself is the gate (race-free).

-- 1) Kiosk PIN: gate on manager+.
create or replace function public.kiosk_punch_by_pin(p_location_id uuid, p_pin text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare v_id uuid; v_first text; v_last text; v_open uuid; v_action text;
begin
  if not public.auth_is_manager_plus() then raise exception 'forbidden'; end if;
  if not public.auth_has_location(p_location_id) then raise exception 'forbidden'; end if;
  if p_pin !~ '^\d{4}$' then raise exception 'invalid PIN'; end if;

  select id, first_name, last_name into v_id, v_first, v_last
    from public.employees
    where location_id = p_location_id
      and status = 'active'
      and pin_hash is not null
      and pin_hash = crypt(p_pin, pin_hash)
    limit 1;
  if v_id is null then raise exception 'invalid PIN'; end if;

  select id into v_open from public.time_entries
    where employee_id = v_id and clock_out is null
    order by clock_in desc limit 1;

  if v_open is not null then
    update public.time_entries set clock_out = now() where id = v_open;
    v_action := 'out';
  else
    insert into public.time_entries (location_id, employee_id, clock_in)
      values (p_location_id, v_id, now());
    v_action := 'in';
  end if;

  return jsonb_build_object('action', v_action, 'name', v_first || ' ' || v_last);
end $$;

-- 2) AI insights refresh rate limit: dedupe + atomic gate via unique index.
delete from public.ai_insights_refresh_log a
using public.ai_insights_refresh_log b
where a.ctid <> b.ctid
  and a.account_id = b.account_id
  and date_trunc('hour', a.created_at) = date_trunc('hour', b.created_at)
  and a.created_at < b.created_at;

-- date_trunc(text, timestamptz) is STABLE (depends on session timezone), so it
-- can't appear in an expression index. Casting to a UTC timestamp first makes
-- the whole expression IMMUTABLE and indexable.
create unique index if not exists ai_insights_refresh_log_acct_hour
  on public.ai_insights_refresh_log (account_id, (date_trunc('hour', created_at at time zone 'UTC')));
