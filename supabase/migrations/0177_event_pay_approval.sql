-- Event Pay Requests approval step (2026-10-28). A request submitted by a Regional
-- Manager goes to Garland Watson (gwatson@mighty-wash.com) for approval first; once
-- he approves it, it is emailed to payroll (Tayler). Requests from anyone else still
-- go straight to payroll. Approve / reject happen in the event-pay-request-email
-- function (service role); there are still no client updates.
alter table public.event_pay_requests
  add column if not exists needs_approval        boolean not null default false,
  -- null when no approval is needed; otherwise pending -> approved | rejected.
  add column if not exists approval_status       text check (approval_status in ('pending', 'approved', 'rejected')),
  -- When the approval email went to the approver.
  add column if not exists approval_requested_at timestamptz,
  add column if not exists decided_by            uuid references public.users(id) on delete set null,
  add column if not exists decided_by_name       text,
  add column if not exists decided_at            timestamptz,
  -- The reason given when a request is not approved.
  add column if not exists decision_note         text;

-- needs_approval is decided by the database from the submitter's category, never
-- by the client, and a new request always starts with no decision or emails.
create or replace function public.event_pay_requests_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.needs_approval := coalesce(
    (select u.role_category = 'regional_manager' from public.users u where u.id = new.submitted_by),
    false);
  new.approval_status := case when new.needs_approval then 'pending' end;
  new.approval_requested_at := null;
  new.decided_by := null;
  new.decided_by_name := null;
  new.decided_at := null;
  new.decision_note := null;
  new.emailed_at := null;
  return new;
end;
$$;

drop trigger if exists event_pay_requests_before_insert on public.event_pay_requests;
create trigger event_pay_requests_before_insert
  before insert on public.event_pay_requests
  for each row execute function public.event_pay_requests_before_insert();

-- Visibility: your own requests; Kevan and Tayler see every request; the approver
-- (Garland) also sees every request that needs approval.
drop policy if exists event_pay_requests_select on public.event_pay_requests;
create policy event_pay_requests_select on public.event_pay_requests
  for select using (
    account_id = auth_account_id()
    and (
      submitted_by = auth.uid()
      or lower(coalesce(auth.jwt() ->> 'email', '')) in ('kevan@washlyfe.com', 'tayler@mighty-wash.com')
      or (needs_approval and lower(coalesce(auth.jwt() ->> 'email', '')) = 'gwatson@mighty-wash.com')
    )
  );
