import { differenceInCalendarDays, parseISO } from 'date-fns'
import {
  BatteryCharging,
  Cctv,
  Cloud,
  Cpu,
  CreditCard,
  Globe,
  HardDrive,
  KeyRound,
  Laptop,
  Monitor,
  Network,
  Package,
  Phone,
  Printer,
  Router,
  ScanBarcode,
  ScanLine,
  Server,
  Smartphone,
  Tablet,
  Tv,
  Wifi,
  type LucideIcon,
} from 'lucide-react'

// What the IT Inventory tracks. Category keys are stored on it_assets.category
// (unconstrained in the DB), so a new category only needs an entry here. Keep
// existing keys stable: renaming one orphans the records that use it.
//
// `kind` changes how a record reads: a device has hardware, network and
// warranty details; a service (internet, phone plan, license) is mostly a
// provider, an account number and a monthly cost that renews.

export type ItKind = 'device' | 'service'
export type ItCategory = { key: string; label: string; group: string; kind: ItKind; icon: LucideIcon }

export const IT_CATEGORIES: ItCategory[] = [
  { key: 'computer', label: 'Desktop computer', group: 'Computers', kind: 'device', icon: Monitor },
  { key: 'laptop', label: 'Laptop', group: 'Computers', kind: 'device', icon: Laptop },
  { key: 'tablet', label: 'Tablet', group: 'Computers', kind: 'device', icon: Tablet },
  { key: 'mobile', label: 'Cell phone', group: 'Computers', kind: 'device', icon: Smartphone },
  { key: 'pos', label: 'POS / cashier station', group: 'Payment & entry', kind: 'device', icon: ScanBarcode },
  { key: 'pay_station', label: 'Pay station / kiosk', group: 'Payment & entry', kind: 'device', icon: CreditCard },
  { key: 'lpr_camera', label: 'LPR / entry camera', group: 'Payment & entry', kind: 'device', icon: ScanLine },
  { key: 'controller', label: 'Tunnel controller / PLC', group: 'Payment & entry', kind: 'device', icon: Cpu },
  { key: 'camera', label: 'Security camera', group: 'Cameras', kind: 'device', icon: Cctv },
  { key: 'nvr', label: 'NVR / DVR', group: 'Cameras', kind: 'device', icon: HardDrive },
  { key: 'router', label: 'Router / firewall', group: 'Network', kind: 'device', icon: Router },
  { key: 'switch', label: 'Network switch', group: 'Network', kind: 'device', icon: Network },
  { key: 'access_point', label: 'Wi-Fi access point', group: 'Network', kind: 'device', icon: Wifi },
  { key: 'server', label: 'Server', group: 'Network', kind: 'device', icon: Server },
  { key: 'ups', label: 'UPS / battery backup', group: 'Network', kind: 'device', icon: BatteryCharging },
  { key: 'printer', label: 'Printer', group: 'Other devices', kind: 'device', icon: Printer },
  { key: 'display', label: 'TV / display / menu board', group: 'Other devices', kind: 'device', icon: Tv },
  { key: 'other_device', label: 'Other device', group: 'Other devices', kind: 'device', icon: Package },
  { key: 'internet', label: 'Internet circuit', group: 'Services', kind: 'service', icon: Globe },
  { key: 'phone_service', label: 'Phone line / cell plan', group: 'Services', kind: 'service', icon: Phone },
  { key: 'license', label: 'Software license', group: 'Services', kind: 'service', icon: KeyRound },
  { key: 'subscription', label: 'Software subscription', group: 'Services', kind: 'service', icon: Cloud },
]

export const IT_GROUPS: string[] = [...new Set(IT_CATEGORIES.map((c) => c.group))]

const FALLBACK: ItCategory = IT_CATEGORIES.find((c) => c.key === 'other_device')!
export function categoryOf(key: string | null | undefined): ItCategory {
  return IT_CATEGORIES.find((c) => c.key === key) ?? FALLBACK
}

export type ItStatus = {
  key: string
  label: string
  tone: 'ok' | 'accent' | 'neutral' | 'warn' | 'danger'
  // Counts toward "what we have": totals, coming-due and verification nags.
  active: boolean
}

export const IT_STATUSES: ItStatus[] = [
  { key: 'in_use', label: 'In use', tone: 'ok', active: true },
  { key: 'spare', label: 'Spare', tone: 'accent', active: true },
  { key: 'on_order', label: 'On order', tone: 'neutral', active: true },
  { key: 'in_repair', label: 'In repair', tone: 'warn', active: true },
  { key: 'retired', label: 'Retired', tone: 'neutral', active: false },
  { key: 'lost', label: 'Lost or stolen', tone: 'danger', active: false },
]

export function statusOf(key: string | null | undefined): ItStatus {
  return IT_STATUSES.find((s) => s.key === key) ?? IT_STATUSES[0]
}

export const assetTag = (n: number) => `IT-${String(n).padStart(4, '0')}`

// How a record with no site reads everywhere.
export const NO_SITE = 'Office or storage'

// Days before a warranty end or renewal that it counts as coming due.
export const DUE_WINDOW_DAYS = 60
// Active gear nobody has laid eyes on in this long gets flagged.
export const VERIFY_STALE_DAYS = 180

// Whole days from today to a yyyy-MM-dd date (negative = already past).
export const daysUntil = (day: string) => differenceInCalendarDays(parseISO(day), new Date())

export type DueEntry = { date: string; days: number; what: 'warranty' | 'renewal' }

// What's coming due on one record: a warranty ending inside the window, or a
// renewal inside the window or already past. A lapsed renewal still needs
// someone to act; a warranty that already ended doesn't, so it drops off.
export function dueEntries(a: { status: string; warranty_expires: string | null; renewal_date: string | null }): DueEntry[] {
  if (!statusOf(a.status).active) return []
  const out: DueEntry[] = []
  if (a.warranty_expires) {
    const days = daysUntil(a.warranty_expires)
    if (days >= 0 && days <= DUE_WINDOW_DAYS) out.push({ date: a.warranty_expires, days, what: 'warranty' })
  }
  if (a.renewal_date) {
    const days = daysUntil(a.renewal_date)
    if (days <= DUE_WINDOW_DAYS) out.push({ date: a.renewal_date, days, what: 'renewal' })
  }
  return out
}

export function dueLabel(e: DueEntry): string {
  if (e.what === 'warranty') return e.days === 0 ? 'Warranty ends today' : `Warranty ends in ${e.days}d`
  if (e.days < 0) return `Renewal ${-e.days}d overdue`
  return e.days === 0 ? 'Renews today' : `Renews in ${e.days}d`
}

// Devices that are out in the field but haven't been checked in person lately.
// Services and gear still on order have nothing to look at.
export function needsCheck(a: { status: string; category: string; last_verified_at: string | null }): boolean {
  if (!statusOf(a.status).active || a.status === 'on_order') return false
  if (categoryOf(a.category).kind !== 'device') return false
  if (!a.last_verified_at) return true
  return differenceInCalendarDays(new Date(), new Date(a.last_verified_at)) > VERIFY_STALE_DAYS
}
