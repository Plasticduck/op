// Pages that open when granted, but whose data the server still keeps to certain
// roles or lists (RLS or edge function checks that don't know about page_access
// yet). Shown under a page in the super admin's editor when it's granted beyond
// the usual. Remove an entry once its server checks honor grants
// (auth_page_granted / page_granted_for, migration 0241).
const MANAGER_DATA = 'Its data loads for Admins and managers only.'

export const SERVER_LIMITED: Record<string, string> = {
  '/app/bonuses': 'Shows only the sites the person is assigned to, and nothing below a manager login.',
  '/app/event-pay': 'Shows only their own requests.',
  '/app/recharge-timing': MANAGER_DATA,
  '/app/site-reviews': 'Shows only reviews they submit. Submitting needs a manager login.',
  '/app/purchase-requests': 'Sending and signing need an Admin, manager or technician login.',
  '/app/per-diem': 'Shows only their own requests. Approving needs Admin or Finance.',
  '/app/mileage': 'Shows only their own requests. Approving needs Admin or Finance.',
  '/app/quickbooks': 'Its data loads for Admins only.',
  '/app/it-inventory': 'Editing needs an Admin, manager or technician login.',
  '/app/tips-new': MANAGER_DATA,
  '/app/maintenance-orders': 'Shows only orders they place.',
  '/app/maintenance-inventory': 'They also need adding under Maintenance Inventory > Settings.',
  '/app/maintenance-log': 'They also need adding under Maintenance Inventory > Settings.',
  '/app/fleet-management': 'Its data loads for Admins only.',
  '/app/households': 'Its data loads for Admins only.',
  '/app/settings': 'Saving changes needs an Admin login.',
  '/app/settings/team': 'Making changes needs an Admin login.',
  '/app/settings/locations': 'Making changes needs an Admin login.',
  '/app/settings/billing': 'Its data loads for Admins only.',
  '/app/site-performance': MANAGER_DATA,
  '/app/details': MANAGER_DATA,
  '/app/msa-performance': MANAGER_DATA,
  '/app/msa-sale-audit': MANAGER_DATA,
  '/app/interior-reporting': MANAGER_DATA,
  '/app/flexwash-sales': MANAGER_DATA,
  '/app/chemicals': MANAGER_DATA,
  '/app/cameras': MANAGER_DATA,
  '/app/labor': 'Car counts and unpublished schedules load for managers only.',
  '/app/employees': 'Below a manager login it shows only their own record.',
  '/app/timesheets': 'Below a manager login it shows only their own time.',
  '/app/reviews': 'Below a manager login it shows only their own reviews.',
  '/app/counseling': MANAGER_DATA,
  '/app/injuries': MANAGER_DATA,
}
