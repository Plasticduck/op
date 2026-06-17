-- 0035_messaging_attachments_push.sql
--
-- 1) Image attachments on messages.
--    attachment_path is the storage path inside the message-attachments bucket.
--    attachment_type is the MIME type ('image/jpeg', etc.).
-- 2) Web Push subscriptions per user/device.
-- 3) Storage bucket + RLS for message attachments. Bucket is private; the
--    client fetches signed URLs at read time.

alter table public.messages
  add column attachment_path text,
  add column attachment_type text;

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz,
  unique (user_id, endpoint)
);
create index on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy push_subs_select on public.push_subscriptions for select
  using (user_id = auth.uid());
create policy push_subs_insert on public.push_subscriptions for insert
  with check (user_id = auth.uid());
create policy push_subs_update on public.push_subscriptions for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy push_subs_delete on public.push_subscriptions for delete
  using (user_id = auth.uid());

-- ---- Storage bucket for message attachments ------------------------------
-- Private bucket; the path is `{conversation_id}/{uuid}.{ext}`. Read is gated
-- on conversation membership; writes are by authenticated users into their own
-- conversation. Realistic attachment size cap of 8 MB.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('message-attachments', 'message-attachments', false, 8 * 1024 * 1024,
        array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'])
on conflict (id) do nothing;

create policy "message attachments read for members" on storage.objects for select
  using (
    bucket_id = 'message-attachments'
    and public.auth_in_conversation((storage.foldername(name))[1]::uuid)
  );

create policy "message attachments insert for members" on storage.objects for insert
  with check (
    bucket_id = 'message-attachments'
    and public.auth_in_conversation((storage.foldername(name))[1]::uuid)
  );

create policy "message attachments delete for owner" on storage.objects for delete
  using (
    bucket_id = 'message-attachments'
    and owner = auth.uid()
  );

-- ---- Relax messages.body so an image-only message is allowed -------------
alter table public.messages alter column body drop not null;
alter table public.messages add constraint messages_has_content
  check (coalesce(nullif(body, ''), null) is not null or attachment_path is not null);
