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

export type Region = { name: string; sites: string[] }

// Sites are grouped into regions by their location name.
export const REGIONS: Region[] = [
  { name: 'Corporate', sites: ['Corporate'] },
  {
    name: 'Lubbock Region',
    sites: ['Site 1', 'Site 5', 'Site 7', 'Site 9', 'Site 10', 'Site 11', 'Site 14'],
  },
  {
    name: 'Permian Basin Region (A)',
    sites: [
      'Site 2',
      'Site 4',
      'Site 6',
      'Site 8',
      'Site 13',
      'Site 15',
      'Site 22',
      'Site 24',
      'Site 25',
    ],
  },
  { name: 'Permian Basin Region (B)', sites: ['Site 3', 'Site 12', 'Site 31'] },
  {
    name: 'New Mexico Region',
    sites: ['Site 16', 'Site 17', 'Site 18', 'Site 19', 'Site 20', 'Site 21', 'Site 23', 'Site 26'],
  },
  {
    name: 'Central Region',
    sites: ['Site 27', 'Site 28', 'Site 29', 'Site 30', 'Spotless'],
  },
]

// Accent color per department (stat-card top bar).
export const DEPARTMENT_COLOR: Record<string, string> = {
  Total: '#9aa3b1',
  Operations: '#f59e0b',
  Safety: '#2563eb',
  Accounting: '#dc2626',
  'Human Resources': '#7c3aed',
  IT: '#059669',
}

export type RegionGroup<L> = { region: string; locations: L[] }

// Group the account's locations into the configured regions (by name). Any
// location that isn't in a region falls into a trailing "Other" group so
// nothing is hidden.
export function groupLocationsByRegion<L extends { id: string; name: string }>(
  locations: L[],
): RegionGroup<L>[] {
  const byName = new Map(locations.map((l) => [l.name, l]))
  const groups: RegionGroup<L>[] = REGIONS.map((r) => ({
    region: r.name,
    locations: r.sites.map((s) => byName.get(s)).filter((l): l is L => Boolean(l)),
  }))
  const claimed = new Set(REGIONS.flatMap((r) => r.sites))
  const other = locations.filter((l) => !claimed.has(l.name))
  if (other.length) groups.push({ region: 'Other', locations: other })
  return groups.filter((g) => g.locations.length > 0)
}
