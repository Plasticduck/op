-- Site Audit NEW: when the submitted audit was emailed and texted, and what
-- happened, so a retry or a second call never sends it twice. Written only by the
-- site-audit-new-notify function (service role); the app's update rule already
-- stops anyone changing a submitted audit.

alter table public.site_audits_v2
  add column notified_at timestamptz,
  add column notify_result jsonb;
