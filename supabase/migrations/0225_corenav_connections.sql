-- CoreNav for Operator AI: each person connects their own CoreNav login.
--
-- CoreNav (expand.corenav.ai) has an MCP server behind OAuth. A person taps
-- "Connect to CoreNav" in Operator AI, signs in on CoreNav, and comes back; the
-- corenav-oauth function swaps the code for tokens and keeps them here. When
-- they ask Operator AI something, ask-operator uses their token, so they only
-- ever see what their own CoreNav login can see.
--
-- Nothing here is readable from the app. Tokens and Operator's OAuth client
-- secret live in Vault; the tables hold only Vault ids. Only the service role
-- (the edge functions) can call the token functions. A person can see whether
-- they're connected through corenav_status().

-- Operator's registration with an OAuth provider (CoreNav registers clients on
-- request, so the function does it once and keeps the result).
create table if not exists public.oauth_clients (
  provider       text primary key,
  client_id      text not null,
  secret_id      uuid,               -- vault.secrets: the client secret
  redirect_uris  text[] not null,
  registered_at  timestamptz not null default now()
);
alter table public.oauth_clients enable row level security;
revoke all on public.oauth_clients from anon, authenticated;

-- Sign-ins in progress: PKCE verifier, tied to the person, used once.
create table if not exists public.oauth_states (
  state          text primary key,
  provider       text not null,
  user_id        uuid not null references public.users(id) on delete cascade,
  code_verifier  text not null,
  redirect_uri   text not null,
  created_at     timestamptz not null default now()
);
alter table public.oauth_states enable row level security;
revoke all on public.oauth_states from anon, authenticated;

create table if not exists public.corenav_connections (
  user_id       uuid primary key references public.users(id) on delete cascade,
  account_id    uuid not null references public.accounts(id) on delete cascade,
  secret_id     uuid not null,      -- vault.secrets: {access_token, refresh_token, expires_at}
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_error    text                -- set when a refresh fails; cleared on success
);
alter table public.corenav_connections enable row level security;
revoke all on public.corenav_connections from anon, authenticated;

-- ---- Service role only ----

create or replace function public.oauth_client_get(p_provider text)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'client_id', c.client_id,
    'client_secret', (select decrypted_secret from vault.decrypted_secrets where id = c.secret_id),
    'redirect_uris', to_jsonb(c.redirect_uris))
  from public.oauth_clients c where c.provider = p_provider
$$;

create or replace function public.oauth_client_save(p_provider text, p_client_id text, p_client_secret text, p_redirect_uris text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  old_secret uuid;
  new_secret uuid;
begin
  select secret_id into old_secret from public.oauth_clients where provider = p_provider;
  if p_client_secret is not null and p_client_secret <> '' then
    new_secret := vault.create_secret(p_client_secret, 'oauth_client_' || p_provider || '_' || gen_random_uuid());
  end if;
  insert into public.oauth_clients (provider, client_id, secret_id, redirect_uris, registered_at)
  values (p_provider, p_client_id, new_secret, p_redirect_uris, now())
  on conflict (provider) do update
    set client_id = excluded.client_id, secret_id = excluded.secret_id,
        redirect_uris = excluded.redirect_uris, registered_at = now();
  if old_secret is not null then
    delete from vault.secrets where id = old_secret;
  end if;
end $$;

create or replace function public.corenav_tokens_get(p_user uuid)
returns jsonb language sql security definer set search_path = public as $$
  select (select decrypted_secret from vault.decrypted_secrets where id = c.secret_id)::jsonb
         || jsonb_build_object('connected_at', c.connected_at)
  from public.corenav_connections c where c.user_id = p_user
$$;

create or replace function public.corenav_tokens_save(p_user uuid, p_tokens jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  existing uuid;
  acct     uuid;
begin
  select account_id into acct from public.users where id = p_user;
  if acct is null then
    raise exception 'Unknown user';
  end if;
  select secret_id into existing from public.corenav_connections where user_id = p_user;
  if existing is null then
    insert into public.corenav_connections (user_id, account_id, secret_id)
    values (p_user, acct, vault.create_secret(p_tokens::text, 'corenav_' || p_user || '_' || gen_random_uuid()));
  else
    perform vault.update_secret(existing, p_tokens::text);
    update public.corenav_connections set updated_at = now(), last_error = null where user_id = p_user;
  end if;
end $$;

-- A new sign-in replaces the old one: keep the row, reset connected_at.
create or replace function public.corenav_tokens_connect(p_user uuid, p_tokens jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.corenav_tokens_save(p_user, p_tokens);
  update public.corenav_connections set connected_at = now(), last_error = null where user_id = p_user;
end $$;

create or replace function public.corenav_set_error(p_user uuid, p_error text)
returns void language sql security definer set search_path = public as $$
  update public.corenav_connections set last_error = left(p_error, 500), updated_at = now() where user_id = p_user
$$;

create or replace function public.corenav_tokens_delete(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  existing uuid;
begin
  delete from public.corenav_connections where user_id = p_user returning secret_id into existing;
  if existing is not null then
    delete from vault.secrets where id = existing;
  end if;
end $$;

revoke execute on function public.oauth_client_get(text), public.oauth_client_save(text, text, text, text[]),
  public.corenav_tokens_get(uuid), public.corenav_tokens_save(uuid, jsonb), public.corenav_tokens_connect(uuid, jsonb),
  public.corenav_set_error(uuid, text), public.corenav_tokens_delete(uuid) from public, anon, authenticated;
grant execute on function public.oauth_client_get(text), public.oauth_client_save(text, text, text, text[]),
  public.corenav_tokens_get(uuid), public.corenav_tokens_save(uuid, jsonb), public.corenav_tokens_connect(uuid, jsonb),
  public.corenav_set_error(uuid, text), public.corenav_tokens_delete(uuid) to service_role;

-- ---- The person themself ----

-- Whether the signed-in person has CoreNav connected. Never returns tokens.
create or replace function public.corenav_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('connected', true, 'connected_at', c.connected_at, 'needs_reconnect', c.last_error is not null)
       from public.corenav_connections c where c.user_id = auth.uid()),
    jsonb_build_object('connected', false))
$$;
revoke execute on function public.corenav_status() from public, anon;
grant execute on function public.corenav_status() to authenticated;
