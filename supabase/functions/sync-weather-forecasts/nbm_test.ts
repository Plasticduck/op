// Run from op/: DENO_NO_PACKAGE_JSON=1 npx deno test --no-lock supabase/functions/sync-weather-forecasts/nbm_test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { forecastDays, forecastsFor, morningRuns, normRow, parseCsv, type NbmRow } from './nbm.ts'

// The shape of the IEM bulk download (trimmed to the columns that matter, plus
// one we ignore), for KLBB on 2026-09-28: the 12Z extended run, and a 00Z run.
const NBE_CSV = [
  'runtime,ftime,model,tmp,p12,q12,station,txn,t12',
  '2026-09-28 00:00:00,2026-09-28 12:00:00,NBE,60,5,0,KLBB,58,10/5',
  '2026-09-28 12:00:00,2026-09-29 12:00:00,NBE,69,18,1,KLBB,69,20/1',
  '2026-09-28 12:00:00,2026-09-30 00:00:00,NBE,86,60,17,KLBB,86,31/20',
  '2026-09-28 12:00:00,2026-09-30 12:00:00,NBE,67,77,66,KLBB,67,40/2',
  '2026-09-28 12:00:00,2026-10-01 00:00:00,NBE,85,48,10,KLBB,85,22/9',
  '2026-09-28 12:00:00,2026-10-01 12:00:00,NBE,59,8,0,KLBB,59,,',
].join('\n')
const rows = (csv: string) => parseCsv(csv).map(normRow).filter((r): r is NbmRow => r !== null)

Deno.test('CSV and API rows read the same', () => {
  const fromCsv = rows(NBE_CSV)[1]
  const fromApi = normRow({ runtime: '2026-09-28 12:00', ftime: '2026-09-29 12:00', runtime_utc: '2026-09-28T12:00:00.000', ftime_utc: '2026-09-29T12:00:00.000', txn: 69, p12: 18, q12: 1 })
  assertEquals(fromCsv, { runtime: '2026-09-28T12:00Z', ftime: '2026-09-29T12:00Z', txn: 69, p12: 18, q12: 1 })
  assertEquals(fromApi, fromCsv)
  // Blanks are null, not 0.
  assertEquals(normRow({ runtime: '2026-09-28 12:00', ftime: '2026-09-29 00:00', txn: '', p12: null, q12: undefined })?.txn, null)
  assertEquals(normRow({ runtime: 'garbage', ftime: '2026-09-29 00:00' }), null)
})

Deno.test('the morning run: 12Z, else the closest from 10Z to 16Z', () => {
  const r = (runtime: string) => ({ runtime, ftime: runtime, txn: null, p12: null, q12: null })
  const m = morningRuns([r('2026-06-01T00:00Z'), r('2026-06-01T12:00Z'), r('2026-06-01T13:00Z'), r('2026-06-02T13:00Z'), r('2026-06-02T11:00Z'), r('2026-06-03T18:00Z'), r('2026-06-04T09:00Z')])
  assertEquals([...m.entries()], [['2026-06-01', '2026-06-01T12:00Z'], ['2026-06-02', '2026-06-02T11:00Z']])
})

Deno.test('extended run: high and daytime rain from 00Z the next day, low and overnight rain from 12Z', () => {
  const out = forecastDays('KLBB', 'NBE', rows(NBE_CSV), '2026-09-28T12:00Z')
  assertEquals(out.map((o) => [o.forecast_date, o.lead_days]), [['2026-09-29', 1], ['2026-09-30', 2], ['2026-10-01', 3]])
  // Sep 29: low 69 that morning, high 86 that afternoon, 60% / 0.17" daytime.
  assertEquals(out[0], {
    station: 'KLBB', issued_at: '2026-09-28T12:00Z', issued_date: '2026-09-28', forecast_date: '2026-09-29', lead_days: 1, model: 'NBE',
    temp_max: 86, temp_min: 69, precip_chance: 60, precip_chance_night: 18, precip_in: 0.17, precip_in_night: 0.01,
  })
  // Sep 30: the 0.66" overnight before it.
  assertEquals([out[1].temp_min, out[1].precip_chance_night, out[1].precip_in_night, out[1].temp_max], [67, 77, 0.66, 85])
  // Oct 1: only its morning low is in this run.
  assertEquals([out[2].temp_min, out[2].temp_max, out[2].precip_chance], [59, null, null])
})

Deno.test('short-range run: the same day only, no low', () => {
  const nbs = rows([
    'runtime,ftime,model,txn,p12,q12',
    '2026-09-28 12:00:00,2026-09-28 18:00:00,NBS,,,',
    '2026-09-28 12:00:00,2026-09-29 00:00:00,NBS,88,10,0',
    '2026-09-28 12:00:00,2026-09-29 12:00:00,NBS,70,20,2',
    '2026-09-28 12:00:00,2026-09-30 00:00:00,NBS,85,55,15',
  ].join('\n'))
  const out = forecastDays('KLBB', 'NBS', nbs, '2026-09-28T12:00Z')
  assertEquals(out.length, 1)
  assertEquals([out[0].forecast_date, out[0].lead_days, out[0].temp_max, out[0].temp_min, out[0].precip_chance, out[0].precip_in], ['2026-09-28', 0, 88, null, 10, 0])
})

Deno.test('a span keeps only mornings inside it, from both models', () => {
  const nbs = rows('runtime,ftime,model,txn,p12,q12\n2026-09-28 12:00:00,2026-09-29 00:00:00,NBS,88,10,0')
  const all = forecastsFor('KLBB', rows(NBE_CSV), nbs, '2026-09-28', '2026-09-28')
  assertEquals(all.map((o) => `${o.model}:${o.lead_days}`), ['NBE:1', 'NBE:2', 'NBE:3', 'NBS:0'])
  assertEquals(forecastsFor('KLBB', rows(NBE_CSV), nbs, '2026-09-29', '2026-09-30').length, 0)
})
