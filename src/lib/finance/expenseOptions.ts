// Shared option lists + helpers for the Finance expense pages (Per Diem, Mileage).
// Keeping them here means the Department / Business Unit lists stay in sync across
// both pages — edit once. Policy and Category are still placeholders to finalize
// with AP; Policy will ultimately be assigned per person by role.

export const POLICIES = ['MW Executive Team', 'MW Regional Managers', 'MW General Managers', 'MW Support Staff']
export const CATEGORIES = ['Meals', 'Lodging', 'Travel', 'Incidentals', 'Mileage', 'Other']
export const DEPARTMENTS = [
  '#19 General Manager', 'AP', 'Admin', 'Directors', 'Exec Team', 'General Managers',
  'IT', 'Maintenance', 'Operations', 'Sales & Marketing',
]
export const BUSINESS_UNITS = [
  '01 - LBK 82nd', '02 - Odessa Kermit', '03 - Midland Loop 250', '04 - Andrews',
  '05 - LBK 19th St', '06 - Big Spring', '07 - LBK Loop 289', '08 - IBA', '09 - LBK 50th',
  '10 - LBK 80th University', '11 - LBK 114th Quaker', '12 - Midland 4110 North',
  '13 - Midland 1103 And.', '14 - Sweetwater', '15 - Odessa 52nd St.', '16 - Carlsbad Canyon St.',
  '17 - Hobbs Joe Harvey', '18 - Hobbs Bender St', '19 - Hobbs Lube', '20 - IN-BAY', '21 - Lovington',
  '22 - 87th and Evans Odessa', '23 - Carlsbad 1600 Skyline', '24 - Midland Briarwood',
  '25 - Grandview', '26 - Artesia', '27 - Valley Mills', '28 - Robinson', '29 - Killeen',
  '30 - Harker Heights', '31 - 2800 Midland', '33 - Dalhart', '34 - Hereford',
  'Corporate', 'Misc Reimbursement', 'Spotless',
]
export const CURRENCIES = ['USD']

// A sensible default policy for the person's role until policies are configured.
export function defaultPolicy(role: string | undefined, category: string | null | undefined): string {
  if (category === 'executive' || role === 'owner') return 'MW Executive Team'
  if (category === 'regional_manager') return 'MW Regional Managers'
  return POLICIES[0]
}

export const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtDate = (s: string | null) => {
  if (!s) return '—'
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export const today = () => new Date().toISOString().slice(0, 10)

// --- CSV helpers (Complete-tab exports) ---
export const csvEsc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export const mdY = (s: string | null) => {
  if (!s) return ''
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US')
}

export function downloadCsv(filename: string, text: string) {
  // UTF-8 BOM so Excel reads it as UTF-8.
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
