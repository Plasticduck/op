import { format, parseISO } from 'date-fns'
import type { MiLocationType, PoStatus, ToolCondition, ToolStatus } from '@/lib/queries/maintenanceInventory'

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'

export const qty = (n: number | string | null | undefined): string =>
  n == null || n === '' ? '-' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 })

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const money = (n: number | string | null | undefined): string => (n == null ? '-' : usd2.format(Number(n)))
export const moneyWhole = (n: number | string | null | undefined): string => (n == null ? '-' : usd0.format(Number(n)))
export const pct = (n: number | string | null | undefined): string => (n == null ? '-' : `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`)

export const day = (iso: string | null | undefined): string => (iso ? format(parseISO(iso), 'MMM d, yyyy') : '-')
export const dayTime = (iso: string | null | undefined): string => (iso ? format(parseISO(iso), 'MMM d, h:mm a') : '-')

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const LOCATION_TYPE_LABEL: Record<MiLocationType, string> = {
  stockroom: 'Stockroom',
  cabinet: 'Cabinet',
  truck: 'Truck',
  regional_warehouse: 'Regional warehouse',
}

export const TOOL_STATUS: Record<ToolStatus, { label: string; tone: Tone }> = {
  available: { label: 'Available', tone: 'ok' },
  checked_out: { label: 'Checked out', tone: 'accent' },
  in_repair: { label: 'In repair', tone: 'warn' },
  lost: { label: 'Lost', tone: 'danger' },
  retired: { label: 'Retired', tone: 'neutral' },
}

export const TOOL_CONDITION: Record<ToolCondition, string> = {
  good: 'Good',
  needs_repair: 'Needs repair',
  damaged: 'Damaged',
  missing_parts: 'Missing parts',
}

export const TOOL_ACTION: Record<string, string> = {
  created: 'Added',
  check_out: 'Checked out',
  return: 'Returned',
  transfer_start: 'Hand-off started',
  transfer_accept: 'Hand-off accepted',
  transfer_cancel: 'Hand-off cancelled',
  status: 'Status changed',
  report_issue: 'Issue reported',
  audit: 'Audit',
}

export const PO_STATUS: Record<PoStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Submitted', tone: 'warn' },
  approved: { label: 'Approved', tone: 'accent' },
  sent: { label: 'Sent', tone: 'accent' },
  partially_received: { label: 'Partly received', tone: 'warn' },
  received: { label: 'Received', tone: 'ok' },
  closed: { label: 'Closed', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

export const TRANSFER_STATUS: Record<string, { label: string; tone: Tone }> = {
  requested: { label: 'Requested', tone: 'warn' },
  approved: { label: 'Approved', tone: 'accent' },
  in_transit: { label: 'In transit', tone: 'accent' },
  received: { label: 'Received', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

export const COUNT_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'accent' },
  in_review: { label: 'In review', tone: 'warn' },
  posted: { label: 'Posted', tone: 'ok' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

export const REASON_CODES: Array<{ value: string; label: string }> = [
  { value: 'damaged', label: 'Damaged' },
  { value: 'used_without_wo', label: 'Used without a work order' },
  { value: 'mis_binned', label: 'In the wrong bin' },
  { value: 'receiving_error', label: 'Receiving error' },
  { value: 'theft_loss', label: 'Theft or loss' },
  { value: 'unknown', label: 'Unknown' },
]

export const LEDGER_TYPE: Record<string, string> = {
  receive: 'Received',
  issue: 'Used',
  return: 'Returned',
  transfer_out: 'Shipped out',
  transfer_in: 'Transfer in',
  adjust: 'Adjusted',
  count_adjust: 'Count',
  reserve: 'Reserved',
  unreserve: 'Unreserved',
}
