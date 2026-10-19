// classify-work-order — Supabase Edge Function (Deno).
// After a staff member submits a work-order ticket, asks Claude to pick the work
// type (reactive / preventive / inspection / project / other) and write a short
// title from the description, plus the first photo when there is one. Invoked by
// the submitter right after their uploads finish.
//
// Submission never depends on this. If the key is missing or the call fails, the
// ticket keeps its "reactive" placeholder and description-derived title, and the
// reviewer sets the type during triage. It only writes over submit-time defaults
// (work_type_source = 'default', not yet reviewed), so it never overwrites a
// reviewer's choice.
//
// Secrets: ANTHROPIC_API_KEY (503 'no_key' if absent). Optional ANTHROPIC_MODEL.
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-5-5'
const WORK_TYPES = ['reactive', 'preventive', 'inspection', 'project', 'other'] as const
type WorkType = (typeof WORK_TYPES)[number]

// Formats and size Claude accepts as an inline image. HEIC (iPhone default) and
// videos are skipped; the description alone is enough to classify.
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

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

// Stable across every call so the prefix stays cacheable.
const SYSTEM_PROMPT = `You triage work-order tickets for a car wash company. Staff at a site describe a problem or request. Classify it and give it a title.

Work types:
- reactive: something is broken, leaking, jammed, damaged, unsafe, or not working and needs repair.
- preventive: scheduled upkeep meant to prevent future failures, such as lubrication, filter or belt replacement, or routine servicing.
- inspection: checking, testing, or assessing the condition of something without a known failure.
- project: a planned improvement, installation, upgrade, or new build-out.
- other: anything that fits none of the above.

Title: 3 to 8 words, plain and specific, naming the equipment or area and the issue (for example "Tunnel conveyor roller jammed"). No ticket numbers, no trailing period, and no em dashes.`

const OUTPUT_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      work_type: { type: 'string', enum: [...WORK_TYPES] },
      title: { type: 'string' },
    },
    required: ['work_type', 'title'],
    additionalProperties: false,
  },
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(s)
}

function cleanTitle(raw: string): string {
  const t = raw.replace(/[—–]/g, '-').replace(/\s+/g, ' ').replace(/\.$/, '').trim()
  return t.length > 80 ? t.slice(0, 80).trimEnd() : t
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'no_key', message: 'ANTHROPIC_API_KEY is not configured.' }, 503, origin)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData } = await userClient.auth.getUser()
  const uid = userData.user?.id
  if (!uid) return json({ error: 'unauthorized' }, 401, origin)

  let workOrderId = ''
  try {
    const body = await req.json()
    workOrderId = typeof body?.work_order_id === 'string' ? body.work_order_id : ''
  } catch { /* fall through to the 400 below */ }
  if (!workOrderId) return json({ error: 'bad_request', message: 'work_order_id is required.' }, 400, origin)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: wo } = await svc
    .from('work_orders')
    .select('id, requested_by, description, department, work_type_source, reviewed_at, location:locations(name), files:work_order_files(kind, mime_type, size_bytes, storage_path, created_at)')
    .eq('id', workOrderId)
    .maybeSingle()
  if (!wo) return json({ error: 'not_found' }, 404, origin)
  // Only the person who filed the ticket triggers classification.
  if (wo.requested_by !== uid) return json({ error: 'forbidden' }, 403, origin)
  if (wo.work_type_source !== 'default' || wo.reviewed_at) {
    return json({ skipped: 'already_set' }, 200, origin)
  }

  const content: Anthropic.ContentBlockParam[] = []
  // deno-lint-ignore no-explicit-any
  const photo = ((wo.files ?? []) as any[])
    .filter((f) => f.kind === 'photo' && IMAGE_TYPES.has(f.mime_type) && (f.size_bytes ?? 0) <= MAX_IMAGE_BYTES)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0]
  if (photo) {
    const { data: blob } = await svc.storage.from('work-order-files').download(photo.storage_path)
    if (blob) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: photo.mime_type, data: toBase64(await blob.arrayBuffer()) },
      })
    }
  }
  // deno-lint-ignore no-explicit-any
  const site = (wo.location as any)?.name ?? 'unknown'
  content.push({
    type: 'text',
    text: `Department: ${wo.department ?? 'maintenance'}\nSite: ${site}\nDescription:\n${wo.description ?? '(no description)'}`,
  })

  const anthropic = new Anthropic({ apiKey })
  const request = {
    model: MODEL,
    // Thinking is always on for this model, so leave room beyond the short answer.
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    output_config: { effort: 'low', format: OUTPUT_FORMAT },
    messages: [{ role: 'user', content }],
  }

  // Server-side fallback re-runs a declined request on another model. If this
  // account or SDK version rejects the parameter, retry once without it so a
  // config mismatch can't silently disable classification.
  // deno-lint-ignore no-explicit-any
  let res: any
  try {
    res = await anthropic.beta.messages.create({
      ...request,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    } as never)
  } catch (e) {
    if (!(e instanceof Anthropic.BadRequestError)) {
      return json({ error: 'ai_failed', message: e instanceof Error ? e.message : String(e) }, 502, origin)
    }
    try {
      res = await anthropic.messages.create(request as never)
    } catch (e2) {
      return json({ error: 'ai_failed', message: e2 instanceof Error ? e2.message : String(e2) }, 502, origin)
    }
  }

  if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') {
    return json({ skipped: res.stop_reason }, 200, origin)
  }
  // deno-lint-ignore no-explicit-any
  const text = (res.content as any[]).find((b) => b.type === 'text')?.text ?? ''
  let parsed: { work_type?: string; title?: string } = {}
  try { parsed = JSON.parse(text) } catch { return json({ skipped: 'unparseable' }, 200, origin) }
  const workType = WORK_TYPES.includes(parsed.work_type as WorkType) ? (parsed.work_type as WorkType) : null
  const title = typeof parsed.title === 'string' ? cleanTitle(parsed.title) : ''
  if (!workType) return json({ skipped: 'invalid_type' }, 200, origin)

  // Re-check the guards in the write itself: a reviewer may have acted while
  // the model was running.
  const { error } = await svc
    .from('work_orders')
    .update({ work_type: workType, work_type_source: 'ai', ...(title ? { title } : {}) })
    .eq('id', workOrderId)
    .eq('work_type_source', 'default')
    .is('reviewed_at', null)
  if (error) return json({ error: 'update_failed', message: error.message }, 500, origin)

  return json({ work_type: workType, title }, 200, origin)
})
