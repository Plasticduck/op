// extract-drb-gsr — Supabase Edge Function (Deno).
// Takes an uploaded DRB Systems General Sales Report (PDF), asks Claude to
// extract key financial fields using PDF document support, and returns a
// structured JSON object the closeout form can auto-fill.
//
// Secrets required (set via `supabase secrets set`):
//   ANTHROPIC_API_KEY   — Claude API key (function returns 503 'no_key' if absent)
// Auto-provided by the platform: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6'
const MAX_DATA_URI_BYTES = 10 * 1024 * 1024

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

const SYSTEM_PROMPT = `You read DRB Systems General Sales Report (GSR) PDFs from car wash sites and return structured financial data. Be conservative: if a value is not clearly present in the document, use null rather than guessing. Use the exact JSON shape requested. Never include prose or markdown fences. Numbers should be plain numbers (no dollar signs, no commas).`

const USER_PROMPT = `Extract the sales totals from this DRB General Sales Report. Return ONLY a JSON object, no prose, with exactly these keys (use null when a value is missing): report_date (YYYY-MM-DD string), site, total_sales, cash, credit, deposit, car_count, wash_packages (array of { name, count, revenue }), memberships ({ new, active, revenue }), notes (one short string).`

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return json({ error: 'no_key', message: 'ANTHROPIC_API_KEY is not configured.' }, 503, origin)
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData } = await userClient.auth.getUser()
  const uid = userData.user?.id
  if (!uid) return json({ error: 'unauthorized' }, 401, origin)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: profile } = await svc
    .from('users')
    .select('role')
    .eq('id', uid)
    .single()
  if (!profile || (profile.role !== 'owner' && profile.role !== 'manager')) {
    return json({ error: 'forbidden' }, 403, origin)
  }

  let body: { file_name?: string; file_type?: string; data_uri?: string } = {}
  try { body = await req.json() } catch { return json({ error: 'bad_request' }, 400, origin) }

  const fileType = body.file_type ?? ''
  const dataUri = body.data_uri ?? ''
  if (!fileType.toLowerCase().includes('pdf')) {
    return json({ error: 'bad_request', message: 'file_type must be a PDF.' }, 400, origin)
  }
  if (!dataUri.startsWith('data:application/pdf')) {
    return json({ error: 'bad_request', message: 'data_uri must begin with data:application/pdf.' }, 400, origin)
  }
  if (dataUri.length > MAX_DATA_URI_BYTES) {
    return json({ error: 'bad_request', message: 'PDF exceeds 10 MB limit.' }, 400, origin)
  }

  const commaIdx = dataUri.indexOf(',')
  if (commaIdx < 0) return json({ error: 'bad_request', message: 'data_uri missing payload.' }, 400, origin)
  const rawBase64 = dataUri.slice(commaIdx + 1)

  const anthropic = new Anthropic({ apiKey })

  let rawText = ''
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          // deno-lint-ignore no-explicit-any
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: rawBase64 },
            },
            { type: 'text', text: USER_PROMPT },
            // deno-lint-ignore no-explicit-any
          ] as any,
        },
      ],
    })
    const block = message.content.find((b) => b.type === 'text')
    rawText = block && 'text' in block ? block.text : ''
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return json({ error: 'upstream', message: msg }, 500, origin)
  }

  const cleaned = rawText.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  let extracted: unknown
  try {
    extracted = JSON.parse(cleaned)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return json({ error: 'parse_failed', message: msg, raw_text_excerpt: rawText.slice(0, 200) }, 500, origin)
  }

  return json(
    { ok: true, extracted, raw_text_excerpt: rawText.slice(0, 200) },
    200,
    origin,
  )
})
