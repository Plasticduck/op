// it-read-label — Supabase Edge Function (Deno).
// Reads a photo of a device's label (the sticker or plate with the model and
// serial) and returns what it says, so the Add equipment form can fill in the
// manufacturer, model, model number, serial and MAC for the person to check.
// Nothing is saved here: the form shows what was read and the person saves.
//
// Auth: IT staff (Admin, manager, technician) with their session. The service
// role may call it with account_id (used by tests).
// Secrets: ANTHROPIC_API_KEY (503 'no_key' if absent). Optional ANTHROPIC_MODEL.
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-5-5'
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
// Claude takes up to 5 MB per inline image; the app sends ~1 MB JPEGs.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const FIELDS = ['manufacturer', 'model', 'model_number', 'serial', 'mac', 'category'] as const

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

function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}

// Stable across every call so the prefix stays cacheable. The account's own
// manufacturers and categories go in the user turn.
const SYSTEM_PROMPT = `You read equipment labels for a car wash company's IT inventory. The photo shows a device's label: a sticker, rating plate or etched plate with things like the brand, model, part number, serial number and MAC address. Pay stations, card readers, receipt printers, network switches, routers, cameras, tablets, PCs and controllers are typical.

Report only what is printed on the label. Never guess a serial or MAC from a pattern or from what you know about the product. If a field isn't on the label or you can't read it, leave it empty.

- manufacturer: the company that made it, as branded on the label. If it's the same company as one of the account's manufacturers listed with the photo, use that exact spelling.
- model: the product's model as people know it and would order it (often after Model, MOD or M/N). When the label shows both a product name and a regulatory or type code (for example TM-T88VI and M332A), the product name goes here.
- model_number: the label's other model, part or catalog number, if it has one (often after P/N, PN, REF, Cat. No., Type or a regulatory model). Empty if there's no second number or it's the same as the model.
- serial: the serial number, usually after S/N, SN, SER or Serial No. Copy it exactly, keeping its letters, digits and dashes. Not the part number, date code, FCC ID or IMEI.
- mac: a MAC or Ethernet address (12 hex digits, often after MAC, ETH, LAN or Wi-Fi), written as aa:bb:cc:dd:ee:ff. If there are several, the wired one.
- category: the one category from the account's list that fits this kind of device, spelled exactly as listed. Empty if none fits or you can't tell.
- unsure: the fields you filled whose characters you couldn't read with confidence (blur, glare, a worn label, 0 or O, 1 or I, 8 or B).
- note: if the photo isn't a readable label (too blurry, too far away, glare, no label in it), what to fix, in one short sentence. Otherwise empty.`

const OUTPUT_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      manufacturer: { type: 'string' },
      model: { type: 'string' },
      model_number: { type: 'string' },
      serial: { type: 'string' },
      mac: { type: 'string' },
      category: { type: 'string' },
      unsure: { type: 'array', items: { type: 'string', enum: [...FIELDS] } },
      note: { type: 'string' },
    },
    required: [...FIELDS, 'unsure', 'note'],
    additionalProperties: false,
  },
}

const clean = (v: unknown, max = 100) =>
  typeof v === 'string' ? v.replace(/[—–]/g, '-').replace(/\s+/g, ' ').trim().slice(0, max) : ''

// 12 hex digits in any common layout, or nothing.
function cleanMac(v: unknown): string {
  const hex = clean(v).replace(/[^0-9a-f]/gi, '').toLowerCase()
  return hex.length === 12 ? hex.match(/../g)!.join(':') : ''
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  let body: { image?: string; media_type?: string; account_id?: string } = {}
  try { body = await req.json() } catch { /* checked below */ }

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  const isService = jwtRole(authHeader) === 'service_role' || (!!token && token === serviceKey)
  let accountId = isService ? body.account_id ?? '' : ''
  if (!isService) {
    const { data: u } = await svc.auth.getUser(token)
    if (!u?.user) return json({ error: 'unauthorized' }, 401, origin)
    const { data: p } = await svc.from('users').select('account_id, role').eq('id', u.user.id).maybeSingle()
    if (!p || !['owner', 'manager', 'technician'].includes(p.role)) {
      return json({ error: 'forbidden', message: 'Only people who add equipment can read labels.' }, 403, origin)
    }
    accountId = p.account_id
  }
  if (!accountId) return json({ error: 'bad_request', message: 'account_id is required.' }, 400, origin)

  const mediaType = body.media_type ?? ''
  const image = typeof body.image === 'string' ? body.image.replace(/^data:[^;]+;base64,/, '') : ''
  if (!image || !IMAGE_TYPES.has(mediaType)) {
    return json({ error: 'bad_request', message: 'Send a JPEG, PNG or WebP photo.' }, 400, origin)
  }
  if (image.length * 0.75 > MAX_IMAGE_BYTES) {
    return json({ error: 'too_big', message: 'That photo is too big. Try again.' }, 413, origin)
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'no_key', message: "Label reading isn't set up yet." }, 503, origin)

  const [{ data: makers }, { data: cats }] = await Promise.all([
    svc.from('it_manufacturers').select('name').eq('account_id', accountId).is('deleted_at', null).order('name'),
    svc.from('it_categories').select('id, name').eq('account_id', accountId).eq('kind', 'asset').is('deleted_at', null).order('sort_order'),
  ])
  const manufacturers = (makers ?? []).map((m) => m.name as string)
  const categories = (cats ?? []) as { id: string; name: string }[]

  const anthropic = new Anthropic({ apiKey })
  const request = {
    model: MODEL,
    // Thinking is always on for this model, so leave room beyond the short answer.
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    output_config: { effort: 'low', format: OUTPUT_FORMAT },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
        {
          type: 'text',
          text: `The account's manufacturers: ${manufacturers.length ? manufacturers.join('; ') : '(none yet)'}\n` +
            `The account's categories: ${categories.map((c) => c.name).join('; ') || '(none)'}\n\nRead this label.`,
        },
      ],
    }],
  }

  // Server-side fallback re-runs a declined request on another model. If this
  // account or SDK version rejects the parameter, retry once without it so a
  // config mismatch can't silently turn label reading off.
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
      return json({ error: 'ai_failed', message: "Couldn't read the label right now. Try again.", detail: e instanceof Error ? e.message : String(e) }, 502, origin)
    }
    try {
      res = await anthropic.messages.create(request as never)
    } catch (e2) {
      return json({ error: 'ai_failed', message: "Couldn't read the label right now. Try again.", detail: e2 instanceof Error ? e2.message : String(e2) }, 502, origin)
    }
  }

  if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') {
    return json({ error: 'unreadable', message: "Couldn't read that label. Try another photo." }, 422, origin)
  }
  // deno-lint-ignore no-explicit-any
  const text = (res.content as any[]).find((b) => b.type === 'text')?.text ?? ''
  // deno-lint-ignore no-explicit-any
  let parsed: Record<string, any> = {}
  try { parsed = JSON.parse(text) } catch {
    return json({ error: 'unreadable', message: "Couldn't read that label. Try another photo." }, 422, origin)
  }

  // Use the account's spelling of a manufacturer or category when it's the same one.
  const manufacturerText = clean(parsed.manufacturer, 80)
  const manufacturer = manufacturers.find((m) => m.toLowerCase() === manufacturerText.toLowerCase()) ?? manufacturerText
  const categoryText = clean(parsed.category, 80).toLowerCase()
  const category = categoryText ? categories.find((c) => c.name.toLowerCase() === categoryText) ?? null : null
  const model = clean(parsed.model)
  let modelNumber = clean(parsed.model_number)
  if (modelNumber.toLowerCase() === model.toLowerCase()) modelNumber = ''
  const out = {
    manufacturer,
    model,
    model_number: modelNumber,
    serial: clean(parsed.serial, 80),
    mac: cleanMac(parsed.mac),
    category_id: category?.id ?? null,
    category_name: category?.name ?? null,
    unsure: Array.isArray(parsed.unsure) ? parsed.unsure.filter((f: unknown) => (FIELDS as readonly unknown[]).includes(f)) : [],
    note: clean(parsed.note, 200),
  }
  const found = out.manufacturer || out.model || out.model_number || out.serial || out.mac
  if (!found) {
    return json({ error: 'nothing_found', message: out.note || "Couldn't find a model or serial in that photo. Get closer so the label fills the photo." }, 422, origin)
  }
  return json(out, 200, origin)
})
