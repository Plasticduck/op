import { createContext, useContext } from 'react'
import type { LogCounts, ScheduleRow } from '@/lib/queries/maintenanceLog'

export type AssetRef = { id: string; name: string; site_id: string }

// What the log form opens with: a blank job, a job on one machine, or a scheduled task.
export type LogFormInit = {
  site_id?: string | null
  asset?: AssetRef | null
  schedule?: ScheduleRow | null
  skip?: boolean
}

export type ScheduleFormInit = {
  existing?: ScheduleRow | null
  site_id?: string | null
  asset?: AssetRef | null
  part?: { id: string; name: string } | null
}

export type LogCtx = {
  openLog: (init?: LogFormInit) => void
  openSchedule: (init?: ScheduleFormInit) => void
  counts: LogCounts | null
}

export const LogContext = createContext<LogCtx | null>(null)

export function useLog(): LogCtx {
  const ctx = useContext(LogContext)
  if (!ctx) throw new Error('useLog needs MaintenanceLogPage')
  return ctx
}

// Screens reload on this after anything is saved.
export const LOG_CHANGED = 'ml-changed'
export const logChanged = () => window.dispatchEvent(new Event(LOG_CHANGED))
