import type { StatCardProps } from '@/components/data/StatCard'

export type ReportColumn = {
  header: string
  key: string
  numeric?: boolean
  format?: (value: unknown, row: Record<string, unknown>) => string
}

export type ReportResult = {
  rows: Record<string, unknown>[]
  stats: StatCardProps[]
}

export type ReportModule = 'ops' | 'people'

export type ReportDef = {
  key: string
  title: string
  description: string
  module: ReportModule
  columns: ReportColumn[]
  load: (
    locationIds: string[],
    startIso: string,
    endIso: string,
  ) => Promise<ReportResult>
}
