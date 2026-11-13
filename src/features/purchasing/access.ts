// Who can use Finance > Purchase Request, and the shared option lists.
import type { AccountUser } from '@/lib/queries/account'

// Pre-launch: only these logins see the page (route, nav, and the approver
// picker). Set to null to open it to every owner, manager and technician.
export const PURCHASE_REQUEST_EMAILS: string[] | null = [
  'kevan@washlyfe.com',
  'kjowers@mighty-wash.com',
]

const PR_ROLES = new Set(['owner', 'manager', 'technician'])

type Person = { role: string; role_category?: string | null; email?: string | null }

// Can open the page, send requests and sign them. The purchase-requests function
// checks the role again; the email list is the pre-launch gate.
export function canUsePurchaseRequests(p: Person | null | undefined): boolean {
  if (!p || !PR_ROLES.has(p.role) || p.role_category === 'corporate_display') return false
  return PURCHASE_REQUEST_EMAILS === null || PURCHASE_REQUEST_EMAILS.includes((p.email ?? '').toLowerCase())
}

// Accounts Payable: sees every request, records paper signatures, marks purchased.
// Same rule as Per Diem and Mileage (and the RLS helper pr_is_finance).
export function isAccountsPayable(p: Person | null | undefined): boolean {
  return !!p && (p.role === 'owner' || p.role_category === 'finance')
}

export const eligibleSigners = (users: AccountUser[]) => users.filter((u) => canUsePurchaseRequests(u))

export const CATEGORIES = [
  'Equipment',
  'Parts and repairs',
  'Chemicals',
  'Supplies',
  'IT and technology',
  'Facilities and maintenance',
  'Signage and marketing',
  'Vehicles',
  'Services and contractors',
  'Uniforms',
  'Other',
]

export const PAYMENT_METHODS = [
  'Purchase order / invoice',
  'Company credit card',
  'Check',
  'ACH / wire',
  'Employee reimbursement',
]

export const prNumber = (n: number | null | undefined) => (n ? `PR-${n}` : 'New')
