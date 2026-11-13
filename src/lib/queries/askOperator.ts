import { supabase } from '@/lib/supabase'

// "Ask Operator" data assistant. Everything runs in the ask-operator edge
// function, which queries the database read-only under the caller's own RLS.
export type AskTurn = { role: 'user' | 'assistant'; content: string }
export type AskStep = { tool?: string; sql?: string; rowCount?: number; error?: string }
export type AskResult = { answer?: string; steps?: AskStep[]; error?: string; message?: string }

// A choice the assistant offers the user to pick from.
export type AskChoice = { label: string; hint?: string }

// A structured report the assistant hands off for the client to render as a PDF.
export type ReportSection =
  | { type: 'text'; heading?: string; body?: string }
  | { type: 'table'; heading?: string; columns?: string[]; rows?: string[][] }
  | { type: 'stats'; heading?: string; items?: { label: string; value: string }[] }
export type ReportSpec = { title: string; subtitle?: string; sections: ReportSection[] }

// A structured action the assistant emits alongside text: a picker to show, or
// a report to render.
export type AskAction =
  | { kind: 'choices'; options: AskChoice[]; allow_custom?: boolean }
  | { kind: 'report'; spec: ReportSpec }

// Progress the function reports while the answer is still being written.
//   phase    — what it is doing right now (drives the status line)
//   delta    — answer text, token by token
//   preamble — the text so far was narration before a tool call, not the answer
//   step     — a tool finished (feeds the "queries I ran" panel)
//   action   — a picker or report to render alongside the answer
export type AskEvent =
  | { t: 'phase'; phase: 'thinking' | 'tool'; tool?: string; detail?: string }
  | { t: 'delta'; text: string }
  | { t: 'preamble' }
  | { t: 'step'; step: AskStep }
  | { t: 'action'; kind: 'choices'; payload: { options?: AskChoice[]; allow_custom?: boolean } }
  | { t: 'action'; kind: 'report'; payload: ReportSpec }
  | { t: 'done'; answer?: string; steps?: AskStep[] }
  | { t: 'error'; error?: string; message?: string }
  | { t: 'conversation'; id: string; title: string; created?: boolean }

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ask-operator`

function friendlyError(body: AskResult | null, fallback: string): string {
  if (body?.error === 'no_key') return 'The assistant needs an Anthropic API key configured.'
  return body?.message ?? fallback
}

export const askOperator = {
  ask: (question: string, history: AskTurn[]) =>
    supabase.functions.invoke('ask-operator', { body: { question, history } }),

  // Streaming ask. supabase.functions.invoke() buffers the whole response, so
  // this goes straight to fetch and parses the SSE frames itself. Throws on
  // anything that stops the answer from starting; everything after that is
  // delivered as an `error` event.
  askStream: async (
    question: string,
    history: AskTurn[],
    onEvent: (ev: AskEvent) => void,
    signal?: AbortSignal,
    // The saved conversation this question continues (null starts a new one).
    conversationId?: string | null,
  ): Promise<void> => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new Error('Your session expired. Sign in again.')

    const res = await fetch(FN_URL, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ question, history, stream: true, ...(conversationId ? { conversation_id: conversationId } : {}) }),
    })

    const isStream = (res.headers.get('content-type') ?? '').includes('text/event-stream')
    if (!res.ok || !res.body || !isStream) {
      // Either an error body, or a deployment of the function that predates
      // `stream` and answered in one shot. Both arrive as plain JSON.
      let body: AskResult | null
      try {
        body = (await res.json()) as AskResult
      } catch {
        body = null
      }
      if (res.ok && body?.answer) {
        onEvent({ t: 'done', answer: body.answer, steps: body.steps })
        return
      }
      throw new Error(friendlyError(body, 'Something went wrong answering that.'))
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let cut = buf.indexOf('\n\n')
      while (cut !== -1) {
        const frame = buf.slice(0, cut)
        buf = buf.slice(cut + 2)
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue
          try {
            onEvent(JSON.parse(line.slice(5).trim()) as AskEvent)
          } catch {
            // ignore a frame we can't parse rather than killing the stream
          }
        }
        cut = buf.indexOf('\n\n')
      }
    }
  },
}

// Saved conversations (ai_conversations / ai_messages). Each person sees only
// their own; ask-operator writes the turns, the app lists, reads, renames and
// deletes them.
export type AiConversation = { id: string; title: string; created_at: string; last_message_at: string }
export type AiStoredMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  steps: AskStep[] | null
  actions: AskAction[] | null
  error: boolean
  created_at: string
}
export type AiSearchHit = { conversation_id: string; title: string; role: string; created_at: string; snippet: string }

export const askHistory = {
  list: async (limit = 100): Promise<AiConversation[]> => {
    const { data, error } = await supabase
      .from('ai_conversations')
      .select('id, title, created_at, last_message_at')
      .order('last_message_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data ?? []) as AiConversation[]
  },
  get: async (id: string): Promise<{ conversation: AiConversation | null; messages: AiStoredMessage[] }> => {
    const [c, m] = await Promise.all([
      supabase.from('ai_conversations').select('id, title, created_at, last_message_at').eq('id', id).maybeSingle(),
      supabase
        .from('ai_messages')
        .select('id, role, content, steps, actions, error, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true })
        .limit(500),
    ])
    if (c.error) throw c.error
    if (m.error) throw m.error
    return { conversation: (c.data ?? null) as AiConversation | null, messages: (m.data ?? []) as unknown as AiStoredMessage[] }
  },
  // Words in past messages (stemmed), best matches first.
  search: async (query: string): Promise<AiSearchHit[]> => {
    const { data, error } = await supabase.rpc('ai_search_conversations', { p_query: query, p_limit: 30 })
    if (error) throw error
    return (data ?? []) as AiSearchHit[]
  },
  rename: async (id: string, title: string) => {
    const { error } = await supabase.from('ai_conversations').update({ title }).eq('id', id)
    if (error) throw error
  },
  remove: async (id: string) => {
    const { error } = await supabase.from('ai_conversations').delete().eq('id', id)
    if (error) throw error
  },
}
