// Who can open Maintenance Inventory while it rolls out, by email (Kevan, 2026-11-05).
// The route and the Sidebar item (and so Cmd-K) follow this list. The database has its
// own gate: mi_members. Opening it to someone takes both, this list and a role in
// Maintenance Inventory > Settings.
export const MI_EMAILS: string[] = ['kevan@washlyfe.com', 'jjowers@mighty-wash.com']
