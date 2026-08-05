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

// Co-brand logo shown next to the Operator logo at the top of the sidebar,
// per account. Maps account id -> public image path.
const SIDEBAR_COBRAND_LOGOS: Record<string, string> = {
  '54f3e299-1f61-4ed2-9921-3d02160b72e6': '/mw-logo.png', // Mighty Wash
}

export function sidebarCobrandLogo(accountId: string | null | undefined): string | null {
  return (accountId && SIDEBAR_COBRAND_LOGOS[accountId]) || null
}
