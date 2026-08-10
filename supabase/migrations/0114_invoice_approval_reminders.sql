-- 48-hour approval reminders. When an invoice has sat in an approver's queue
-- (status='assigned') for 48h without being approved, the invoice-approval-reminder
-- edge function nudges the current approver(s). reminder_sent_at throttles it so an
-- approver is reminded at most once per 48h per assignment. assigned_at is reset on
-- (re)assignment and on the secondary-approval handoff, so each holder gets their
-- own fresh 48h clock.
alter table public.ops_invoices add column if not exists reminder_sent_at timestamptz;

create or replace function public.invoice_approver_reminders()
returns setof public.ops_invoices
language sql
security definer
set search_path = public
as $$
  select i.*
  from public.ops_invoices i
  where i.status = 'assigned'
    and i.assigned_at is not null
    and i.assigned_at <= now() - interval '48 hours'
    and (i.reminder_sent_at is null or i.reminder_sent_at <= now() - interval '48 hours')
    and coalesce(array_length(i.approver_ids, 1), 0) > 0
$$;

revoke all on function public.invoice_approver_reminders() from public, authenticated;
grant execute on function public.invoice_approver_reminders() to service_role;
