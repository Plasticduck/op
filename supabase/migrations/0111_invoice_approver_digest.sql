-- Daily approver digest source. Returns the invoices assigned to an approver in
-- the 24h window ending at TODAY 5pm America/Chicago (i.e. everything routed for
-- approval since the previous day's 5pm). Anything assigned at/after 5pm falls
-- into the next day's window. Powers the daily-approver-digest email, which
-- replaced the per-assignment notify-invoice-assignment email.
--
-- The 5pm boundary is computed in SQL so it is exact and DST-correct (no drift
-- from when the cron actually fires). SECURITY DEFINER + service_role only.
create or replace function public.invoice_approver_digest()
returns setof public.ops_invoices
language sql
security definer
set search_path = public
as $$
  with b as (
    select ((date_trunc('day', now() at time zone 'America/Chicago') + interval '17 hours')
              at time zone 'America/Chicago') as five_pm
  )
  select i.*
  from public.ops_invoices i, b
  where i.status = 'assigned'
    and i.assigned_at is not null
    and i.assigned_at >= b.five_pm - interval '24 hours'
    and i.assigned_at <  b.five_pm
    and coalesce(array_length(i.approver_ids, 1), 0) > 0
$$;

revoke all on function public.invoice_approver_digest() from public, authenticated;
grant execute on function public.invoice_approver_digest() to service_role;
