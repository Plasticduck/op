import { supabase } from '@/lib/supabase'
import type { FpaDataset } from '@/lib/fpa/parse'

// The FP&A Model (migration 0253): the current version of Mighty Wash's FP&A
// workbook. Reading is limited to the people in fpa_readers; loading a new
// version to the super admin (fpa_begin / fpa_load / fpa_activate).

export type FpaVersion = {
  id: string
  label: string
  file_name: string | null
  last_closed_month: string | null
  info: {
    subtitle?: string | null
    definitions?: { label: string; text: string }[]
    data_notes?: { label: string; text: string }[]
    budget_title?: string | null
    budget_notes?: string[]
    forecast_title?: string | null
    forecast_notes?: string[]
    months?: { first: string | null; last: string | null }
  }
  row_counts: Record<string, number> | null
  loaded_by_name: string | null
  loaded_at: string
  activated_at: string | null
}
export type FpaEntity = { key: string; label: string; kind: 'group' | 'site' | 'other'; filter_field: string | null; filter_value: string | null; sort: number }
export type FpaSite = {
  key: string; site_number: number | null; name: string | null; region: string | null; segment: string | null; format: string | null
  status: string | null; open_date: string | null; same_store: boolean | null; sort: number
}
export type FpaMetricRow = { entity_key: string; metric: string; month: string; value: number }
export type FpaPlRow = { month: string; account: string | null; gl: string | null; amount: number; site_key: string | null }
export type FpaBudgetRow = {
  key: string; location: string | null; region: string | null; landlord: string | null; in_budget: boolean | null
  revenue_actual: number | null; revenue_budget: number | null; ebitda_actual: number | null; ebitda_budget: number | null
  adj_ebitda_actual: number | null; adj_ebitda_budget: number | null; sort: number
}
export type FpaForecastRow = { entity_key: string; region: string | null; segment: string | null; same_store: boolean | null; metric: string; month: string; value: number }

const PAGE = 1000
type Res = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
// PostgREST answers at most 1000 rows at a time.
async function allPages<T>(build: (from: number, to: number) => Res): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < 200 * PAGE; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as T[]))
    if ((data ?? []).length < PAGE) break
  }
  return out
}
const num = <T extends { value?: unknown; amount?: unknown }>(r: T): T => ({ ...r, ...(r.value != null ? { value: Number(r.value) } : {}), ...(r.amount != null ? { amount: Number(r.amount) } : {}) })

// The pieces of an entity's filter, applied to rows that carry a site key, region,
// segment and same-store flag (P&L lines and forecast rows).
export type EntityFilter = { field: string | null; value: string | null }

export const fpa = {
  version: async (): Promise<FpaVersion | null> => {
    const { data, error } = await supabase.from('fpa_current_version').select('*').maybeSingle()
    if (error) throw new Error(error.message)
    return (data as FpaVersion | null) ?? null
  },
  entities: async (): Promise<FpaEntity[]> => {
    const { data, error } = await supabase.from('fpa_current_entities').select('*').order('sort')
    if (error) throw new Error(error.message)
    return (data ?? []) as FpaEntity[]
  },
  sites: async (): Promise<FpaSite[]> => {
    const { data, error } = await supabase.from('fpa_current_sites').select('key, site_number, name, region, segment, format, status, open_date, same_store, sort').order('sort')
    if (error) throw new Error(error.message)
    return (data ?? []) as FpaSite[]
  },
  // Every line and KPI for one entity, all months.
  entityMetrics: (entityKey: string) =>
    allPages<FpaMetricRow>((from, to) =>
      supabase.from('fpa_current_metrics').select('entity_key, metric, month, value').eq('entity_key', entityKey).order('metric').order('month').range(from, to),
    ).then((rows) => rows.map(num)),
  // A few metrics for many entities over a span of months.
  metricsFor: (entityKeys: string[], metrics: string[], fromMonth: string, toMonth: string) =>
    allPages<FpaMetricRow>((from, to) =>
      supabase.from('fpa_current_metrics').select('entity_key, metric, month, value')
        .in('entity_key', entityKeys).in('metric', metrics).gte('month', fromMonth).lte('month', toMonth)
        .order('entity_key').order('metric').order('month').range(from, to),
    ).then((rows) => rows.map(num)),
  // The QuickBooks lines behind one report line, for drilling into GL accounts.
  plLines: (kpiGroup: string, filter: EntityFilter, fromMonth: string, toMonth: string) =>
    allPages<FpaPlRow>((from, to) => {
      let q = supabase.from('fpa_current_pl_lines').select('month, account, gl, amount, site_key')
        .eq('kpi_group', kpiGroup).gte('month', fromMonth).lte('month', toMonth)
      if (filter.field === 'site_key' && filter.value) q = q.eq('site_key', filter.value)
      else if (filter.field === 'region' && filter.value) q = q.eq('region', filter.value)
      else if (filter.field === 'segment' && filter.value) q = q.eq('segment', filter.value)
      else if (filter.field === 'same_store') q = q.eq('same_store', true)
      return q.order('month').range(from, to)
    }).then((rows) => rows.map(num)),
  budget: async (): Promise<FpaBudgetRow[]> => {
    const { data, error } = await supabase.from('fpa_current_budget_ytd').select('*').order('sort')
    if (error) throw new Error(error.message)
    return ((data ?? []) as FpaBudgetRow[]).map((b) => ({
      ...b,
      revenue_actual: b.revenue_actual == null ? null : Number(b.revenue_actual),
      revenue_budget: b.revenue_budget == null ? null : Number(b.revenue_budget),
      ebitda_actual: b.ebitda_actual == null ? null : Number(b.ebitda_actual),
      ebitda_budget: b.ebitda_budget == null ? null : Number(b.ebitda_budget),
      adj_ebitda_actual: b.adj_ebitda_actual == null ? null : Number(b.adj_ebitda_actual),
      adj_ebitda_budget: b.adj_ebitda_budget == null ? null : Number(b.adj_ebitda_budget),
    }))
  },
  forecast: () =>
    allPages<FpaForecastRow>((from, to) =>
      supabase.from('fpa_current_forecast').select('*').order('entity_key').order('metric').order('month').range(from, to),
    ).then((rows) => rows.map(num)),
  // Who can read the model through Operator AI (the super admin sees the list).
  readers: async (): Promise<string[]> => {
    const { data, error } = await supabase.from('fpa_readers').select('email').order('email')
    if (error) throw new Error(error.message)
    return (data ?? []).map((r) => r.email as string)
  },

  // Load a parsed workbook as the new current version. Rows go in while the
  // version is 'loading', so a failure part way leaves the current one in place.
  load: async (accountId: string, d: FpaDataset, onProgress: (done: number, total: number) => void): Promise<Record<string, number>> => {
    const begin = await supabase.rpc('fpa_begin', {
      // A workbook without a last closed month passes null, which the function takes.
      p_account: accountId, p_label: d.label, p_file_name: d.fileName, p_last_closed: d.lastClosed as string, p_info: d.info as never,
    })
    if (begin.error || !begin.data) throw new Error(begin.error?.message ?? 'Could not start the load.')
    const version = begin.data as string
    const kinds: [string, unknown[]][] = [
      ['entities', d.entities], ['sites', d.sites], ['coa', d.coa], ['budget', d.budget], ['forecast', d.forecast], ['pl', d.pl], ['metrics', d.metrics],
    ]
    const total = kinds.reduce((n, [, rows]) => n + rows.length, 0)
    let done = 0
    try {
      for (const [kind, rows] of kinds) {
        for (let i = 0; i < rows.length; i += 4000) {
          const batch = rows.slice(i, i + 4000)
          const { error } = await supabase.rpc('fpa_load', { p_version: version, p_kind: kind, p_rows: batch as never })
          if (error) throw new Error(`${kind}: ${error.message}`)
          done += batch.length
          onProgress(done, total)
        }
      }
      const act = await supabase.rpc('fpa_activate', { p_version: version })
      if (act.error) throw new Error(act.error.message)
      return (act.data ?? {}) as Record<string, number>
    } catch (e) {
      void supabase.rpc('fpa_discard', { p_version: version })
      throw e
    }
  },
}
