export type Role = 'owner' | 'manager' | 'employee' | 'technician'

// "User categories" layered on the manager role. At the DB/RLS level a Regional
// Manager / Executive IS a manager (so they inherit exactly a manager's access);
// the category only gates the deltas (Bonuses, Invoice Approval) and the label.
export type RoleCategory = 'regional_manager' | 'executive'

// The effective role used by the permission/nav layer: the category when set,
// otherwise the base role. RLS and the DB always use the base Role.
export type PermRole = Role | RoleCategory

// The `owner` role is labeled "Admin" in the UI. The internal key stays `owner`
// (used throughout RLS policies and role checks); only the display name changed.
export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Admin',
  manager: 'Manager',
  employee: 'Employee',
  technician: 'Technician',
}

export const CATEGORY_LABEL: Record<RoleCategory, string> = {
  regional_manager: 'Regional Manager',
  executive: 'Executive',
}

// The effective permission role (category wins over the base manager role).
export function permRole(role: Role, category?: RoleCategory | null): PermRole {
  return category ?? role
}

// Human label for a user, preferring their category over the base role.
export function displayRole(role: Role, category?: RoleCategory | null): string {
  return category ? CATEGORY_LABEL[category] : ROLE_LABEL[role]
}

export function isRole(value: unknown): value is Role {
  return (
    value === 'owner' ||
    value === 'manager' ||
    value === 'employee' ||
    value === 'technician'
  )
}

export function canAccess(role: Role, allowed: Role[]): boolean {
  return allowed.includes(role)
}

// Technician sits alongside employee on the ladder: it's a specialized cross-site
// maintenance role, not a rung above manager. atLeast() is the only consumer and
// is used for coarse "manager or higher" gates, so technician ranks with employee.
const HIERARCHY: Record<Role, number> = { owner: 3, manager: 2, employee: 1, technician: 1 }

export function atLeast(role: Role, min: Role): boolean {
  return HIERARCHY[role] >= HIERARCHY[min]
}
