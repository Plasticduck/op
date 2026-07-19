import type { Role } from '@/lib/rbac'

// Per-account page access, edited by admins on the Team page. Restrict-only:
// an entry can turn OFF a page a role would otherwise see, never grant one beyond
// the role's built-in access. Keyed by role, then by the nav item's `to` path.
// A missing entry means "use the default" (available). The owner (Admin) is never
// restricted, so an admin can't lock themselves out.
export type PagePermissions = Record<string, Record<string, boolean>>

export function pageAllowed(
  role: Role,
  to: string,
  builtinRoles: Role[],
  perms?: PagePermissions | null,
): boolean {
  if (!builtinRoles.includes(role)) return false
  if (role === 'owner') return true
  return perms?.[role]?.[to] !== false
}
