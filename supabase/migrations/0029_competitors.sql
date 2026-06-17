-- 0029_competitors.sql
-- Competitor Tracker: a per-account list of competitor washes with their URLs,
-- a snapshot history of what we harvested from each source, and AI-generated
-- suggestions comparing the competitor to the account's own wash data.
-- Scanning is done by the `fetch-competitor-data` edge function; UI manual
-- "Scan now" plus a daily pg_cron schedule.

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  name text not null,
  website_url text,
  facebook_url text,
  instagram_url text,
  x_url text,
  notes text,
  last_scanned_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.competitors (account_id, created_at desc);

-- One row per (competitor, source) scan attempt. Both successes and failures
-- are recorded so the UI can show "Instagram blocked us — most likely needs a
-- paid scraper or a public page" rather than silently dropping the attempt.
create table public.competitor_snapshots (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  source text not null check (source in ('website','facebook','instagram','x')),
  status text not null check (status in ('ok','blocked','error','no_url')),
  data jsonb,
  error_message text,
  fetched_at timestamptz not null default now()
);
create index on public.competitor_snapshots (competitor_id, fetched_at desc);

create table public.competitor_suggestions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  competitor_id uuid references public.competitors(id) on delete cascade,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  suggestion_text text not null,
  model text,
  generated_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.users(id) on delete set null
);
create index on public.competitor_suggestions (account_id, generated_at desc);

-- RLS: account members read; manager+ write; owner delete. Matches the
-- pattern used by 0020/0021/0022.
do $$
declare t text;
begin
  foreach t in array array['competitors','competitor_snapshots','competitor_suggestions'] loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

create policy competitors_select on public.competitors for select
  using (account_id = public.auth_account_id());
create policy competitors_insert on public.competitors for insert
  with check (account_id = public.auth_account_id() and public.auth_is_manager_plus());
create policy competitors_update on public.competitors for update
  using (account_id = public.auth_account_id() and public.auth_is_manager_plus())
  with check (account_id = public.auth_account_id() and public.auth_is_manager_plus());
create policy competitors_delete on public.competitors for delete
  using (account_id = public.auth_account_id() and public.auth_role() = 'owner');

-- Snapshots inherit account scope via the competitor join. Read-allow to all
-- account members, write reserved to manager+ via the snapshots being created
-- only by the edge function (service role bypasses RLS anyway, but the
-- policies still constrain direct REST attempts).
create policy snapshots_select on public.competitor_snapshots for select
  using (exists (
    select 1 from public.competitors c
    where c.id = competitor_id and c.account_id = public.auth_account_id()
  ));
create policy snapshots_insert on public.competitor_snapshots for insert
  with check (exists (
    select 1 from public.competitors c
    where c.id = competitor_id and c.account_id = public.auth_account_id() and public.auth_is_manager_plus()
  ));
create policy snapshots_delete on public.competitor_snapshots for delete
  using (exists (
    select 1 from public.competitors c
    where c.id = competitor_id and c.account_id = public.auth_account_id() and public.auth_role() = 'owner'
  ));

create policy suggestions_select on public.competitor_suggestions for select
  using (account_id = public.auth_account_id());
create policy suggestions_insert on public.competitor_suggestions for insert
  with check (account_id = public.auth_account_id() and public.auth_is_manager_plus());
create policy suggestions_update on public.competitor_suggestions for update
  using (account_id = public.auth_account_id() and public.auth_is_manager_plus())
  with check (account_id = public.auth_account_id() and public.auth_is_manager_plus());
create policy suggestions_delete on public.competitor_suggestions for delete
  using (account_id = public.auth_account_id() and public.auth_role() = 'owner');
