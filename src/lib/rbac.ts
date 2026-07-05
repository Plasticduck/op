export type Role = 'owner' | 'manager' | 'employee' | 'technician'

// The `owner` role is labeled "Admin" in the UI. The internal key stays `owner`
// (used throughout RLS policies and role checks); only the display name changed.
export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Admin',
  manager: 'Manager',
  employee: 'Employee',
  technician: 'Technician',
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
