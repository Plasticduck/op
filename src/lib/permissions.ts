import type { Role } from '@/lib/rbac'

// Per-account page access, edited by admins on the Team page. Keyed by role (or
// user id), then by the nav item's `to` path, to a boolean. Everything is bounded
// to the role's built-in pages, so overrides can never grant access beyond a
// role's defaults (keeps it in step with row-level security). The owner (Admin)
// is never restricted, so an admin can't lock themselves out.
//
// Layering for a non-owner: a per-user override wins; otherwise the per-role
// override; otherwise the built-in default (available).
export type PagePermissions = Record<string, Record<string, boolean>>
export type UserPermissions = Record<string, Record<string, boolean>>

export function pageAllowed(
  role: Role,
  to: string,
  builtinRoles: Role[],
  opts?: { rolePerms?: PagePermissions | null; userId?: string | null; userPerms?: UserPermissions | null },
): boolean {
  if (!builtinRoles.includes(role)) return false
  if (role === 'owner') return true
  const u = opts?.userId ? opts.userPerms?.[opts.userId]?.[to] : undefined
  if (typeof u === 'boolean') return u
  return opts?.rolePerms?.[role]?.[to] !== false
}
