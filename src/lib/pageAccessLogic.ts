import type { PermRole } from '@/lib/rbac'
import type { PageAccessRow } from '@/lib/queries/pageAccess'

// The super admin can grant or block any page for anyone (page_access, migration
// 0241) and is never blocked. Kept in step with auth_is_super_admin() in SQL.
export const SUPER_ADMIN_EMAIL = 'kevan@washlyfe.com'

export function isSuperAdmin(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === SUPER_ADMIN_EMAIL
}

// The super admin's explicit setting for a page and person: their own row, else
// their role's row, else undefined (fall back to the usual rules). Pass
// skipUser to get what the person would have without their own row.
export function pageOverride(
  rows: PageAccessRow[],
  person: { id: string; email?: string | null },
  role: PermRole,
  page: string,
  opts?: { skipUser?: boolean },
): boolean | undefined {
  if (isSuperAdmin(person.email)) return undefined
  if (!opts?.skipUser) {
    const own = rows.find((r) => r.user_id === person.id && r.page === page)
    if (own) return own.allowed
  }
  const byRole = rows.find((r) => r.perm_role === role && r.page === page)
  return byRole ? byRole.allowed : undefined
}

// The role-level setting alone (for the role editor).
export function roleOverride(rows: PageAccessRow[], role: PermRole, page: string): boolean | undefined {
  const r = rows.find((x) => x.perm_role === role && x.page === page)
  return r ? r.allowed : undefined
}
