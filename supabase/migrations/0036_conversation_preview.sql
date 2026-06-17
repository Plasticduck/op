-- 0036_conversation_preview.sql
-- Cache the most recent message preview on conversations so the list view can
-- render WhatsApp/GroupMe-style rows ("Sarah: thanks!") without N+1 queries.
--
-- We bump these on every new message via the existing trigger, and backfill
-- using the current latest-message-per-conversation.

alter table public.conversations
  add column last_message_preview text,
  add column last_message_sender_id uuid references public.users(id) on delete set null;

create or replace function public.bump_conversation_last_message()
returns trigger
language plpgsql
as $$
begin
  update public.conversations
     set last_message_at = new.created_at,
         last_message_preview = case
           when new.attachment_path is not null and coalesce(nullif(new.body, ''), null) is null then '[image]'
           else substring(new.body for 200)
         end,
         last_message_sender_id = new.sender_id
   where id = new.conversation_id;
  return new;
end;
$$;

-- Backfill from the latest message per conversation.
with latest as (
  select distinct on (conversation_id)
    conversation_id, body, attachment_path, sender_id, created_at
  from public.messages
  order by conversation_id, created_at desc
)
update public.conversations c
   set last_message_preview = case
         when l.attachment_path is not null and coalesce(nullif(l.body, ''), null) is null then '[image]'
         else substring(l.body for 200)
       end,
       last_message_sender_id = l.sender_id,
       last_message_at = coalesce(c.last_message_at, l.created_at)
  from latest l
 where l.conversation_id = c.id;
