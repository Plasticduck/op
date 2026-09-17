-- Signage order tracker: statuses become Ordered / Shipped / Completed, with a
-- tracking number (shown to the requester when Shipped). The tracker UI (status
-- editing) is limited to kevan@washlyfe.com; requesters see the current status.
alter table public.signage_requests add column if not exists tracking_number text;
alter table public.signage_requests add column if not exists status_updated_at timestamptz;
alter table public.signage_requests alter column status set default 'ordered';
update public.signage_requests set status = 'ordered' where status is null or status = 'pending';
