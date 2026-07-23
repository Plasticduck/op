-- Employee biometric (facial-recognition) consent. The time clock captures a
-- facial scan to verify identity, which is a biometric identifier under the Texas
-- Capture or Use of Biometric Identifier Act and similar laws. Those laws require
-- notice and consent BEFORE capture, so we record each employee's consent here and
-- gate face capture on it. One active record per employee; a fresh consent or a
-- revocation updates it in place. Employees punch by PIN at a manager-authed
-- kiosk (no employee login), so writes go through SECURITY DEFINER RPCs.

create table if not exists public.biometric_consents (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  employee_id    uuid not null references public.employees(id) on delete cascade,
  location_id    uuid references public.locations(id) on delete set null,
  full_name      text,
  policy_version text,
  method         text not null default 'kiosk',
  user_agent     text,
  consented_at   timestamptz not null default now(),
  revoked_at     timestamptz,
  revoked_by     uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (employee_id)
);
create index if not exists biometric_consents_acct_idx on public.biometric_consents (account_id);

alter table public.biometric_consents enable row level security;

-- Managers/owners may read consent status for their sites. All writes go through
-- the SECURITY DEFINER RPCs below, so there are no write policies.
create policy biometric_consents_select on public.biometric_consents
  for select using (
    account_id = auth_account_id()
    and (location_id is null or auth_has_location(location_id))
  );

-- Resolve a kiosk PIN, now also reporting whether the employee has active
-- biometric consent so the kiosk can show the consent screen before face capture.
create or replace function public.resolve_kiosk_pin(p_location_id uuid, p_pin text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_emp record;
  v_open uuid;
  v_consent boolean;
begin
  if not public.auth_is_manager_plus() then raise exception 'forbidden'; end if;
  if not public.auth_has_location(p_location_id) then raise exception 'forbidden'; end if;
  if p_pin !~ '^\d{5}$' then raise exception 'invalid PIN'; end if;

  select e.id, e.first_name, e.last_name, l.account_id
    into v_emp
    from public.employees e
    join public.locations l on l.id = e.location_id
   where e.location_id = p_location_id
     and e.status = 'active'
     and e.pin_hash is not null
     and e.pin_hash = crypt(p_pin, e.pin_hash)
   limit 1;
  if v_emp is null then raise exception 'invalid PIN'; end if;

  select id into v_open from public.time_entries
   where employee_id = v_emp.id and clock_out is null
   order by clock_in desc limit 1;

  select exists (
    select 1 from public.biometric_consents bc
     where bc.employee_id = v_emp.id and bc.revoked_at is null
  ) into v_consent;

  return jsonb_build_object(
    'employee_id', v_emp.id,
    'account_id', v_emp.account_id,
    'name', v_emp.first_name || ' ' || v_emp.last_name,
    'next_action', case when v_open is null then 'in' else 'out' end,
    'has_biometric_consent', v_consent
  );
end $$;

-- Record (or refresh) an employee's biometric consent from the kiosk. Identifies
-- the employee by PIN, exactly like the punch RPCs.
create or replace function public.kiosk_record_biometric_consent(
  p_location_id uuid,
  p_pin text,
  p_full_name text,
  p_policy_version text,
  p_user_agent text default null
)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare v_id uuid; v_acct uuid;
begin
  if not public.auth_is_manager_plus() then raise exception 'forbidden'; end if;
  if not public.auth_has_location(p_location_id) then raise exception 'forbidden'; end if;
  if p_pin !~ '^\d{5}$' then raise exception 'invalid PIN'; end if;

  select e.id, l.account_id into v_id, v_acct
    from public.employees e
    join public.locations l on l.id = e.location_id
   where e.location_id = p_location_id
     and e.status = 'active'
     and e.pin_hash is not null
     and e.pin_hash = crypt(p_pin, e.pin_hash)
   limit 1;
  if v_id is null then raise exception 'invalid PIN'; end if;

  insert into public.biometric_consents (
    account_id, employee_id, location_id, full_name, policy_version, method, user_agent,
    consented_at, revoked_at, revoked_by, updated_at
  ) values (
    v_acct, v_id, p_location_id, p_full_name, p_policy_version, 'kiosk', p_user_agent,
    now(), null, null, now()
  )
  on conflict (employee_id) do update set
    full_name = excluded.full_name,
    policy_version = excluded.policy_version,
    location_id = excluded.location_id,
    method = 'kiosk',
    user_agent = excluded.user_agent,
    consented_at = now(),
    revoked_at = null,
    revoked_by = null,
    updated_at = now();

  return jsonb_build_object('employee_id', v_id);
end $$;

-- Withdraw an employee's consent (manager action). Face verification then stops
-- for that employee until they consent again.
create or replace function public.revoke_biometric_consent(p_employee_id uuid)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare v_loc uuid;
begin
  select location_id into v_loc from public.employees where id = p_employee_id;
  if v_loc is null then raise exception 'employee not found'; end if;
  if not public.auth_is_manager_plus() or not public.auth_has_location(v_loc) then
    raise exception 'forbidden';
  end if;
  update public.biometric_consents
     set revoked_at = now(), revoked_by = auth.uid(), updated_at = now()
   where employee_id = p_employee_id and revoked_at is null;
end $$;

-- Consent status for every active employee at a site (for the admin view).
create or replace function public.biometric_consent_status(p_location_id uuid)
returns table (
  employee_id uuid,
  name text,
  consented boolean,
  consented_at timestamptz,
  revoked_at timestamptz
)
language sql security definer
set search_path = public, extensions as $$
  select e.id,
         e.first_name || ' ' || e.last_name,
         (bc.id is not null and bc.revoked_at is null),
         bc.consented_at,
         bc.revoked_at
    from public.employees e
    left join public.biometric_consents bc on bc.employee_id = e.id
   where e.location_id = p_location_id
     and e.status = 'active'
     and public.auth_is_manager_plus()
     and public.auth_has_location(p_location_id)
   order by e.first_name, e.last_name;
$$;

grant execute on function public.kiosk_record_biometric_consent(uuid, text, text, text, text) to authenticated;
grant execute on function public.revoke_biometric_consent(uuid) to authenticated;
grant execute on function public.biometric_consent_status(uuid) to authenticated;
