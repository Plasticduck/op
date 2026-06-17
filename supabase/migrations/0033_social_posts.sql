-- 0033_social_posts.sql
-- Social media calendar: per-account planned posts tied to a date (and
-- optionally a holiday id from the curated list in src/lib/social/holidays.ts).
-- AI-generated drafts are stored here too; status flips from draft -> scheduled
-- -> posted as the team works through them.

create table public.social_posts (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  post_date    date not null,
  holiday_id   text,
  platform     text,
  status       text not null default 'draft'
               check (status in ('draft','scheduled','posted')),
  title        text,
  body         text,
  notes        text,
  ai_generated boolean not null default false,
  model        text,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.social_posts (account_id, post_date);

alter table public.social_posts enable row level security;

create policy social_posts_select on public.social_posts for select
  using (account_id = public.auth_account_id());
create policy social_posts_insert on public.social_posts for insert
  with check (account_id = public.auth_account_id() and public.auth_is_manager_plus());
create policy social_posts_update on public.social_posts for update
  using (account_id = public.auth_account_id() and public.auth_is_manager_plus())
  with check (account_id = public.auth_account_id() and public.auth_is_manager_plus());
create policy social_posts_delete on public.social_posts for delete
  using (account_id = public.auth_account_id() and public.auth_is_manager_plus());
