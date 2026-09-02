-- 0137_downtime_delete_kjowers.sql — allow kjowers@mighty-wash.com to delete
-- downtime log entries, in addition to the account owner (Admin). Everyone else
-- keeps read/create/update only.

drop policy if exists downtime_events_delete on public.downtime_events;
create policy downtime_events_delete on public.downtime_events for delete
  using (
    public.auth_has_location(location_id)
    and (
      public.auth_role() = 'owner'
      or lower(coalesce(auth.jwt() ->> 'email', '')) = 'kjowers@mighty-wash.com'
    )
  );
