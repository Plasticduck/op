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
  opts?: {
    rolePerms?: PagePermissions | null
    userId?: string | null
    userPerms?: UserPermissions | null
    // Roles for which this page/section is grantable but defaults to OFF, so an
    // admin must explicitly enable it (per role or per person).
    optInRoles?: Role[]
  },
): boolean {
  if (!builtinRoles.includes(role)) return false
  if (role === 'owner') return true
  const u = opts?.userId ? opts.userPerms?.[opts.userId]?.[to] : undefined
  if (typeof u === 'boolean') return u
  const r = opts?.rolePerms?.[role]?.[to]
  if (typeof r === 'boolean') return r
  return !opts?.optInRoles?.includes(role)
}

// Toggleable sections within a page. `key` is stored in the same permission maps
// as pages (so it flows through role + user layering via pageAllowed). `page` is
// the owning nav item's `to`; `roles` mirror that page's roles. To add a section:
// add an entry here and call useSectionAllowed(key) where the section renders.
export type SectionDef = { key: string; page: string; label: string; roles: Role[]; optIn?: Role[] }

export const SECTION_CATALOG: SectionDef[] = [
  { key: '/app/inventory#catalog', page: '/app/inventory', label: 'Catalog tab', roles: ['owner', 'manager', 'technician'] },
  { key: '/app/inventory#counts', page: '/app/inventory', label: 'Counts tab', roles: ['owner', 'manager', 'technician'] },
  { key: '/app/inventory#sessions', page: '/app/inventory', label: 'Saved Counts tab', roles: ['owner', 'manager', 'technician'] },
  // Regional quarterly bonuses stay owner-only (managers get GM/AGM only).
  { key: '/app/bonuses#regional', page: '/app/bonuses', label: 'Regional Manager Quarterly Bonuses', roles: ['owner'] },
]

export function sectionsForPage(page: string): SectionDef[] {
  return SECTION_CATALOG.filter((s) => s.page === page)
}
