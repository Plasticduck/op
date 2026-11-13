// Offline tests of Operator AI's conversation history (stub database).
// Run from op/: DENO_NO_PACKAGE_JSON=1 npx deno test --no-lock supabase/functions/ask-operator/history_test.ts
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { openConversation, recall, recentNote, saveAnswer, titleFrom } from './history.ts'

// A tiny stand-in for supabase-js: records inserts/updates, answers selects from `db`.
function fakeSvc(db: { convo?: { id: string; title: string } | null; messages?: { role: string; content: string }[]; recent?: unknown[] }) {
  const log: { op: string; table: string; row?: unknown; filters: string[] }[] = []
  const builder = (table: string) => {
    const filters: string[] = []
    let op = 'select'
    let row: unknown
    const result = () => {
      log.push({ op, table, row, filters: [...filters] })
      if (op === 'insert' && table === 'ai_conversations') return { data: { id: 'new-1', title: (row as { title: string }).title }, error: null }
      if (op !== 'select') return { data: null, error: null }
      if (table === 'ai_conversations') return { data: filters.some((f) => f.startsWith('eq:id')) ? db.convo ?? null : db.recent ?? [], error: null }
      return { data: db.messages ?? [], error: null }
    }
    const b: Record<string, unknown> = {
      select: () => b, order: () => b, limit: () => b, neq: (k: string) => (filters.push(`neq:${k}`), b),
      eq: (k: string, v: unknown) => (filters.push(`eq:${k}=${v}`), b),
      insert: (r: unknown) => ((op = 'insert'), (row = r), b), update: (r: unknown) => ((op = 'update'), (row = r), b),
      maybeSingle: () => Promise.resolve(result()), single: () => Promise.resolve(result()),
      then: (ok: (v: unknown) => void) => ok(result()),
    }
    return b
  }
  return { svc: { from: builder } as unknown as SupabaseClient, log }
}

Deno.test('titles: the first question, cut at a word', () => {
  assertEquals(titleFrom('  Which site washed   the most cars last month? '), 'Which site washed the most cars last month?')
  const t = titleFrom('Compare conversion, churn and recharge for every Lubbock site over the last ninety days please')
  assert(t.endsWith('…') && t.length <= 71, t)
  assert(!t.includes('ninety days please'))
})

Deno.test('continuing a conversation: earlier turns oldest first, starting with the user', async () => {
  const id = '11111111-2222-3333-4444-555555555555'
  const { svc, log } = fakeSvc({
    convo: { id, title: 'MW16 hours' },
    // Newest first, as the query orders them; an assistant turn is oldest here.
    messages: [
      { role: 'assistant', content: 'Busiest 3 to 5 PM.' },
      { role: 'user', content: 'Busiest hours at MW16?' },
      { role: 'assistant', content: 'Earlier answer whose question fell off.' },
    ],
  })
  const c = await openConversation(svc, 'u1', 'acct', id, 'And on weekends?')
  assertEquals(c.created, false)
  assertEquals(c.id, id)
  assertEquals(c.prior, [{ role: 'user', content: 'Busiest hours at MW16?' }, { role: 'assistant', content: 'Busiest 3 to 5 PM.' }])
  const ins = log.find((l) => l.op === 'insert' && l.table === 'ai_messages')
  assertEquals((ins?.row as { role: string; content: string; conversation_id: string }).content, 'And on weekends?')
  assertEquals((ins?.row as { conversation_id: string }).conversation_id, id)
  // Only the person's own conversation is looked up.
  assert(log.some((l) => l.table === 'ai_conversations' && l.filters.includes('eq:user_id=u1')))
})

Deno.test("someone else's (or a deleted) conversation id starts a new one", async () => {
  const { svc, log } = fakeSvc({ convo: null })
  const c = await openConversation(svc, 'u1', 'acct', '11111111-2222-3333-4444-555555555555', 'What is open at MW03?')
  assertEquals(c, { id: 'new-1', title: 'What is open at MW03?', created: true, prior: [] })
  assert(log.some((l) => l.op === 'insert' && l.table === 'ai_conversations'))
  const bad = await openConversation(fakeSvc({}).svc, 'u1', 'acct', 'not-a-uuid', 'Hi')
  assertEquals(bad.created, true)
})

Deno.test('saving an answer keeps steps and actions, and moves the conversation up', async () => {
  const { svc, log } = fakeSvc({})
  await saveAnswer(svc, 'u1', 'c1', { content: 'Here it is.', steps: [{ tool: 'run_sql' }], actions: [{ kind: 'report', spec: { title: 'X' } }] })
  const row = log.find((l) => l.op === 'insert')?.row as Record<string, unknown>
  assertEquals(row.role, 'assistant')
  assertEquals(row.steps, [{ tool: 'run_sql' }])
  assertEquals(row.error, false)
  assert(log.some((l) => l.op === 'update' && l.table === 'ai_conversations' && l.filters.includes('eq:id=c1')))
})

Deno.test('the model is told what it can recall', async () => {
  const none = await recentNote(fakeSvc({ recent: [] }).svc, 'u1', null)
  assertStringIncludes(none, 'no earlier')
  const some = await recentNote(fakeSvc({ recent: [{ id: 'a', title: 'MW16 "busy" hours', last_message_at: '2026-11-12T15:00:00Z' }] }).svc, 'u1', 'cur')
  assertStringIncludes(some, "\"MW16 'busy' hours\" (2026-11-12, id a)")
  assertStringIncludes(some, 'recall_conversations')
})

Deno.test('recall: the current conversation is not reread', async () => {
  const out = JSON.parse(await recall({} as SupabaseClient, { conversation_id: '11111111-2222-3333-4444-555555555555' }, '11111111-2222-3333-4444-555555555555'))
  assertStringIncludes(out.note, 'current conversation')
})
