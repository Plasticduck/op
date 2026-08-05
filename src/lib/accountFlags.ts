// Account-specific UI toggles. Kept here so a single check drives the sidebar,
// the Settings tabs, and the route guard consistently.

// Billing is hidden for these accounts for now (handled outside Operator). It
// stays fully intact for every other company.
const BILLING_HIDDEN_ACCOUNTS = new Set<string>([
  '54f3e299-1f61-4ed2-9921-3d02160b72e6', // Mighty Wash
])

export function isBillingHidden(accountId: string | null | undefined): boolean {
  return !!accountId && BILLING_HIDDEN_ACCOUNTS.has(accountId)
}

// Per-account co-brand logo shown in the content area (top-left, beside the page
// header) on every page except the Dashboard. Maps account id -> image path.
const COBRAND_LOGOS: Record<string, string> = {
  '54f3e299-1f61-4ed2-9921-3d02160b72e6': '/mw-logo.png', // Mighty Wash
}

export function accountCobrandLogo(accountId: string | null | undefined): string | null {
  return (accountId && COBRAND_LOGOS[accountId]) || null
}
