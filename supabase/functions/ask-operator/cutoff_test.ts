// deno test supabase/functions/ask-operator/cutoff_test.ts
import { assertEquals, assertMatch } from 'jsr:@std/assert@1'
import type Anthropic from 'npm:@anthropic-ai/sdk'
import { appendUserNote, recoverCutOff } from './cutoff.ts'

const text = (t: string) => ({ type: 'text', text: t, citations: null }) as Anthropic.TextBlock
const call = (name: string, input: unknown = {}) =>
  ({ type: 'tool_use', id: `toolu_${name}`, name, input }) as Anthropic.ToolUseBlock

Deno.test('a report cut off mid-call: keeps the lead-in, asks for a smaller report', () => {
  // What the stalled answers looked like: one line, then a build_report that never finished.
  const cut = recoverCutOff([
    text('Now I have everything I need. Let me compile this into a comprehensive report.'),
    call('build_report', { title: 'Sites', sections: [{ type: 'table', rows: [['MW01'], ['MW0'] ] }] }),
  ])
  assertEquals(cut.tool, 'build_report')
  assertEquals(cut.kept, [{ type: 'text', text: 'Now I have everything I need. Let me compile this into a comprehensive report.' }])
  assertMatch(cut.note, /build_report again, smaller/)
})

Deno.test('a report cut off with no lead-in keeps nothing', () => {
  const cut = recoverCutOff([call('build_report')])
  assertEquals(cut.tool, 'build_report')
  assertEquals(cut.kept, [])
})

Deno.test('other calls in the same reply are named as not run', () => {
  const cut = recoverCutOff([text('Pulling both.'), call('run_sql', { query: 'select 1' }), call('run_sql')])
  assertEquals(cut.tool, 'run_sql')
  assertMatch(cut.note, /did not run/)
  assertMatch(cut.note, /other tool calls/)
})

Deno.test('written answer cut off: continue where it stopped', () => {
  const cut = recoverCutOff([text('| Site | Cars |\n|---|---|\n| MW01 | 4,1')])
  assertEquals(cut.tool, null)
  assertEquals(cut.kept.length, 1)
  assertMatch(cut.note, /Continue exactly where it stopped/)
})

Deno.test('blank text blocks are dropped', () => {
  assertEquals(recoverCutOff([text('  \n'), call('build_report')]).kept, [])
})

Deno.test('note joins a trailing user turn so turns keep alternating', () => {
  const results: Anthropic.MessageParam[] = [
    { role: 'user', content: 'q' },
    { role: 'assistant', content: [call('run_sql')] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_run_sql', content: '[]' }] },
  ]
  appendUserNote(results, 'finish it')
  assertEquals(results.length, 3)
  assertEquals((results[2].content as unknown[]).length, 2)
  assertEquals((results[2].content as { type: string; text?: string }[])[1], { type: 'text', text: 'finish it' })

  const plain: Anthropic.MessageParam[] = [{ role: 'user', content: 'q' }]
  appendUserNote(plain, 'finish it')
  assertEquals(plain, [{ role: 'user', content: 'q\n\nfinish it' }])

  const afterText: Anthropic.MessageParam[] = [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'partial' }]
  appendUserNote(afterText, 'continue')
  assertEquals(afterText[2], { role: 'user', content: 'continue' })
})
