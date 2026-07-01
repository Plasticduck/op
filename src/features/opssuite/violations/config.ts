// Department + violation-type taxonomy and the region -> site grouping for the
// Violations feature. Regions map to the account's locations by name.

export const DEPARTMENTS = [
  'Operations',
  'Safety',
  'Accounting',
  'Human Resources',
  'IT',
] as const
export type Department = (typeof DEPARTMENTS)[number]

// Note types (violation types) available per department.
export const VIOLATION_TYPES: Record<Department, string[]> = {
  Operations: [
    'Order Placing Violation',
    'Over Budget Violation',
    'Site Appearance Violation',
    'Procedural Violation',
    'Other',
  ],
  Safety: [
    'PPE Violation',
    'Preventable Accident Violation',
    'Training Violation',
    'Safety Protocol Violation',
    'Other',
  ],
  Accounting: [
    'Cash Count/GSR Violation',
    'KPI Sheet Violation',
    'Company Card Violation',
    'Expense Report Violation',
    'Other',
  ],
  'Human Resources': [
    'Payroll Violation',
    'Onboarding Violation',
    'Timepunch Errors Violation',
    'Other',
  ],
  IT: [
    'Improper/Lack of Ticket Submission Violation',
    'Misuse of Equipment Violation',
    'Compliance Violation',
    'Other',
  ],
}

// Flat, de-duplicated list of every violation type (dashboard filter).
export const ALL_VIOLATION_TYPES: string[] = (() => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const d of DEPARTMENTS) {
    for (const t of VIOLATION_TYPES[d]) {
      if (!seen.has(t)) {
        seen.add(t)
        out.push(t)
      }
    }
  }
  return out
})()

// Accent color per department (stat-card top bar).
export const DEPARTMENT_COLOR: Record<string, string> = {
  Total: '#9aa3b1',
  Operations: '#f59e0b',
  Safety: '#2563eb',
  Accounting: '#dc2626',
  'Human Resources': '#7c3aed',
  IT: '#059669',
}

