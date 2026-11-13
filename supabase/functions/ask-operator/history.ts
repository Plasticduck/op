// Operator AI conversation history (ai_conversations / ai_messages, migration
// 0237). ask-operator writes each turn with the service role, so an answer is kept
// even if the page closes mid-answer; people read, rename and delete their own
// conversations from the app under RLS. recall_conversations lets the model search
// and reread the person's earlier conversations.

import type Anthropic from 'npm:@anthropic-ai/sdk'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const RECALL_TOOL: Anthropic.Tool = {
  name: 'recall_conversations',
  description:
    "Search and reread this user's own earlier Operator AI conversations (not the current one). Use when they refer to something discussed before (\"last time\", \"you told me\", \"that report we made\", \"what did we find about MW16\"), ask what you've talked about, or when an earlier answer would help. Pass query (words to search for) to find matching past messages with their conversation and date; pass conversation_id (from a search result or the recent list) to read that conversation; pass neither to list recent conversations. Past answers reflect the data at the time; re-check live data when numbers matter now.",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Words to search for in past conversations.' },
      conversation_id: { type: 'string', description: 'A past conversation to read in full.' },
    },
  },
}

export type Turn = { role: 'user' | 'assistant'; content: string }
export type Convo = { id: string; title: string; created: boolean; prior: Turn[] }

const PRIOR_TURNS = 16 // earlier turns of this conversation given to the model
const PRIOR_CHARS = 4000
const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s)

export function titleFrom(question: string): string {
  const q = question.replace(/\s+/g, ' ').trim()
  if (q.length <= 70) return q
  const cut = q.slice(0, 70)
  const sp = cut.lastIndexOf(' ')
  return `${(sp > 40 ? cut.slice(0, sp) : cut).replace(/[\s,.;:!?-]+$/, '')}…`
}

// The conversation this question belongs to (a new one when none is given or the
// given one isn't theirs), its earlier turns, and the question saved into it.
export async function openConversation(
  svc: SupabaseClient, uid: string, accountId: string, requestedId: unknown, question: string,
): Promise<Convo> {
  let convo: Convo | null = null
  if (isUuid(requestedId)) {
    const { data } = await svc.from('ai_conversations').select('id, title').eq('id', requestedId).eq('user_id', uid).maybeSingle()
    if (data) {
      const { data: msgs } = await svc.from('ai_messages').select('role, content')
        .eq('conversation_id', data.id).eq('error', false)
        .order('created_at', { ascending: false }).limit(PRIOR_TURNS)
      const prior = ((msgs ?? []) as Turn[]).reverse()
        .filter((m) => m.content)
        .map((m) => ({ role: m.role, content: m.content.length > PRIOR_CHARS ? `${m.content.slice(0, PRIOR_CHARS)}…` : m.content }))
      // The model's history must start with the user.
      while (prior.length && prior[0].role !== 'user') prior.shift()
      convo = { id: data.id as string, title: data.title as string, created: false, prior }
    }
  }
  if (!convo) {
    const { data, error } = await svc.from('ai_conversations')
      .insert({ account_id: accountId, user_id: uid, title: titleFrom(question) }).select('id, title').single()
    if (error || !data) throw new Error(error?.message ?? 'could not start a conversation')
    convo = { id: data.id as string, title: data.title as string, created: true, prior: [] }
  }
  const now = new Date().toISOString()
  const { error } = await svc.from('ai_messages').insert({ conversation_id: convo.id, user_id: uid, role: 'user', content: question, created_at: now })
  if (error) throw new Error(error.message)
  await svc.from('ai_conversations').update({ last_message_at: now }).eq('id', convo.id)
  return convo
}

export async function saveAnswer(
  svc: SupabaseClient, uid: string, conversationId: string,
  a: { content: string; steps?: unknown[]; actions?: unknown[]; error?: boolean },
): Promise<void> {
  const now = new Date().toISOString()
  await svc.from('ai_messages').insert({
    conversation_id: conversationId, user_id: uid, role: 'assistant', content: a.content,
    steps: a.steps?.length ? a.steps : null, actions: a.actions?.length ? a.actions : null,
    error: !!a.error, created_at: now,
  })
  await svc.from('ai_conversations').update({ last_message_at: now }).eq('id', conversationId)
}

// A few recent conversation titles, so the model knows what it can recall.
export async function recentNote(svc: SupabaseClient, uid: string, excludeId: string | null): Promise<string> {
  let q = svc.from('ai_conversations').select('id, title, last_message_at').eq('user_id', uid)
    .order('last_message_at', { ascending: false }).limit(9)
  if (excludeId) q = q.neq('id', excludeId)
  const { data } = await q
  const list = (data ?? []).slice(0, 8)
  if (!list.length) return ' This user has no earlier Operator AI conversations yet.'
  const items = list.map((c) => `"${String(c.title).replace(/"/g, "'")}" (${String(c.last_message_at).slice(0, 10)}, id ${c.id})`).join('; ')
  return ` This user's recent earlier Operator AI conversations, newest first: ${items}. Use recall_conversations to search or reread them when the user refers back to an earlier conversation or one would help; say when you are drawing on one.`
}

// recall_conversations: runs as the user (RLS keeps it to their own).
export async function recall(
  userClient: SupabaseClient, input: { query?: string; conversation_id?: string }, currentId: string | null,
): Promise<string> {
  if (isUuid(input.conversation_id)) {
    if (input.conversation_id === currentId) return JSON.stringify({ note: 'That is the current conversation; its turns are already in context.' })
    const [{ data: c }, { data: msgs, error }] = await Promise.all([
      userClient.from('ai_conversations').select('id, title, created_at, last_message_at').eq('id', input.conversation_id).maybeSingle(),
      userClient.from('ai_messages').select('role, content, created_at, error').eq('conversation_id', input.conversation_id)
        .order('created_at', { ascending: true }).limit(40),
    ])
    if (error) throw new Error(error.message)
    if (!c) return JSON.stringify({ note: 'No such conversation for this user.' })
    return JSON.stringify({
      conversation: { id: c.id, title: c.title, started: c.created_at, last: c.last_message_at },
      messages: (msgs ?? []).filter((m) => !m.error).map((m) => ({
        role: m.role, at: String(m.created_at).slice(0, 16).replace('T', ' '),
        content: String(m.content).length > 2500 ? `${String(m.content).slice(0, 2500)}…` : m.content,
      })),
    })
  }
  const query = String(input.query ?? '').trim()
  if (query) {
    const { data, error } = await userClient.rpc('ai_search_conversations', { p_query: query, p_exclude: currentId, p_limit: 12 })
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { conversation_id: string; title: string; role: string; created_at: string; snippet: string }[]
    return JSON.stringify({
      query,
      matches: rows.map((r) => ({ conversation_id: r.conversation_id, title: r.title, role: r.role, at: String(r.created_at).slice(0, 16).replace('T', ' '), snippet: r.snippet })),
      ...(rows.length ? {} : { note: 'Nothing in past conversations matched. Try other words, or list recent conversations.' }),
    })
  }
  let q = userClient.from('ai_conversations').select('id, title, created_at, last_message_at').order('last_message_at', { ascending: false }).limit(20)
  if (currentId) q = q.neq('id', currentId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return JSON.stringify({ conversations: (data ?? []).map((c) => ({ id: c.id, title: c.title, started: String(c.created_at).slice(0, 10), last: String(c.last_message_at).slice(0, 10) })) })
}
