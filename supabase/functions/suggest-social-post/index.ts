// suggest-social-post — Supabase Edge Function (Deno).
//
// Given a holiday id (from src/lib/social/holidays.ts), a date, and a target
// platform (Instagram | Facebook | X | TikTok), generate 3 short, on-brand
// social post drafts the operator can edit and schedule. Uses Claude.
//
// Required secrets: ANTHROPIC_API_KEY (returns 503 no_key if absent).

import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6'

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
const json = (b: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })

// Inline holiday lookup — duplicated from the frontend's static list so the
// edge fn can resolve a name + promo angle from just the id. Keep in sync with
// /src/lib/social/holidays.ts.
const PROMO_ANGLES: Record<string, { name: string; promoAngle: string; emoji: string }> = {
  'new-years': { name: "New Year's Day", promoAngle: 'Resolution: cleaner car every month.', emoji: '🎉' },
  'mlk-day': { name: 'Martin Luther King Jr. Day', promoAngle: 'A day of reflection and service.', emoji: '🕊️' },
  'clean-out-car': { name: 'Clean Out Your Car Day', promoAngle: 'Free vacuum upgrade with any wash today.', emoji: '🧹' },
  'valentines': { name: "Valentine's Day", promoAngle: 'Two-for-one couple wash package.', emoji: '💝' },
  'presidents-day': { name: "Presidents' Day", promoAngle: 'Long-weekend road-trip prep.', emoji: '🇺🇸' },
  'natl-pig-day': { name: 'National Pig Day', promoAngle: 'Stop driving a pig. Bring it in for a bath.', emoji: '🐷' },
  'st-patricks': { name: "St. Patrick's Day", promoAngle: 'Get the green out. Lucky upgrade.', emoji: '🍀' },
  'first-spring': { name: 'First Day of Spring', promoAngle: 'Spring cleaning starts in the driveway.', emoji: '🌷' },
  'natl-car-wash-day': { name: 'National Car Wash Day', promoAngle: 'THE day. All-day promo, big visibility.', emoji: '🧽' },
  'natl-pet-day': { name: 'National Pet Day', promoAngle: 'Free vacuum extension for pet hair owners.', emoji: '🐾' },
  'easter': { name: 'Easter Sunday', promoAngle: 'Sparkle for spring brunch.', emoji: '🐰' },
  'earth-day': { name: 'Earth Day', promoAngle: 'Reclaim system + biodegradable soap saves 100+ gallons vs driveway.', emoji: '🌍' },
  'natl-car-care-month': { name: 'National Car Care Month', promoAngle: 'Monthly membership push.', emoji: '🚗' },
  'mothers-day': { name: "Mother's Day", promoAngle: "Mom's car deserves a treat.", emoji: '💐' },
  'memorial-day': { name: 'Memorial Day', promoAngle: 'Honor with action. Discount for veteran families.', emoji: '🇺🇸' },
  'fathers-day': { name: "Father's Day", promoAngle: "Dad's ride, polished.", emoji: '👨' },
  'first-summer': { name: 'First Day of Summer', promoAngle: 'Pre-bug-armor package.', emoji: '☀️' },
  'natl-selfie-day': { name: 'National Selfie Day', promoAngle: 'Selfie with your sparkling car, tag for a free upgrade.', emoji: '🤳' },
  'independence-day': { name: 'Independence Day', promoAngle: 'Red, white, and clean.', emoji: '🎆' },
  'natl-dog-day': { name: 'National Dog Day', promoAngle: 'Bring your dog. Free vacuum + biscuit. Photo contest.', emoji: '🐕' },
  'labor-day': { name: 'Labor Day', promoAngle: 'End-of-summer push.', emoji: '🛠️' },
  'natl-coffee-day': { name: 'National Coffee Day', promoAngle: 'Coffee shop tie-in.', emoji: '☕' },
  'first-fall': { name: 'First Day of Fall', promoAngle: 'Featured leaf-vacuum-extension.', emoji: '🍂' },
  'halloween': { name: 'Halloween', promoAngle: 'Costume contest at the wash.', emoji: '🎃' },
  'veterans-day': { name: 'Veterans Day', promoAngle: 'Free wash for veterans and active military.', emoji: '🎗️' },
  'thanksgiving': { name: 'Thanksgiving', promoAngle: 'Closed for family. Gratitude post.', emoji: '🦃' },
  'black-friday': { name: 'Black Friday', promoAngle: 'Membership steal. Annual prepay discount.', emoji: '🛍️' },
  'small-bus-saturday': { name: 'Small Business Saturday', promoAngle: 'Cross-promote with neighborhood businesses.', emoji: '🏪' },
  'first-winter': { name: 'First Day of Winter', promoAngle: 'Salt season. Underbody wash featured.', emoji: '❄️' },
  'christmas-eve': { name: 'Christmas Eve', promoAngle: 'Early-close. Holiday gratitude post.', emoji: '🎄' },
  'christmas': { name: 'Christmas Day', promoAngle: 'Closed. Thank-you-for-the-year post.', emoji: '🎁' },
  'new-years-eve': { name: "New Year's Eve", promoAngle: 'Annual pre-pay last call.', emoji: '🍾' },
}

const SYSTEM_PROMPT = `You write short, on-brand social media posts for an independent car wash operator.

You are given a PROMO ANGLE. Treat it as a brief internal shorthand for a promotional DIRECTION, not as copy to reuse. It may be terse or cryptic (for example "Monthly membership push" or "Salt season, underbody wash featured"). Your first job is to INTERPRET it into one clear, real promotion or message that a customer would instantly understand. Then write posts about that interpreted promotion.

Hard rules:
- Do NOT quote or echo the promo angle's wording. Write completely fresh, natural copy. A customer who never saw the angle should understand the post perfectly.
- Do NOT just rearrange the angle's words. Expand the idea into a real, sensible offer or message (name the actual deal, the reason to come in, the freebie, the membership benefit, etc.). If the angle is vague, commit to one concrete, reasonable promotion.
- Stay on THIS promotion. Do not drift to a generic "come get your car clean" post or invent an unrelated holiday.

Write exactly 3 posts, all promoting the SAME interpreted promotion, each with a different creative approach. Vary the hook and format across the three (a question hook, a bold one-line offer, a short scenario, urgency/countdown, a warm community note). Three versions of ONE campaign.

Make each post specific and concrete:
- Open with a real hook or the offer, not a generic greeting.
- State the actual promotion clearly and the reason to act.
- Close with a specific call to action.

Voice: friendly, confident, natural, no cheesy puns, no clickbait, no em dashes.
Each post is 1 to 3 short lines plus a CTA line. Keep it under 60 words.
Use one or two emojis only when they fit naturally. Include 2 to 4 relevant hashtags at the end on their own line.
Tailor tone to the platform:
- Instagram: aspirational, visual hook
- Facebook: warm and community-focused
- X: punchy and tight
- TikTok: hooky first line, conversational, casual

Return ONLY a JSON object with this shape, no markdown fences:
{"suggestions":[{"platform":"<p>","title":"<2 to 4 word label of this post's approach>","body":"<post text including the hashtags>"}]}
Exactly 3 suggestions for the requested platform.`

const ANGLE_SYSTEM_PROMPT = `You create ONE fresh promo angle for an independent car wash for a given occasion or date.
A promo angle is a short, specific promotional DIRECTION the wash could run: an offer, a hook, a theme, or a tie-in. It is an internal idea, not customer-facing copy.
Make it concrete and genuinely usable (name a real offer or hook), tied to the occasion, and different from any "avoid" angle provided. Keep it to one sentence, under 16 words. No hashtags, no emojis.
Return ONLY JSON, no markdown fences: {"angle":"<the promo angle>"}`

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'no_key', message: 'ANTHROPIC_API_KEY is not configured.' }, 503, origin)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  const uid = u.user?.id
  if (!uid) return json({ error: 'unauthorized' }, 401, origin)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: profile } = await svc.from('users').select('account_id, role').eq('id', uid).single()
  if (!profile || (profile.role !== 'owner' && profile.role !== 'manager')) {
    return json({ error: 'forbidden' }, 403, origin)
  }

  let body: { holiday_id?: string; date?: string; platform?: string; promo_angle?: string; mode?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  const platform = body.platform || 'Instagram'
  const date = body.date || new Date().toISOString().slice(0, 10)
  const holiday = body.holiday_id ? PROMO_ANGLES[body.holiday_id] : null
  // Prefer the exact promo angle the user is looking at; fall back to the lookup.
  const promoAngle = body.promo_angle?.trim() || holiday?.promoAngle || ''

  // Pull a tiny bit of account context to ground the suggestions.
  const { data: account } = await svc.from('accounts').select('name').eq('id', profile.account_id).single()
  const { count: locCount } = await svc
    .from('locations').select('id', { count: 'exact', head: true })
    .eq('account_id', profile.account_id).eq('archived', false)

  const anthropic = new Anthropic({ apiKey })

  // Mode: generate a fresh promo angle (not posts).
  if (body.mode === 'angle') {
    const anglePrompt =
      'Wash brand: ' + (account?.name ?? 'a local car wash') + '\n' +
      'Date: ' + date + '\n' +
      (holiday ? 'Occasion: ' + holiday.name + ' ' + holiday.emoji + '\n' : 'No specific holiday.\n') +
      (promoAngle ? 'Avoid repeating this angle: ' + promoAngle + '\n' : '') +
      '\nCreate one fresh, specific promo angle.'
    try {
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 120,
        system: [{ type: 'text', text: ANGLE_SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: anglePrompt }],
      })
      const block = msg.content.find((b) => b.type === 'text')
      const rawA = block && 'text' in block ? block.text : '{}'
      const cleanedA = rawA.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
      // deno-lint-ignore no-explicit-any
      let parsedA: any = {}
      try { parsedA = JSON.parse(cleanedA) } catch { /* empty */ }
      const angle = typeof parsedA?.angle === 'string' ? parsedA.angle.trim() : ''
      return json({ ok: true, angle }, 200, origin)
    } catch (e) {
      return json({ error: 'internal', message: (e as Error).message }, 500, origin)
    }
  }

  const userPrompt =
    'Wash brand: ' + (account?.name ?? 'a local car wash') + '\n' +
    'Number of sites: ' + (locCount ?? 1) + '\n' +
    'Date: ' + date + '\n' +
    'Platform: ' + platform + '\n' +
    (holiday ? 'Occasion: ' + holiday.name + ' ' + holiday.emoji + '\n' : '') +
    (promoAngle
      ? 'PROMO ANGLE (shorthand direction to interpret, do not quote): ' + promoAngle + '\n' +
        '\nInterpret this into one concrete promotion, then write all 3 posts about it in fresh customer-facing language. Vary the hook and format between the three.'
      : 'No specific promo angle. Write 3 on-brand posts for this date, each with a clear hook and CTA.')

  let raw = ''
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 900,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPrompt }],
    })
    const block = msg.content.find((b) => b.type === 'text')
    raw = block && 'text' in block ? block.text : '{}'
  } catch (e) {
    return json({ error: 'internal', message: (e as Error).message }, 500, origin)
  }

  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  // deno-lint-ignore no-explicit-any
  let parsed: any = {}
  try { parsed = JSON.parse(cleaned) } catch { /* return empty */ }
  const suggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions : []

  return json({ ok: true, suggestions, model: MODEL }, 200, origin)
})
