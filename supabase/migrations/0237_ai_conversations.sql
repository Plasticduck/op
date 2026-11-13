-- Operator AI conversation history (2026-11-13). Each person's conversations are
-- theirs alone: they can list, read, rename and delete them; ask-operator (service
-- role) writes the turns, so an answer is kept even if the page closes mid-answer.
-- Operator AI searches them (recall_conversations) to recall earlier talks.
create table if not exists public.ai_conversations (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null default 'New conversation',
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists ai_conversations_user_recent on public.ai_conversations (user_id, last_message_at desc);

create table if not exists public.ai_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null default '',
  steps           jsonb,   -- the tools it ran (what the "queries" panel shows)
  actions         jsonb,   -- choices offered / reports built, to show them again
  error           boolean not null default false,
  created_at      timestamptz not null default now(),
  search          tsvector generated always as (to_tsvector('english', coalesce(content, ''))) stored
);
create index if not exists ai_messages_conversation on public.ai_messages (conversation_id, created_at);
create index if not exists ai_messages_search on public.ai_messages using gin (search);
create index if not exists ai_messages_user on public.ai_messages (user_id, created_at desc);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

create policy ai_conversations_own_select on public.ai_conversations for select using (user_id = auth.uid());
create policy ai_conversations_own_update on public.ai_conversations for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ai_conversations_own_delete on public.ai_conversations for delete using (user_id = auth.uid());
create policy ai_messages_own_select on public.ai_messages for select using (user_id = auth.uid());

-- Only the title can be changed from the app.
revoke update on public.ai_conversations from authenticated;
grant update (title) on public.ai_conversations to authenticated;

-- Search the caller's own past messages (words, stemmed), newest-ranked first,
-- with a highlighted snippet. Falls back to a plain substring match for things
-- full-text search splits oddly (site codes, numbers). p_exclude skips the
-- current conversation.
create or replace function public.ai_search_conversations(p_query text, p_exclude uuid default null, p_limit int default 12)
returns table (conversation_id uuid, title text, message_id uuid, role text, created_at timestamptz, snippet text, rank real)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (select websearch_to_tsquery('english', coalesce(p_query, '')) as tsq),
  fts as (
    select m.conversation_id, c.title, m.id, m.role, m.created_at,
      ts_headline('english', m.content, q.tsq, 'MaxWords=40, MinWords=15, MaxFragments=2, StartSel=«, StopSel=»') as snippet,
      ts_rank(m.search, q.tsq) as rank
    from public.ai_messages m join public.ai_conversations c on c.id = m.conversation_id, q
    where m.search @@ q.tsq and m.error = false and (p_exclude is null or m.conversation_id <> p_exclude)
  ),
  plain as (
    select m.conversation_id, c.title, m.id, m.role, m.created_at,
      substr(m.content, greatest(1, strpos(lower(m.content), lower(p_query)) - 120), 320) as snippet,
      0.01::real as rank
    from public.ai_messages m join public.ai_conversations c on c.id = m.conversation_id
    where length(btrim(coalesce(p_query, ''))) >= 2 and strpos(lower(m.content), lower(btrim(p_query))) > 0
      and m.error = false and (p_exclude is null or m.conversation_id <> p_exclude)
      and not exists (select 1 from fts)
  )
  select * from (select * from fts union all select * from plain) x
  order by x.rank desc, x.created_at desc
  limit greatest(1, least(coalesce(p_limit, 12), 50))
$$;

grant execute on function public.ai_search_conversations(text, uuid, int) to authenticated;
