-- Event Pay Requests history is private to each submitter (2026-10-27). Previously
-- every account owner could see all requests; now a user sees only the requests
-- they submitted, and only kevan@washlyfe.com sees every submission. Deleting a
-- request is likewise limited to that single admin.
drop policy if exists event_pay_requests_select on public.event_pay_requests;
create policy event_pay_requests_select on public.event_pay_requests
  for select using (
    account_id = auth_account_id()
    and (
      submitted_by = auth.uid()
      or lower(coalesce(auth.jwt() ->> 'email', '')) = 'kevan@washlyfe.com'
    )
  );

drop policy if exists event_pay_requests_delete on public.event_pay_requests;
create policy event_pay_requests_delete on public.event_pay_requests
  for delete using (
    account_id = auth_account_id()
    and lower(coalesce(auth.jwt() ->> 'email', '')) = 'kevan@washlyfe.com'
  );
