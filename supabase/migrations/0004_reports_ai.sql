-- 0004_reports_ai.sql — Reports favorites + AI insights.

create table public.saved_reports (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  created_by      uuid references public.users(id) on delete set null,
  name            text not null,
  module          text not null check (module in ('ops','people','combined')),
  report_key      text not null,           -- which standard report (e.g. 'hours')
  filters         jsonb not null default '{}',
  date_range_type text not null default '30d' check (date_range_type in ('7d','30d','90d','custom')),
  created_at      timestamptz not null default now()
);
create index on public.saved_reports (account_id);

create table public.ai_insights (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  location_id     uuid references public.locations(id) on delete cascade, -- null = cross-location
  generated_at    timestamptz not null default now(),
  category        text not null check (category in ('ops','people','financial','summary')),
  insight_text    text not null,
  severity        text not null default 'info' check (severity in ('info','warning','critical')),
  acknowledged    boolean not null default false,
  acknowledged_by uuid references public.users(id) on delete set null,
  acknowledged_at timestamptz,
  archived        boolean not null default false
);
create index on public.ai_insights (account_id, generated_at);
create index on public.ai_insights (account_id, acknowledged, archived);

-- Rate-limit ledger: one full refresh per account per hour (enforced app-side
-- against the latest row's created_at).
create table public.ai_insights_refresh_log (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index on public.ai_insights_refresh_log (account_id, created_at);
