import { createContext, useContext } from 'react'
import type { MiMe, MiRefs } from '@/lib/queries/maintenanceInventory'

export type ScanContext = {
  // Scanning an asset or opening a work order sets what the next consume is charged to.
  asset?: { id: string; name: string; site_id?: string | null } | null
  workOrder?: { id: string; number: number; title: string; site_id?: string | null } | null
  // Set when the scan should open straight on a tag, like a sticker's QR code.
  code?: string | null
  // Where this came from, for the ledger: a checklist's "Parts used" link.
  source?: 'checklist'
}

export type MiCtx = {
  me: Extract<MiMe, { member: true }>
  refs: MiRefs
  accountId: string
  userId: string
  reload: () => Promise<void>
  openScan: (c?: ScanContext) => void
  notify: (text: string, tone?: 'ok' | 'warn' | 'danger') => void
}

export const MiContext = createContext<MiCtx | null>(null)

export function useMi(): MiCtx {
  const ctx = useContext(MiContext)
  if (!ctx) throw new Error('useMi needs MaintenanceInventoryPage')
  return ctx
}
