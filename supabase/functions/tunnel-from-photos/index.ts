// tunnel-from-photos: Supabase Edge Function (Deno).
// On the Tunnel page (Maintenance Inventory > Tunnel), a manager adds photos of the real
// tunnel (up to 600, the most Claude takes in one request) and Claude works out every
// machine in them and where it stands, in the drawing's own feet, so the drawing comes out
// 1:1. With no drawing yet it proposes one ("create"); with one, it proposes corrections
// ("update"). Nothing is saved here: the page shows the proposal and the manager accepts
// it through the usual mi_tunnel_save.
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
// The upload comes first, though: nothing goes out before the whole request has arrived
// (see below), so the photos themselves have to arrive inside those 150 s. For the page's
// largest request, 30,000,000 characters, that takes an upload of about 1.6 Mbps.
//
// No answer goes out before the request's body has been read to its end. On Supabase, an
// answer sent while the page is still uploading is held back until the platform gives up
// on the request: POSTs of 1, 4 and 8 MB that this function turned away without reading
// them (401) reached the caller as a 504 after about 160 s, while an empty one got its 401
// at once. So an answer given before the photos are read (no key, signed out, too big, the
// wrong method, or an error) first reads the rest of the body and drops it (see drain).
//
// The prompt, schema, request checks and the tidy-up of Claude's answer are in plan.ts.
//
// Secrets: ANTHROPIC_API_KEY (503 'no_key' if absent).
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'
import {
  BODY_TOO_BIG,
  buildPlan,
  fewEnoughValues,
  finalText,
  LIMITS,
  normalizeProposal,
  type Plan,
  type PhotosErrorCode,
  type PhotosRequest,
  type PhotosResponse,
  type Prior,
  type SiteDrawing,
  sanitizePrior,
  TOO_MANY_VALUES,
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
// call timings are what to size either one by. With many photos the prompt has Claude
// work from the clearest few of each stretch of tunnel rather than through every photo, so
// that the thinking needn't grow with the count; the log's output_tokens and text_ms show
// whether it does.
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
// retried is what the API said when it turned the fallback down, so the call went again
// without it; null when it didn't.
type Progress = { first_ms: number | null; text_ms: number | null; text_chars: number; input_tokens: number | null; output_tokens: number | null; retried: string | null }

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
  // silently turn the feature off. Only a 400 about the fallback itself is retried: any
  // other (a photo Claude can't take) would only come back again, and sending every photo
  // a second time is the most this function ever holds in memory (see readRequest).
  let msg: Final
  try {
    const first = anthropic.beta.messages.stream({ ...request, betas: [FALLBACK_BETA], fallbacks: 'default' } as never, { signal })
    msg = (await watch(first as unknown as Streamed, progress, started).finalMessage()) as Final
  } catch (e) {
    if (!(e instanceof Anthropic.BadRequestError) || !/fallback/i.test(apiDetail(e))) throw e
    progress.retried = apiDetail(e).slice(0, 200)
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

// Past this much, a body isn't the page's (Claude itself takes at most 128 MB in one
// request), and it can wait for the platform to give up on it rather than be read.
const DRAIN_MAX_BYTES = 128 * 1024 * 1024

// Reads the rest of a body and drops it, a chunk at a time, until DRAIN_MAX_BYTES have
// been read in all (seen is what was read before). It never throws: a page that hung up,
// or a body that breaks partway, just ends it.
async function dropRest(reader: ReadableStreamDefaultReader<Uint8Array>, seen = 0): Promise<void> {
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      seen += value?.byteLength ?? 0
      if (seen > DRAIN_MAX_BYTES) return
    }
  } catch {
    // Nothing left to read.
  }
}

// So an answer given before the photos were read isn't held back (see the top of this
// file), what's left of the body is read and dropped first. A body already read, or none,
// is left alone, and the answer goes out as it is.
async function drain(req: Request): Promise<void> {
  if (!req.body || req.bodyUsed) return
  try {
    await dropRest(req.body.getReader())
  } catch {
    // Someone else is reading it.
  }
}

// The body as text and its size in bytes, or null when it runs past the cap. It's read a
// chunk at a time rather than with req.text(), so a body sent without a Content-Length
// can't grow past the cap in memory: past it, the rest is read and dropped. Otherwise it
// does what req.text() does, keeping the bytes and decoding them once at the end. Decoding
// each chunk as it came left the pieces and their joined copy on the heap as garbage, and
// measured 20 to 50 MiB worse at the cap (see below).
async function readBody(req: Request): Promise<{ text: string; bytes: number } | null> {
  if (!req.body) return { text: '', bytes: 0 }
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > LIMITS.bodyBytes) {
      chunks.length = 0
      await dropRest(reader, bytes)
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(bytes)
  let at = 0
  for (const c of chunks) {
    all.set(c, at)
    at += c.byteLength
  }
  chunks.length = 0
  return { text: new TextDecoder().decode(all), bytes }
}

// Memory. A function gets 256 MB, counted as V8's heap plus its external memory (the bytes
// of requests and answers), garbage included until it's collected. The most at once is
// while the SDK sends the request to Claude: the photos as parsed, the SDK's JSON of the
// request and its bytes on the way out (32 MB each at the cap), and whatever of the body's
// own bytes and text hasn't been collected yet. Measured that way under Node with 600
// photos, over what the runtime itself uses: 162 MiB at the 32 MiB cap, 97 to 145 at the
// page's 30,000,000 characters. A retry without the fallback (see analyze) sends it all a
// second time, 226 MiB at the cap, too close to the limit: if the log line's retried is
// ever set, this account doesn't take the fallback and it should come out of analyze.
// JSON.parse copies the photos out of the body's text, so nothing keeps the text once this
// returns, and nothing after that copies a photo: the checked request, the plan and the
// call to Claude share the parsed strings.
async function readRequest(req: Request): Promise<{ ok: true; ask: PhotosRequest; bytes: number } | { ok: false; message: string }> {
  // A body that says it's too big isn't read for the photos: drain drops it.
  const declared = Number(req.headers.get('Content-Length')) || 0
  if (declared > LIMITS.bodyBytes) return { ok: false, message: BODY_TOO_BIG }
  let raw: { text: string; bytes: number } | null
  try {
    raw = await readBody(req)
  } catch {
    return { ok: false, message: "The photos didn't arrive. Try again." }
  }
  if (!raw) return { ok: false, message: BODY_TOO_BIG }
  if (!fewEnoughValues(raw.text)) return { ok: false, message: TOO_MANY_VALUES }
  let body: unknown
  try {
    body = JSON.parse(raw.text)
  } catch {
    return { ok: false, message: 'Send the photos as JSON.' }
  }
  const checked = validateRequest(body, raw.bytes)
  return checked.ok ? { ok: true, ask: checked.value, bytes: raw.bytes } : checked
}

async function handle(req: Request): Promise<Response> {
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

  const read = await readRequest(req)
  if (!read.ok) return fail('bad_request', read.message, 400, origin)
  const { ask, bytes } = read

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
        const progress: Progress = { first_ms: null, text_ms: null, text_chars: 0, input_tokens: null, output_tokens: null, retried: null }
        // Out of time is too much in the photos for one answer, the same as an answer that
        // ran past max_tokens, and the page says so for too_long.
        const out = await analyze(anthropic, plan, abort.signal, progress, started).catch(
          (e): PhotosResponse => (timedOut ? { error: 'too_long', message: TOO_SLOW } : { error: 'ai_failed', message: aiMessage(e) }),
        )
        console.log(JSON.stringify({
          fn: 'tunnel-from-photos',
          mode: plan.mode,
          photos: plan.ctx.photos,
          bytes,
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
}

// Every answer, early or not, waits for drain. Once the photos have been read it does
// nothing, and it runs after an error too, before the platform's own 500 goes out.
Deno.serve(async (req) => {
  try {
    return await handle(req)
  } finally {
    await drain(req)
  }
})
