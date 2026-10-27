-- Tayler (payroll, receives every Event Pay Request by email) can also see the full
-- request history in the app (2026-10-27). Everyone else still sees only their own
-- requests; deleting stays limited to kevan@washlyfe.com (migration 0175).
drop policy if exists event_pay_requests_select on public.event_pay_requests;
create policy event_pay_requests_select on public.event_pay_requests
  for select using (
    account_id = auth_account_id()
    and (
      submitted_by = auth.uid()
      or lower(coalesce(auth.jwt() ->> 'email', '')) in ('kevan@washlyfe.com', 'tayler@mighty-wash.com')
    )
  );
