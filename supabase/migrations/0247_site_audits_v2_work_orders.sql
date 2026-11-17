-- Site Audit NEW: the site's work orders that were open in MaintainX when the
-- audit was sent, kept on the audit for its PDF and report page. Saved once by
-- site-audit-new-notify (service role) right after submit: { site, matched,
-- locations, workOrders[], fetchedAt } from MaintainX, or { error, fetchedAt }
-- when MaintainX couldn't be reached. Null on older audits and other accounts.

alter table public.site_audits_v2 add column work_orders jsonb;
