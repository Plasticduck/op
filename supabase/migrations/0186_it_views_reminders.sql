-- IT Inventory, Phase 1 saved views and reminders (2026-10-30).

-- ---- Saved views ---------------------------------------------------------------
-- A person's filters, columns and sort for a list, optionally shared with the
-- account. The built-in defaults (Offline now, Warranty expiring, ...) live in
-- code, not here.

create table if not exists public.it_saved_views (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade default auth.uid(),
  entity      text not null check (entity in ('asset', 'subscription', 'consumable', 'tag')),
  name        text not null check (btrim(name) <> ''),
  filters     jsonb not null default '{}'::jsonb,
  columns     jsonb not null default '[]'::jsonb,
  sort        jsonb not null default '[]'::jsonb,
  is_shared   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.users(id) on delete set null default auth.uid()
);
create index if not exists it_saved_views_idx on public.it_saved_views (account_id, entity);
create trigger it_saved_views_touch before update on public.it_saved_views
  for each row execute function public.it_touch();
alter table public.it_saved_views enable row level security;
create policy it_saved_views_select on public.it_saved_views
  for select using (account_id = auth_account_id() and (user_id = auth.uid() or is_shared));
create policy it_saved_views_insert on public.it_saved_views
  for insert with check (account_id = auth_account_id() and user_id = auth.uid());
create policy it_saved_views_update on public.it_saved_views
  for update using (account_id = auth_account_id() and (user_id = auth.uid() or (is_shared and it_is_admin())))
  with check (account_id = auth_account_id());
create policy it_saved_views_delete on public.it_saved_views
  for delete using (account_id = auth_account_id() and (user_id = auth.uid() or (is_shared and it_is_admin())));

-- ---- Reminder rules -------------------------------------------------------------------
-- recipients: { "roles": ["owner", "manager"], "user_ids": [] }. Managers get
-- reminders for their own sites only; owners for every site.

create table if not exists public.it_reminder_rules (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  kind        text not null
              check (kind in ('warranty', 'subscription_renewal', 'audit_due', 'eol', 'low_stock', 'offline', 'sticker_reprint')),
  days_before integer[] not null default '{}',
  channels    text[] not null default '{sms,email}' check (channels <@ array['sms', 'email', 'in_app']),
  recipients  jsonb not null default '{"roles": ["owner", "manager"], "user_ids": []}'::jsonb,
  -- One message per person per day summarizing everything due, instead of one per item.
  digest      boolean not null default true,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.users(id) on delete set null default auth.uid(),
  unique (account_id, kind)
);
create trigger it_reminder_rules_touch before update on public.it_reminder_rules
  for each row execute function public.it_touch();
create trigger it_reminder_rules_log after insert or update or delete on public.it_reminder_rules
  for each row execute function public.it_log('reminder_rule');
alter table public.it_reminder_rules enable row level security;
create policy it_reminder_rules_select on public.it_reminder_rules for select using (account_id = auth_account_id());
create policy it_reminder_rules_write on public.it_reminder_rules for all
  using (account_id = auth_account_id() and it_is_admin()) with check (account_id = auth_account_id() and it_is_admin());

-- Every reminder ever sent, one row per item, threshold, person and channel.
-- The unique key is what makes "exactly one reminder per threshold" true even
-- if the nightly job runs twice. Written by the it-reminders edge function.
create table if not exists public.it_reminder_sends (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  rule_id        uuid not null references public.it_reminder_rules(id) on delete cascade,
  kind           text not null,
  entity_type    text not null,
  entity_id      uuid not null,
  due_date       date not null,
  threshold_days integer not null,
  recipient_id   uuid not null references public.users(id) on delete cascade,
  channel        text not null check (channel in ('sms', 'email', 'in_app')),
  sent_at        timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  unique (rule_id, entity_id, due_date, threshold_days, recipient_id, channel)
);
alter table public.it_reminder_sends enable row level security;
create policy it_reminder_sends_select on public.it_reminder_sends
  for select using (account_id = auth_account_id() and (recipient_id = auth.uid() or it_is_admin()));
