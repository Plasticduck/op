// Reads Mighty Wash's FP&A workbook (Mighty_Wash_FPA_Model_*.xlsx) into the rows
// the fpa_* tables hold (migration 0253). Values are the workbook's own cached
// results, so what Operator shows matches the file to the cent. Shared by the
// FP&A Model page's upload and the first load, so it has no imports: the caller
// passes SheetJS's utils (`import * as XLSX from 'xlsx'`, read with raw values
// and cellDates off, so dates arrive as Excel serial numbers).

type Grid = unknown[][]
type SheetUtils = {
  decode_range: (r: string) => { s: { r: number; c: number }; e: { r: number; c: number } }
  encode_range: (r: { s: { r: number; c: number }; e: { r: number; c: number } }) => string
  sheet_to_json: (ws: unknown, opts: Record<string, unknown>) => unknown[]
}
type Workbook = { SheetNames: string[]; Sheets: Record<string, Record<string, unknown>> }

export const FPA_SHEETS = ['README', 'Settings', 'Sites', 'Calc', 'Data_PL', 'COA_Map', 'Budget vs Actual', 'FC_Calc', 'FORECAST'] as const

export type FpaEntity = { key: string; label: string; kind: 'group' | 'site' | 'other'; filter_field: string | null; filter_value: string | null; sort: number }
export type FpaSite = {
  key: string; site_number: number | null; name: string | null; region: string | null; segment: string | null; price_tier: string | null
  format: string | null; status: string | null; open_date: string | null; closed_from: string | null; reopen_date: string | null
  interior_start: string | null; same_store: boolean | null; in_forecast: boolean | null; notes: string | null; sort: number
}
export type FpaMetric = { e: string; m: string; d: string; v: number }
export type FpaPlLine = { n: number; d: string; c: string | null; k: string | null; a: string | null; gl: string | null; v: number; g: string | null; r: string | null; reg: string | null; seg: string | null; ss: boolean | null; t: string | null }
export type FpaCoa = { account: string; gl: string | null; qb_type: string | null; kpi_group: string | null; dashboard_row: string | null; ebitda_addback: string | null }
export type FpaBudget = {
  key: string; location: string | null; region: string | null; landlord: string | null; in_budget: boolean | null
  revenue_actual: number | null; revenue_budget: number | null; ebitda_actual: number | null; ebitda_budget: number | null
  adj_ebitda_actual: number | null; adj_ebitda_budget: number | null; sort: number
}
export type FpaForecast = { e: string; reg: string | null; seg: string | null; ss: boolean | null; m: string; d: string; v: number }
export type FpaInfo = {
  subtitle: string | null
  definitions: { label: string; text: string }[]
  data_notes: { label: string; text: string }[]
  budget_title: string | null
  budget_notes: string[]
  forecast_title: string | null
  forecast_notes: string[]
  months: { first: string | null; last: string | null }
}
export type FpaDataset = {
  label: string
  fileName: string
  lastClosed: string | null
  info: FpaInfo
  entities: FpaEntity[]
  sites: FpaSite[]
  metrics: FpaMetric[]
  pl: FpaPlLine[]
  coa: FpaCoa[]
  budget: FpaBudget[]
  forecast: FpaForecast[]
}

export class FpaFormatError extends Error {}

// A sheet as rows of cells from A1, whatever range the file says it starts at.
function grid(utils: SheetUtils, wb: Workbook, name: string, required = true): Grid | null {
  const ws = wb.Sheets[name]
  if (!ws || !ws['!ref']) {
    if (required) throw new FpaFormatError(`The workbook has no "${name}" tab.`)
    return null
  }
  const r = utils.decode_range(String(ws['!ref']))
  r.s.r = 0
  r.s.c = 0
  return utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true, range: utils.encode_range(r) }) as Grid
}

const at = (g: Grid, row: number, col: number): unknown => g[row - 1]?.[col - 1] ?? null
const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const bool = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v
  const s = str(v)?.toLowerCase()
  if (s === 'true' || s === 'yes') return true
  if (s === 'false' || s === 'no') return false
  return null
}
// Excel serial (days since 1899-12-30) or an ISO-ish string -> YYYY-MM-DD.
export function excelDate(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000) {
    return new Date(Math.round((v - 25569) * 86_400_000)).toISOString().slice(0, 10)
  }
  const s = str(v)
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}
const expect = (g: Grid, row: number, col: number, text: string, tab: string) => {
  const v = str(at(g, row, col)) ?? ''
  if (!v.toLowerCase().startsWith(text.toLowerCase())) {
    throw new FpaFormatError(`The "${tab}" tab has changed: expected "${text}" in row ${row}, column ${col}, found "${v}".`)
  }
}

// "Mighty_Wash_FPA_Model_Oct-2026_Final NOV 11 v2.xlsx" -> "Oct-2026 Final NOV 11 v2"
export function versionLabel(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName
  return base.replace(/\.xls[xm]?$/i, '').replace(/^mighty_wash_fpa_model_?/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim() || base
}

const FILTER_FIELD: Record<number, string> = { 1: 'site_key', 2: 'region', 3: 'segment', 4: 'all', 5: 'same_store' }

// Monthly columns from `fromCol` on `row`, as long as they're dates.
function monthColumns(g: Grid, row: number, fromCol: number): { col: number; d: string }[] {
  const out: { col: number; d: string }[] = []
  for (let c = fromCol; c <= (g[row - 1]?.length ?? 0); c++) {
    const d = excelDate(at(g, row, c))
    if (!d) break
    out.push({ col: c, d })
  }
  return out
}

export function parseFpaWorkbook(utils: SheetUtils, wb: Workbook, fileName: string): FpaDataset {
  // README: the subtitle, definitions and data notes.
  const readme = grid(utils, wb, 'README', false)
  const labelled = (from: number, to: number) => {
    const out: { label: string; text: string }[] = []
    if (!readme) return out
    for (let r = from; r <= to; r++) {
      const label = str(at(readme, r, 2))
      const text = str(at(readme, r, 3))
      if (label && text) out.push({ label, text })
    }
    return out
  }

  // Settings: the last closed month and the entity list.
  const settings = grid(utils, wb, 'Settings')!
  expect(settings, 11, 10, 'Entity', 'Settings')
  const lastClosed = excelDate(at(settings, 7, 3))
  const entities: FpaEntity[] = []
  for (let r = 12; r <= settings.length; r++) {
    const label = str(at(settings, r, 10))
    const key = str(at(settings, r, 11))
    if (!label || !key) break
    const f = num(at(settings, r, 12))
    entities.push({
      key, label,
      kind: key.startsWith('G_') ? 'group' : /^S\d+$/.test(key) ? 'site' : 'other',
      filter_field: f != null ? FILTER_FIELD[f] ?? null : null,
      filter_value: str(at(settings, r, 13)),
      sort: entities.length,
    })
  }
  if (!entities.length) throw new FpaFormatError('The Settings tab lists no entities.')

  // Sites.
  const sitesG = grid(utils, wb, 'Sites')!
  expect(sitesG, 5, 1, 'Key', 'Sites')
  expect(sitesG, 5, 3, 'Site Name', 'Sites')
  const sites: FpaSite[] = []
  for (let r = 6; r <= sitesG.length; r++) {
    const key = str(at(sitesG, r, 1))
    if (!key) break
    sites.push({
      key,
      site_number: num(at(sitesG, r, 2)),
      name: str(at(sitesG, r, 3)),
      region: str(at(sitesG, r, 4)),
      segment: str(at(sitesG, r, 5)),
      price_tier: str(at(sitesG, r, 6)),
      format: str(at(sitesG, r, 7)),
      status: str(at(sitesG, r, 8)),
      open_date: excelDate(at(sitesG, r, 9)),
      closed_from: excelDate(at(sitesG, r, 10)),
      reopen_date: excelDate(at(sitesG, r, 11)),
      interior_start: excelDate(at(sitesG, r, 12)),
      same_store: bool(at(sitesG, r, 13)),
      notes: str(at(sitesG, r, 14)),
      in_forecast: bool(at(sitesG, r, 17)),
      sort: sites.length,
    })
  }

  // Calc: entity x line x month.
  const calc = grid(utils, wb, 'Calc')!
  expect(calc, 5, 1, 'Key|Line', 'Calc')
  // Months after the last closed one are empty placeholders in the engine; left
  // out so they can't be read as real zeros.
  const calcMonths = monthColumns(calc, 5, 8).filter((m) => !lastClosed || m.d <= lastClosed)
  if (!calcMonths.length) throw new FpaFormatError('The Calc tab has no month columns.')
  const metrics: FpaMetric[] = []
  for (let r = 6; r <= calc.length; r++) {
    const k = str(at(calc, r, 1))
    if (!k || !k.includes('|')) continue
    const e = str(at(calc, r, 2)) ?? k.split('|')[0]
    const m = str(at(calc, r, 7)) ?? k.slice(k.indexOf('|') + 1)
    for (const { col, d } of calcMonths) {
      const v = num(at(calc, r, col))
      if (v != null) metrics.push({ e, m, d, v })
    }
  }
  // The engine has a few keys the Settings list doesn't offer (Spotless's own
  // class): named from the Sites tab so every value has a label.
  const known = new Set(entities.map((x) => x.key))
  for (const e of new Set(metrics.map((x) => x.e))) {
    if (known.has(e)) continue
    const site = sites.find((s) => s.key === e)
    entities.push({ key: e, label: site?.name ?? e, kind: /^S\d+$/.test(e) ? 'site' : 'other', filter_field: 'site_key', filter_value: e, sort: entities.length })
    known.add(e)
  }

  // Data_PL: the QuickBooks lines.
  const plG = grid(utils, wb, 'Data_PL')!
  expect(plG, 4, 1, 'Month', 'Data_PL')
  expect(plG, 4, 4, 'Amount', 'Data_PL')
  const pl: FpaPlLine[] = []
  for (let r = 5; r <= plG.length; r++) {
    const d = excelDate(at(plG, r, 1))
    const v = num(at(plG, r, 4))
    if (!d || v == null) continue
    const a = str(at(plG, r, 3))
    pl.push({
      n: pl.length + 1, d, v, a,
      c: str(at(plG, r, 2)),
      k: str(at(plG, r, 6)),
      gl: a?.match(/^(\d{3,6})/)?.[1] ?? null,
      g: str(at(plG, r, 7)),
      reg: str(at(plG, r, 9)),
      seg: str(at(plG, r, 10)),
      ss: bool(at(plG, r, 11)),
      r: str(at(plG, r, 13)),
      t: str(at(plG, r, 14)),
    })
  }
  if (!pl.length) throw new FpaFormatError('The Data_PL tab has no QuickBooks lines.')
  const plMonths = pl.map((p) => p.d).sort()

  // COA_Map.
  const coaG = grid(utils, wb, 'COA_Map')!
  expect(coaG, 4, 2, 'QB Account', 'COA_Map')
  const coa: FpaCoa[] = []
  const seenAcct = new Set<string>()
  for (let r = 5; r <= coaG.length; r++) {
    const account = str(at(coaG, r, 2))
    if (!account) continue
    if (seenAcct.has(account)) continue
    seenAcct.add(account)
    coa.push({
      account,
      gl: str(at(coaG, r, 3)),
      qb_type: str(at(coaG, r, 4)),
      kpi_group: str(at(coaG, r, 5)),
      dashboard_row: str(at(coaG, r, 8)),
      ebitda_addback: str(at(coaG, r, 9)),
    })
  }

  // Budget vs Actual: the by-location table and the company total.
  const bva = grid(utils, wb, 'Budget vs Actual', false)
  const budget: FpaBudget[] = []
  const budgetNotes: string[] = []
  if (bva) {
    expect(bva, 26, 2, 'Key', 'Budget vs Actual')
    for (let r = 2; r <= 6; r++) {
      const t = str(at(bva, r, 2))
      if (t) budgetNotes.push(t.replace(/^•\s*/, ''))
    }
    const row = (r: number, key: string): FpaBudget => ({
      key,
      location: str(at(bva, r, 3)),
      region: str(at(bva, r, 4)),
      landlord: str(at(bva, r, 5)),
      in_budget: bool(at(bva, r, 6)),
      revenue_actual: num(at(bva, r, 7)),
      revenue_budget: num(at(bva, r, 8)),
      ebitda_actual: num(at(bva, r, 11)),
      ebitda_budget: num(at(bva, r, 12)),
      adj_ebitda_actual: num(at(bva, r, 14)),
      adj_ebitda_budget: num(at(bva, r, 15)),
      sort: budget.length,
    })
    for (let r = 27; r <= bva.length; r++) {
      const key = str(at(bva, r, 2))
      const loc = str(at(bva, r, 3))
      if (loc?.toUpperCase() === 'TOTAL COMPANY') {
        budget.push({ ...row(r, 'TOTAL'), location: 'Total company', region: null })
        break
      }
      if (key && /^(S\d+|CORP|SPOT|UNCL)$/.test(key)) budget.push(row(r, key))
    }
  }

  // FC_Calc: the forecast engine, per site x metric x month.
  const fc = grid(utils, wb, 'FC_Calc', false)
  const forecast: FpaForecast[] = []
  if (fc) {
    expect(fc, 5, 1, 'Key|Metric', 'FC_Calc')
    const fcMonths = monthColumns(fc, 4, 8)
    for (let r = 6; r <= fc.length; r++) {
      const k = str(at(fc, r, 1))
      if (!k || !k.includes('|')) continue
      const e = str(at(fc, r, 2)) ?? k.split('|')[0]
      const m = str(at(fc, r, 7)) ?? k.slice(k.indexOf('|') + 1)
      for (const { col, d } of fcMonths) {
        const v = num(at(fc, r, col))
        if (v != null) forecast.push({ e, m, d, v, reg: str(at(fc, r, 3)), seg: str(at(fc, r, 4)), ss: bool(at(fc, r, 6)) })
      }
    }
  }
  const fcSheet = grid(utils, wb, 'FORECAST', false)
  const forecastNotes: string[] = []
  if (fcSheet) {
    for (let r = 54; r <= Math.min(fcSheet.length, 70); r++) {
      const t = str(at(fcSheet, r, 2))
      if (t?.startsWith('•')) forecastNotes.push(t.replace(/^•\s*/, ''))
    }
  }

  return {
    label: versionLabel(fileName),
    fileName: fileName.split(/[\\/]/).pop() ?? fileName,
    lastClosed,
    info: {
      subtitle: readme ? str(at(readme, 2, 2)) : null,
      definitions: labelled(25, 30),
      data_notes: labelled(33, 38),
      budget_title: bva ? str(at(bva, 1, 2)) : null,
      budget_notes: budgetNotes,
      forecast_title: fcSheet ? str(at(fcSheet, 1, 2)) : null,
      forecast_notes: forecastNotes,
      months: { first: plMonths[0] ?? null, last: plMonths[plMonths.length - 1] ?? null },
    },
    entities, sites, metrics, pl, coa, budget, forecast,
  }
}
