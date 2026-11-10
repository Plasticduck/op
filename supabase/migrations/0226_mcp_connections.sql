-- Operator AI connections, one table for every provider (CoreNav, FlexWash, ...).
--
-- 0225 kept CoreNav logins in corenav_connections. FlexWash now connects the
-- same way (each person's own FlexWash login), so this generalizes it: one row
-- per (person, provider), tokens in Vault, the same service-role-only functions
-- keyed by provider. Existing CoreNav connections move over unchanged.
--
-- oauth_clients and oauth_states (0225) already have a provider column and stay.
-- corenav_status() and the corenav_tokens_* functions stay as thin wrappers so
-- anything still deployed from 0225 keeps working.

create table if not exists public.mcp_connections (
  user_id       uuid not null references public.users(id) on delete cascade,
  provider      text not null check (provider in ('corenav', 'flexwash')),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  secret_id     uuid not null,      -- vault.secrets: {access_token, refresh_token, expires_at}
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_error    text,               -- set when a refresh fails; cleared on success
  primary key (user_id, provider)
);
alter table public.mcp_connections enable row level security;
revoke all on public.mcp_connections from anon, authenticated;

insert into public.mcp_connections (user_id, provider, account_id, secret_id, connected_at, updated_at, last_error)
select user_id, 'corenav', account_id, secret_id, connected_at, updated_at, last_error from public.corenav_connections
on conflict (user_id, provider) do nothing;

-- ---- Service role only ----

create or replace function public.mcp_tokens_get(p_user uuid, p_provider text)
returns jsonb language sql security definer set search_path = public as $$
  select (select decrypted_secret from vault.decrypted_secrets where id = c.secret_id)::jsonb
         || jsonb_build_object('connected_at', c.connected_at)
  from public.mcp_connections c where c.user_id = p_user and c.provider = p_provider
$$;

create or replace function public.mcp_tokens_save(p_user uuid, p_provider text, p_tokens jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  existing uuid;
  acct     uuid;
begin
  select account_id into acct from public.users where id = p_user;
  if acct is null then
    raise exception 'Unknown user';
  end if;
  select secret_id into existing from public.mcp_connections where user_id = p_user and provider = p_provider;
  if existing is null then
    insert into public.mcp_connections (user_id, provider, account_id, secret_id)
    values (p_user, p_provider, acct, vault.create_secret(p_tokens::text, p_provider || '_' || p_user || '_' || gen_random_uuid()));
  else
    perform vault.update_secret(existing, p_tokens::text);
    update public.mcp_connections set updated_at = now(), last_error = null where user_id = p_user and provider = p_provider;
  end if;
end $$;

-- A new sign-in replaces the old one: keep the row, reset connected_at.
create or replace function public.mcp_tokens_connect(p_user uuid, p_provider text, p_tokens jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.mcp_tokens_save(p_user, p_provider, p_tokens);
  update public.mcp_connections set connected_at = now(), last_error = null where user_id = p_user and provider = p_provider;
end $$;

create or replace function public.mcp_set_error(p_user uuid, p_provider text, p_error text)
returns void language sql security definer set search_path = public as $$
  update public.mcp_connections set last_error = left(p_error, 500), updated_at = now()
   where user_id = p_user and provider = p_provider
$$;

create or replace function public.mcp_tokens_delete(p_user uuid, p_provider text)
returns void language plpgsql security definer set search_path = public as $$
declare
  existing uuid;
begin
  delete from public.mcp_connections where user_id = p_user and provider = p_provider returning secret_id into existing;
  if existing is not null then
    delete from vault.secrets where id = existing;
  end if;
end $$;

revoke execute on function public.mcp_tokens_get(uuid, text), public.mcp_tokens_save(uuid, text, jsonb),
  public.mcp_tokens_connect(uuid, text, jsonb), public.mcp_set_error(uuid, text, text), public.mcp_tokens_delete(uuid, text)
  from public, anon, authenticated;
grant execute on function public.mcp_tokens_get(uuid, text), public.mcp_tokens_save(uuid, text, jsonb),
  public.mcp_tokens_connect(uuid, text, jsonb), public.mcp_set_error(uuid, text, text), public.mcp_tokens_delete(uuid, text)
  to service_role;

-- ---- The person themself ----

-- Which providers the signed-in person has connected. Never returns tokens.
create or replace function public.mcp_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'corenav', coalesce((select jsonb_build_object('connected', true, 'connected_at', c.connected_at, 'needs_reconnect', c.last_error is not null)
                           from public.mcp_connections c where c.user_id = auth.uid() and c.provider = 'corenav'), '{"connected": false}'::jsonb),
    'flexwash', coalesce((select jsonb_build_object('connected', true, 'connected_at', c.connected_at, 'needs_reconnect', c.last_error is not null)
                           from public.mcp_connections c where c.user_id = auth.uid() and c.provider = 'flexwash'), '{"connected": false}'::jsonb))
$$;
revoke execute on function public.mcp_status() from public, anon;
grant execute on function public.mcp_status() to authenticated;

-- ---- 0225 names, now over mcp_connections ----

create or replace function public.corenav_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select public.mcp_status()->'corenav'
$$;
create or replace function public.corenav_tokens_get(p_user uuid)
returns jsonb language sql security definer set search_path = public as $$ select public.mcp_tokens_get(p_user, 'corenav') $$;
create or replace function public.corenav_tokens_save(p_user uuid, p_tokens jsonb)
returns void language sql security definer set search_path = public as $$ select public.mcp_tokens_save(p_user, 'corenav', p_tokens) $$;
create or replace function public.corenav_tokens_connect(p_user uuid, p_tokens jsonb)
returns void language sql security definer set search_path = public as $$ select public.mcp_tokens_connect(p_user, 'corenav', p_tokens) $$;
create or replace function public.corenav_set_error(p_user uuid, p_error text)
returns void language sql security definer set search_path = public as $$ select public.mcp_set_error(p_user, 'corenav', p_error) $$;
create or replace function public.corenav_tokens_delete(p_user uuid)
returns void language sql security definer set search_path = public as $$ select public.mcp_tokens_delete(p_user, 'corenav') $$;

-- The rows live in mcp_connections now.
drop table public.corenav_connections;
