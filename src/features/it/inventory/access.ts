// Who can open IT Inventory while it rolls out, by email (Kevan, 2026-10-30).
// The routes, the Sidebar item (and so Cmd-K, the dashboard tiles and the
// sticker landing page) follow this list. Reminders go to exactly these
// people: supabase/functions/it-reminders keeps the same list as
// ACCESS_EMAILS, so change both together.
export const IT_INVENTORY_EMAILS: string[] = [
  'kevan@washlyfe.com',
  'jjowers@mighty-wash.com',
  'ncarter@mighty-wash.com',
  'blake@mighty-wash.com',
  'nkerstell@mighty-wash.com',
]
