// tunnel-from-photos: Supabase Edge Function (Deno).
// On the Tunnel page (Maintenance Inventory > Tunnel), a manager adds up to 12 photos of
// the real tunnel and Claude works out every machine in them and where it stands, in the
// drawing's own feet, so the drawing comes out 1:1. With no drawing yet it proposes one
// ("create"); with one, it proposes corrections ("update"). Nothing is saved here: the
// page shows the proposal and the manager accepts it through the usual mi_tunnel_save.
//
// The photos aren't kept. They arrive in the request, go to Claude, and are dropped when
// the request ends; nothing here stores or logs them.
//
// Who: anyone who can edit the site's drawing (mi_tunnel_get's can_edit; the same call
// checks the site is theirs). It runs as the caller, so the database's own checks apply.
//
// An answer can take minutes, longer than Supabase lets a request sit silent (150 s). So
// once the checks pass it answers 200 straight away and sends a space every 10 s while
// Claude works, then the JSON: a proposal, or { error, message }. JSON.parse skips the
// leading spaces, so supabase.functions.invoke reads it like any other JSON answer.
// Errors found before that (bad request, no access, no key) are plain 4xx/5xx JSON.
//
// The prompt, schema, request checks and the tidy-up of Claude's answer are in plan.ts.
//
// Secrets: ANTHROPIC_API_KEY (503 'no_key' if absent).
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'
import {
  buildPlan,
  finalText,
  LIMITS,
  normalizeProposal,
  type Plan,
  type PhotosErrorCode,
  type PhotosResponse,
  type Prior,
  type SiteDrawing,
  sanitizePrior,
  validateRequest,
} from './plan.ts'

const MODEL = 'claude-opus-5-5'
// medium is this model's own default and Anthropic's starting point for it: at a given
// level it thinks more than earlier models did, and every token of thinking spends the
// time budget below. Raise it only if runs on real photos show the drawings get better.
const EFFORT = 'medium'
// Thinking is always on for this model and takes most of this; the drawing itself is a
// few thousand tokens. The time budget, not this cap, is what ends a long call: a lower
// cap would only cut off answers that could still have finished in time. The log line's
// call timings are what to size either one by.
const MAX_TOKENS = 32000
// Paid plans stop a function at 400 s of wall clock. Claude gets what's left of 370 s
// after the checks, which leaves time to say so before the platform cuts us off.
const AI_BUDGET_MS = 370_000
const HEARTBEAT_MS = 10_000
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

const ALLOWED_ORIGINS = new Set<string>([
  'https://operator.washlyfe.com',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
])
function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://operator.washlyfe.com'
  return {
    'Access-Control-Allow-Origin': allow,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })
const fail = (error: PhotosErrorCode, message: string, status: number, origin: string | null) => json({ error, message }, status, origin)

const TOO_SLOW = 'Reading the photos took too long. Try again with fewer photos.'

// What the SDK's error says, without the status and JSON around it.
function apiDetail(e: unknown): string {
  const inner = (e as { error?: { error?: { message?: unknown } } } | null)?.error?.error?.message
  if (typeof inner === 'string' && inner) return inner
  return e instanceof Error ? e.message : String(e)
}

function aiMessage(e: unknown): string {
  if (e instanceof Anthropic.RateLimitError) return 'Claude is busy right now. Try again in a minute.'
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return "The AI key isn't working. Ask an admin to check it."
  }
  if (e instanceof Anthropic.BadRequestError) return `Claude couldn't take these photos: ${apiDetail(e)}`
  if (e instanceof Anthropic.APIError && typeof e.status === 'number' && e.status >= 500) {
    return 'Claude is having trouble right now. Try again in a few minutes.'
  }
  return `The photos couldn't be read: ${apiDetail(e)}`
}

// The parts of the final message this function reads.
type Final = {
  stop_reason: string | null
  model: string
  content: Array<{ type: string; text?: unknown }>
  usage?: { input_tokens?: number; output_tokens?: number }
}

// The parts of the SDK's message stream this function uses, and of the events it sends.
type StreamEvent = {
  type: string
  message?: { usage?: { input_tokens?: unknown; output_tokens?: unknown } }
  delta?: { type?: unknown; text?: unknown }
  usage?: { output_tokens?: unknown }
}
type Streamed = {
  on(event: 'streamEvent', listener: (event: StreamEvent) => void): unknown
  finalMessage(): Promise<unknown>
}

// How far a call got, for the log line, in ms from the start of the request: Claude's
// first event, the first of the answer's text (what comes before it is thinking, which
// is most of the wait), how much text came, and the token counts as last reported (the
// output count arrives only at the end). A call the time budget cuts off is billed for
// what it wrote and has no final message, so this is the only record of how close it came.
type Progress = { first_ms: number | null; text_ms: number | null; text_chars: number; input_tokens: number | null; output_tokens: number | null }

function watch(stream: Streamed, progress: Progress, started: number): Streamed {
  stream.on('streamEvent', (ev) => {
    const at = Date.now() - started
    progress.first_ms ??= at
    if (ev.type === 'message_start') {
      const u = ev.message?.usage
      if (typeof u?.input_tokens === 'number') progress.input_tokens = u.input_tokens
      if (typeof u?.output_tokens === 'number') progress.output_tokens = u.output_tokens
    } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string') {
      progress.text_ms ??= at
      progress.text_chars += ev.delta.text.length
    } else if (ev.type === 'message_delta' && typeof ev.usage?.output_tokens === 'number') {
      progress.output_tokens = ev.usage.output_tokens
    }
  })
  return stream
}

async function analyze(anthropic: Anthropic, plan: Plan, signal: AbortSignal, progress: Progress, started: number): Promise<PhotosResponse> {
  const request = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: plan.system,
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema: plan.schema } },
    messages: [{ role: 'user', content: plan.content }],
  }

  // Streamed: the SDK won't send a request with this many max_tokens any other way. The
  // whole message is still read at the end; the page only waits for the result.
  // Server-side fallback re-runs a declined request on another model. If this account or
  // SDK version rejects the parameter, retry once without it, so a config mismatch can't
  // silently turn the feature off.
  let msg: Final
  try {
    const first = anthropic.beta.messages.stream({ ...request, betas: [FALLBACK_BETA], fallbacks: 'default' } as never, { signal })
    msg = (await watch(first as unknown as Streamed, progress, started).finalMessage()) as Final
  } catch (e) {
    if (!(e instanceof Anthropic.BadRequestError)) throw e
    const again = anthropic.messages.stream(request as never, { signal })
    msg = (await watch(again as unknown as Streamed, progress, started).finalMessage()) as Final
  }

  if (msg.stop_reason === 'refusal') {
    return { error: 'refused', message: "Claude wouldn't work from these photos. Try different ones, of the tunnel and its machines only." }
  }
  if (msg.stop_reason === 'max_tokens' || msg.stop_reason === 'model_context_window_exceeded') {
    return { error: 'too_long', message: 'The answer ran too long to finish. Try again with fewer photos.' }
  }
  const read = normalizeProposal(finalText(msg.content ?? []), plan.ctx)
  if ('error' in read) return read
  const usage =
    typeof msg.usage?.input_tokens === 'number' && typeof msg.usage?.output_tokens === 'number'
      ? { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens }
      : undefined
  return { proposal: read.proposal, model: msg.model ?? MODEL, ...(usage ? { usage } : {}) }
}

Deno.serve(async (req) => {
  const started = Date.now()
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return fail('bad_request', 'Send the photos with POST.', 405, origin)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return fail('no_key', 'ANTHROPIC_API_KEY is not configured.', 503, origin)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!/^Bearer\s+\S/i.test(authHeader)) return fail('forbidden', 'Sign in again.', 401, origin)
  // The caller's own client: mi_tunnel_get and mi_tunnel_template check who's asking.
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: who } = await userClient.auth.getUser()
  if (!who?.user) return fail('forbidden', 'Sign in again.', 401, origin)

  // A body that says it's too big is turned away before it's read.
  const declared = Number(req.headers.get('Content-Length') ?? 0)
  if (declared > LIMITS.bodyBytes) {
    return fail('bad_request', 'The photos add up to more than 14 MB. Use fewer photos or smaller ones.', 400, origin)
  }
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return fail('bad_request', "The photos didn't arrive. Try again.", 400, origin)
  }
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return fail('bad_request', 'Send the photos as JSON.', 400, origin)
  }
  const checked = validateRequest(body, raw.length)
  if (!checked.ok) return fail('bad_request', checked.message, 400, origin)
  const ask = checked.value

  const got = await userClient.rpc('mi_tunnel_get', { p_site: ask.site_id, p_tunnel: ask.tunnel_no })
  if (got.error) {
    // 42501 is the database saying the site isn't theirs, or Maintenance Inventory isn't.
    if (got.error.code === '42501') return fail('forbidden', got.error.message, 403, origin)
    return fail('ai_failed', `This site's drawing couldn't be loaded: ${got.error.message}`, 502, origin)
  }
  const site = got.data as SiteDrawing | null
  if (!site || site.can_edit !== true) return fail('forbidden', "You can't change this site's tunnel drawing.", 403, origin)

  // A new drawing starts from the company's first template (the one the empty Tunnel
  // page shows), else the typical tunnel the app sent. One with no shapes is no help.
  let start: { prior: Prior; source: string } | null = null
  if (!site.layout) {
    const tpl = (site.templates ?? []).find((t) => Number(t.items) > 0)
    if (tpl) {
      const t = await userClient.rpc('mi_tunnel_template', { p_layout: tpl.id })
      const d = t.data as { layout?: Record<string, unknown>; items?: unknown[] } | null
      const prior = !t.error && d?.layout ? sanitizePrior({ ...d.layout, items: d.items ?? [] }) : null
      if (prior) start = { prior, source: `the company's template "${tpl.name}"` }
    }
    if (!start && ask.prior) start = { prior: ask.prior, source: 'a typical express tunnel' }
  }

  const plan = buildPlan(ask, site, start)
  const anthropic = new Anthropic({ apiKey })
  const abort = new AbortController()
  let timedOut = false
  const enc = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true
      const send = (s: string) => {
        if (!open) return
        try {
          controller.enqueue(enc.encode(s))
        } catch {
          open = false // the page went away
        }
      }
      send(' ')
      const beat = setInterval(() => send(' '), HEARTBEAT_MS)
      const timer = setTimeout(() => {
        timedOut = true
        abort.abort()
      }, Math.max(1_000, AI_BUDGET_MS - (Date.now() - started)))

      try {
        const progress: Progress = { first_ms: null, text_ms: null, text_chars: 0, input_tokens: null, output_tokens: null }
        // Out of time is too much in the photos for one answer, the same as an answer that
        // ran past max_tokens, and the page says so for too_long.
        const out = await analyze(anthropic, plan, abort.signal, progress, started).catch(
          (e): PhotosResponse => (timedOut ? { error: 'too_long', message: TOO_SLOW } : { error: 'ai_failed', message: aiMessage(e) }),
        )
        console.log(JSON.stringify({
          fn: 'tunnel-from-photos',
          mode: plan.mode,
          photos: ask.photos.length,
          ms: Date.now() - started,
          result: 'error' in out ? out.error : 'proposal',
          ...('error' in out ? { message: out.message } : { items: out.proposal.items.length, removed: out.proposal.removed.length, usage: out.usage }),
          call: progress,
        }))
        send(JSON.stringify(out))
      } finally {
        clearInterval(beat)
        clearTimeout(timer)
        open = false
        try {
          controller.close()
        } catch {
          // already closed by the page hanging up
        }
      }
    },
    // The page closed or gave up: stop paying for an answer nobody will read.
    cancel() {
      abort.abort()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-transform',
      // Tell any proxy in front of us not to buffer, or the spaces can't keep it alive.
      'X-Accel-Buffering': 'no',
    },
  })
})
