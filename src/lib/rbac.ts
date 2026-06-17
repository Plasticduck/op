export type Role = 'owner' | 'manager' | 'employee'

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  manager: 'Manager',
  employee: 'Employee',
}

export function isRole(value: unknown): value is Role {
  return value === 'owner' || value === 'manager' || value === 'employee'
}

export function canAccess(role: Role, allowed: Role[]): boolean {
  return allowed.includes(role)
}

const HIERARCHY: Record<Role, number> = { owner: 3, manager: 2, employee: 1 }

export function atLeast(role: Role, min: Role): boolean {
  return HIERARCHY[role] >= HIERARCHY[min]
}
