// Run from op/: DENO_NO_PACKAGE_JSON=1 npx deno test --no-lock supabase/functions/ask-operator/fpa_test.ts
import { assert, assertStringIncludes } from 'jsr:@std/assert@1'
import { fpaPrompt } from './fpa.ts'

Deno.test('the FP&A note names the version and month, the views and the EBITDA rule', () => {
  const p = fpaPrompt({ label: 'Oct-2026 Final NOV 11 v2', last_closed_month: '2026-10-01', info: { budget_title: 'Budget vs Actual — YTD Jan–Sep 2026', forecast_title: null } })
  assertStringIncludes(p, 'version "Oct-2026 Final NOV 11 v2", last closed month October 2026')
  for (const v of ['fpa_current_metrics', 'fpa_current_pl_lines', 'fpa_current_budget_ytd', 'fpa_current_forecast', 'fpa_current_sites']) assertStringIncludes(p, v)
  assertStringIncludes(p, 'EBITDA = Gross Profit - Total Operating Expenses')
  assertStringIncludes(p, 'Budget vs Actual — YTD Jan–Sep 2026 by location')
  assertStringIncludes(p, 'never sum it across months')
})

Deno.test('a version without a last closed month still reads', () => {
  const p = fpaPrompt({ label: 'x', last_closed_month: null })
  assertStringIncludes(p, 'last closed month unknown')
  assert(p.includes('the forecast, per site'))
})
