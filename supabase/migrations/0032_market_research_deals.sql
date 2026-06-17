-- 0032_market_research_deals.sql
--
-- Expand Market Research into a deals + counter-strategy workflow. The
-- competitor tracker (migration 0029) is being removed from the UI; the tables
-- (competitors / competitor_snapshots / competitor_suggestions) stay in place
-- so historical rows aren't lost, but no UI references them after this change.
--
-- New tables:
--  - market_research_deals: each promotional offer a manager has observed at a
--    competitor (e.g. "Unlimited monthly $19.99"). Attached attachments use
--    ops_attachments with entity_type='market_research_deal'.
--  - market_research_suggestions: Claude-generated counter-strategy text per
--    research record, with severity and acknowledgement tracking. Mirrors the
--    shape of the (now-deprecated) competitor_suggestions table.

create table public.market_research_deals (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts(id) on delete cascade,
  market_research_id   uuid not null references public.market_research(id) on delete cascade,
  title                text not null,
  offer_type           text,
  price                numeric,
  expires_at           date,
  details              text,
  source_url           text,
  created_by           uuid references public.users(id) on delete set null,
  created_at           timestamptz not null default now()
);
create index on public.market_research_deals (market_research_id, created_at desc);
create index on public.market_research_deals (account_id);

create table public.market_research_suggestions (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  market_research_id  uuid not null references public.market_research(id) on delete cascade,
  severity            text not null default 'info' check (severity in ('info','warning','critical')),
  suggestion_text     text not null,
  model               text,
  generated_at        timestamptz not null default now(),
  acknowledged_at     timestamptz,
  acknowledged_by     uuid references public.users(id) on delete set null
);
create index on public.market_research_suggestions (market_research_id, generated_at desc);
create index on public.market_research_suggestions (account_id);

alter table public.market_research_deals enable row level security;
alter table public.market_research_suggestions enable row level security;

create policy mr_deals_select on public.market_research_deals for select
  using (account_id = public.auth_account_id());
create policy mr_deals_insert on public.market_research_deals for insert
  with check (account_id = public.auth_account_id() and public.auth_is_manager_plus());
create policy mr_deals_update on public.market_research_deals for update
  using (account_id = public.auth_account_id() and public.auth_is_manager_plus())
  with check (account_id = public.auth_account_id() and public.auth_is_manager_plus());
create policy mr_deals_delete on public.market_research_deals for delete
  using (account_id = public.auth_account_id() and public.auth_is_manager_plus());

create policy mr_sugg_select on public.market_research_suggestions for select
  using (account_id = public.auth_account_id());
create policy mr_sugg_insert on public.market_research_suggestions for insert
  with check (account_id = public.auth_account_id() and public.auth_is_manager_plus());
create policy mr_sugg_update on public.market_research_suggestions for update
  using (account_id = public.auth_account_id() and public.auth_is_manager_plus())
  with check (account_id = public.auth_account_id() and public.auth_is_manager_plus());
create policy mr_sugg_delete on public.market_research_suggestions for delete
  using (account_id = public.auth_account_id() and public.auth_role() = 'owner');
