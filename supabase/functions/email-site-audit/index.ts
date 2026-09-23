// email-site-audit — Supabase Edge Function (Deno).
// Emails a Site Audit PDF (photos embedded) to a fixed leadership list, the
// site's own address (MW01 -> mw01@mighty-wash.com), and the site's regional
// manager. The PDF is built SERVER-SIDE from the audit id (service-role access
// to the audit + its photos), so delivery never depends on the device.
//
// Body: { audit_id: string, test?: boolean }. When test is true, the email goes
// ONLY to kjowers@mighty-wash.com (used to verify before going live).
//
// Auth: owner/manager of the audit's account, or the service role.
// Required secret: RESEND_API_KEY. Optional: RESEND_FROM.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'
import { jsPDF } from 'npm:jspdf@4.2.1'
import autoTable from 'npm:jspdf-autotable@5.0.8'
import { format } from 'npm:date-fns@4'
import { encodeBase64, decodeBase64 } from 'jsr:@std/encoding@1/base64'

const BUCKET = 'site-audit-photos'
// deno-lint-ignore no-explicit-any
type Any = any

// Fixed leadership recipients on every audit.
const FIXED_TO = [
  'kjowers@mighty-wash.com', 'jay@mighty-wash.com', 'staci@mymightywash.com',
  'kstaton@mighty-wash.com', 'debra@mighty-wash.com', 'justin.gamboa@mighty-wash.com',
  'zachary@mighty-wash.com', 'ernest@mighty-wash.com', 'lkeith@mighty-wash.com',
]
// Regional manager per site (keyed by the normalized site name).
const RM_BY_SITE: Record<string, string> = {}
const addRm = (email: string, sites: string[]) => { for (const s of sites) RM_BY_SITE[s] = email }
addRm('mcanales@mighty-wash.com', ['MW01', 'MW05', 'MW07', 'MW09', 'MW10', 'MW11', 'MW14', 'MW34', 'MW33', 'MW32'])
addRm('isabel@mighty-wash.com', ['MW02', 'MW04', 'MW06', 'MW08', 'MW13', 'MW15', 'MW22', 'MW24', 'MW25'])
addRm('lester@mighty-wash.com', ['MW03', 'MW12', 'MW31'])
addRm('rbreed@mighty-wash.com', ['MW16', 'MW17', 'MW18', 'MW19', 'MW20', 'MW21', 'MW23', 'MW26'])
addRm('djones@mighty-wash.com', ['MW27', 'MW28', 'MW29', 'MW30', 'SPOTLESS'])

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
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}

// The default Site Audit form (kept in sync with siteAuditSchema.ts); the
// account's customized schema overrides it when present.
const DEFAULT_SCHEMA: Any = {
  version: 1,
  sections: [
    { id: 'initial_observations', title: 'Initial Observations (Curb Appeal)', items: [
      { id: 'observations', label: 'Paint, Signage, Trash, Team Appearance/Hustle', type: 'comments' },
    ] },
    { id: 'primary', title: 'Primary (Washing your Car)', items: [
      { id: 'pay_stations', label: 'Pay Stations', type: 'pass_fail' },
      { id: 'prep', label: 'Prep', type: 'pass_fail' },
      { id: 'tunnel', label: 'Tunnel', type: 'pass_fail' },
      { id: 'equipment', label: 'Equipment', type: 'pass_fail' },
      { id: 'chemical', label: 'Chemical', type: 'pass_fail' },
      { id: 'blowers', label: 'Blowers', type: 'pass_fail' },
      { id: 'qc', label: 'QC', type: 'pass_fail' },
      { id: 'primary_comments', label: 'Section comments (optional)', type: 'comments' },
    ] },
    { id: 'secondary', title: 'Secondary (Behind the Scenes)', items: [
      { id: 'mechanical_room', label: 'Mechanical Room', type: 'pass_fail' },
      { id: 'office', label: 'Office', type: 'pass_fail' },
      { id: 'restrooms', label: 'Restrooms', type: 'pass_fail' },
      { id: 'vac_shed', label: 'Vac Shed', type: 'pass_fail' },
      { id: 'vac_area', label: 'Vac Area', type: 'pass_fail' },
      { id: 'vac_pressure', label: 'Vac Pressure', type: 'pass_fail' },
      { id: 'secondary_comments', label: 'Section comments (optional)', type: 'comments' },
    ] },
    { id: 'priority', title: 'Priority (Safety)', items: [
      { id: 'fire_extinguishers', label: 'Fire Extinguishers', type: 'pass_fail' },
      { id: 'safety_supplies', label: 'Safety Supplies', type: 'pass_fail' },
      { id: 'first_aid_kit', label: 'First Aid Kit', type: 'pass_fail' },
      { id: 'hazmat_suits', label: 'Hazmat Suits', type: 'pass_fail' },
      { id: 'safety_signage', label: 'Safety Signage', type: 'pass_fail' },
      { id: 'housekeeping', label: 'Housekeeping', type: 'pass_fail' },
      { id: 'storage_tool_room', label: 'Storage/Tool Room', type: 'pass_fail' },
      { id: 'site_hazards', label: 'Site Hazards', type: 'pass_fail' },
      { id: 'priority_comments', label: 'Section comments (optional)', type: 'comments' },
    ] },
    { id: 'final_thoughts', title: 'Final Thoughts (Customer Takeaways)', items: [
      { id: 'customer_service', label: 'Customer Service', type: 'pass_fail' },
      { id: 'fast', label: 'Fast', type: 'pass_fail' },
      { id: 'friendly', label: 'Friendly', type: 'pass_fail' },
      { id: 'clean', label: 'Clean', type: 'pass_fail' },
      { id: 'efficient', label: 'Efficient', type: 'pass_fail' },
      { id: 'anything_stand_out', label: 'Anything Stand Out: (Good or Bad)', type: 'pass_fail' },
      { id: 'final_thoughts_comments', label: 'Section comments (optional)', type: 'comments' },
    ] },
    { id: 'explanation', title: 'Explanation', items: [
      { id: 'explanation', label: 'Explanation', type: 'comments' },
    ] },
  ],
}

function reconstructAnswers(schema: Any, audit: Any): Record<string, Any> {
  const answers: Record<string, Any> = {}
  const merge = (obj: Any) => {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) for (const [k, v] of Object.entries(obj)) answers[k] = v
  }
  merge(audit.primary_section); merge(audit.secondary_section); merge(audit.priority_section); merge(audit.final_thoughts)
  if (audit.section_comments && typeof audit.section_comments === 'object') for (const v of Object.values(audit.section_comments)) merge(v)
  const setFirst = (sectionId: string, text: string | null) => {
    if (!text) return
    const sec = (schema.sections as Any[]).find((s) => s.id === sectionId)
    const item = sec?.items.find((it: Any) => it.type === 'comments')
    if (item) answers[item.id] = { value: text }
  }
  setFirst('initial_observations', audit.initial_observations)
  setFirst('explanation', audit.explanation)
  return answers
}

function pngSize(b: Uint8Array): { w: number; h: number } {
  return { w: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], h: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] }
}
function jpegSize(b: Uint8Array): { w: number; h: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i < b.length - 8) {
    if (b[i] !== 0xff) { i++; continue }
    const m = b[i + 1]
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] }
    }
    i += 2 + ((b[i + 2] << 8) | b[i + 3])
  }
  return null
}
function drawPhotoPlaceholder(doc: Any, x: number, y: number, w: number, h: number): void {
  doc.setDrawColor(210, 214, 220); doc.setFillColor(240, 242, 245); doc.rect(x, y, w, h, 'FD')
  doc.setFontSize(7); doc.setTextColor(140, 146, 154); doc.text('Photo', x + w / 2, y + h / 2, { align: 'center' })
}
const fmtDate = (d: string | null | undefined): string => {
  if (!d) return '-'
  const p = new Date(d)
  return Number.isNaN(p.getTime()) ? '-' : format(p, 'MMM d, yyyy')
}
const fmtDateTime = (d: Date): string => format(d, 'MMM d, yyyy h:mm a')

// Render the audit: header, per-section tables (Pass/Warn/Fail), photos inline
// under each item's row, footer. Mirrors src/lib/reports/siteAuditPdf.ts.
function renderAudit(doc: Any, input: Any): void {
  doc.setFont('helvetica', 'normal')
  const marginX = 14, topMargin = 16
  const pageHeight = doc.internal.pageSize.getHeight()
  const pageWidth = doc.internal.pageSize.getWidth()
  const contentWidth = pageWidth - marginX * 2

  doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(11, 15, 20)
  doc.text('Site Audit', marginX, topMargin)
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(110, 116, 124)
  doc.text(input.metaLine ?? '', marginX, topMargin + 7)

  if (input.logo?.dataUrl) {
    const logoH = 18
    const logoW = input.logo.w > 0 && input.logo.h > 0 ? logoH * (input.logo.w / input.logo.h) : logoH
    try { doc.addImage(input.logo.dataUrl, 'PNG', pageWidth - marginX - logoW, 6, logoW, logoH) } catch { /* skip */ }
  }

  let y = topMargin + 14
  const ensureSpace = (needed: number) => { if (y + needed > pageHeight - 20) { doc.addPage(); y = topMargin } }

  const imgH = 28, gap = 3, topPad = 2, botPad = 2
  const layoutPhotos = (imgs: Any[]) => {
    const positions: Any[] = []
    let x = 0, row = 0
    for (const img of imgs) {
      const ratio = img.w && img.h ? img.w / img.h : 1
      const w = Math.max(12, Math.min(imgH * ratio, contentWidth))
      if (x > 0 && x + w > contentWidth) { x = 0; row += 1 }
      positions.push({ x, row, w, img })
      x += w + gap
    }
    return { positions, blockH: topPad + (row + 1) * imgH + row * gap + botPad }
  }

  for (const section of input.schema.sections) {
    if (!section.items.some((it: Any) => it.type !== 'attachment')) continue
    const rows: Any[] = []
    const rowPhotos: Any[] = []
    for (const item of section.items) {
      if (item.type === 'attachment') continue
      const ans = input.answers[item.id]
      if (item.type === 'pass_fail') {
        const v = ans?.value
        const pf = v === 'pass' ? 'Pass' : v === 'warn' ? 'Warn' : v === 'fail' ? 'Fail' : '-'
        rows.push([item.label, pf, '-'])
      } else {
        const raw = ans?.value
        rows.push([item.label, '-', raw == null || raw === '' ? '-' : String(raw)])
      }
      const imgs = ((ans?.photos ?? []) as string[]).map((p) => input.photoImages?.[p]).filter(Boolean)
      rowPhotos.push(imgs.length ? layoutPhotos(imgs) : null)
    }

    ensureSpace(14)
    doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(11, 15, 20)
    doc.text(section.title, marginX, y); y += 3

    autoTable(doc, {
      startY: y + 2,
      head: [['Item', 'Status', 'Notes']],
      body: rows.length > 0 ? rows : [['-', '-', '-']],
      margin: { left: marginX, right: marginX },
      rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [11, 15, 20], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [247, 248, 250] },
      columnStyles: { 0: { cellWidth: contentWidth * 0.42 }, 1: { cellWidth: contentWidth * 0.18 }, 2: { cellWidth: contentWidth * 0.4 } },
      didParseCell: (data: Any) => {
        if (data.section !== 'body') return
        const layout = rowPhotos[data.row.index]
        if (!layout) return
        data.cell.styles.cellPadding = { top: 3, right: 3, bottom: 3 + layout.blockH, left: 3 }
      },
      didDrawCell: (data: Any) => {
        if (data.section !== 'body' || data.column.index !== 0) return
        const layout = rowPhotos[data.row.index]
        if (!layout) return
        const blockTop = data.cell.y + data.cell.height - layout.blockH + topPad
        for (const pos of layout.positions) {
          const xx = marginX + pos.x
          const yy = blockTop + pos.row * (imgH + gap)
          if (pos.img.dataUrl) {
            try { doc.addImage(pos.img.dataUrl, 'JPEG', xx, yy, pos.w, imgH) } catch { drawPhotoPlaceholder(doc, xx, yy, pos.w, imgH) }
          } else { drawPhotoPlaceholder(doc, xx, yy, pos.w, imgH) }
          if (pos.img.url) doc.link(xx, yy, pos.w, imgH, { url: pos.img.url })
        }
      },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  const footer = (input.submitterName ?? 'Submitted by -') + '  -  generated ' + fmtDateTime(new Date())
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(140, 146, 154)
  doc.text(footer, marginX, pageHeight - 8)
}

// Storage photo -> small inline JPEG thumbnail (resized by Storage's transformer
// so the worker never downloads the full-size photo) plus a link to the full image.
async function resolveStoragePhoto(svc: Any, path: string): Promise<Any | null> {
  const { data: full } = await svc.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365 * 5)
  const url = full?.signedUrl ?? ''
  let dataUrl: string | null = null
  let w = 3, h = 4
  try {
    const { data: thumb } = await svc.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60, { transform: { width: 512, height: 512, resize: 'contain', quality: 55 } })
    if (thumb?.signedUrl) {
      const r = await fetch(thumb.signedUrl, { headers: { Accept: 'image/jpeg' } })
      if (r.ok) {
        const bytes = new Uint8Array(await r.arrayBuffer())
        if (bytes[0] === 0xff && bytes[1] === 0xd8) {
          const dim = jpegSize(bytes)
          if (dim && dim.w > 0 && dim.h > 0) { w = dim.w; h = dim.h }
          dataUrl = 'data:image/jpeg;base64,' + encodeBase64(bytes)
        }
      }
    }
  } catch (_) { /* link-only fallback */ }
  return url || dataUrl ? { url, dataUrl, w, h } : null
}

async function buildPdfBase64(svc: Any, audit: Any, siteName: string): Promise<string> {
  let schema: Any = DEFAULT_SCHEMA
  const { data: cf } = await svc.from('custom_forms').select('schema').eq('account_id', audit.account_id).eq('form_key', 'site_audit').maybeSingle()
  if (cf?.schema) schema = cf.schema

  const answers = reconstructAnswers(schema, audit)

  // New audits: storage-path photos on each item's answer.
  const photoImages: Record<string, Any> = {}
  const paths: string[] = []
  for (const v of Object.values(answers)) {
    const ph = (v as Any)?.photos
    if (Array.isArray(ph)) for (const p of ph) if (typeof p === 'string') paths.push(p)
  }
  for (const p of paths) {
    const resolved = await resolveStoragePhoto(svc, p)
    if (resolved) photoImages[p] = resolved
  }

  // Legacy audits: base64 photos in ops_attachments (keyed by item id in label).
  const { data: atts } = await svc.from('ops_attachments').select('id, label, file_type, data_uri').eq('entity_type', 'audit').eq('entity_id', audit.id)
  for (const a of (atts ?? []) as Any[]) {
    if (!a.data_uri || !String(a.file_type ?? '').startsWith('image/')) continue
    const itemId = a.label ?? ''
    if (!itemId) continue
    let w = 3, h = 4
    try { const dim = jpegSize(decodeBase64(String(a.data_uri).split(',')[1] ?? '')); if (dim && dim.w > 0) { w = dim.w; h = dim.h } } catch (_) { /* keep default ratio */ }
    photoImages[a.id] = { url: '', dataUrl: a.data_uri, w, h }
    const cur = (answers[itemId] ?? {}) as Any
    answers[itemId] = { ...cur, photos: [...((cur.photos as string[] | undefined) ?? []), a.id] }
  }

  let logo: Any = null
  try {
    const lr = await fetch('https://operator.washlyfe.com/mw-logo.png')
    if (lr.ok) { const lb = new Uint8Array(await lr.arrayBuffer()); const d = pngSize(lb); logo = { dataUrl: 'data:image/png;base64,' + encodeBase64(lb), w: d.w, h: d.h } }
  } catch (_) { /* skip logo */ }

  const metaLine = ['Site: ' + (siteName || '-'), 'Date: ' + fmtDate(audit.created_at), 'Auditor: ' + (audit.submitted_by_name ?? '-')].join('  |  ')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true })
  renderAudit(doc, { metaLine, schema, answers, submitterName: audit.submitted_by_name, photoImages, logo })
  return encodeBase64(new Uint8Array(doc.output('arraybuffer')))
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return json({ error: 'no_key', message: 'Email is not configured.' }, 503, origin)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const fromAddr = Deno.env.get('RESEND_FROM') ?? 'WashLyfe Operator <notifications@washlyfe.com>'
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  let body: { audit_id?: string; test?: boolean } = {}
  try { body = await req.json() } catch { /* empty */ }
  const auditId = body.audit_id
  if (!auditId) return json({ error: 'bad_request' }, 400, origin)

  // Auth: owner/manager of the account, or the service role.
  const auth = req.headers.get('Authorization') ?? ''
  let callerAccount: string | null = null
  if (jwtRole(auth) === 'service_role') {
    callerAccount = null // service role may email any account's audit
  } else {
    if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
    const { data: u } = await userClient.auth.getUser()
    const callerId = u.user?.id
    if (!callerId) return json({ error: 'unauthorized' }, 401, origin)
    const { data: caller } = await svc.from('users').select('account_id, role').eq('id', callerId).maybeSingle()
    const c = caller as Any
    if (!c || !(c.role === 'owner' || c.role === 'manager')) return json({ error: 'forbidden' }, 403, origin)
    callerAccount = c.account_id
  }

  const { data: audit } = await svc
    .from('site_audits')
    .select('id, account_id, submitted_by_name, created_at, initial_observations, primary_section, secondary_section, priority_section, final_thoughts, section_comments, explanation, location:location_id(name)')
    .eq('id', auditId)
    .maybeSingle()
  const auditRow = audit as Any
  if (!auditRow || (callerAccount && auditRow.account_id !== callerAccount)) {
    return json({ error: 'not_found' }, 404, origin)
  }

  const site = ((auditRow.location?.name ?? '') as string).trim()
  const siteKey = site.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const siteLocal = site.toLowerCase().replace(/[^a-z0-9]/g, '')
  const siteEmail = siteLocal ? `${siteLocal}@mighty-wash.com` : null
  const rmEmail = RM_BY_SITE[siteKey] ?? null

  const recipients = body.test
    ? ['kjowers@mighty-wash.com']
    : Array.from(new Set([...FIXED_TO, ...(siteEmail ? [siteEmail] : []), ...(rmEmail ? [rmEmail] : [])]))

  let pdfB64: string
  try {
    pdfB64 = await buildPdfBase64(svc, auditRow, site)
  } catch (e) {
    return json({ ok: false, error: 'pdf_build_failed: ' + (e instanceof Error ? e.message : String(e)) }, 500, origin)
  }

  const filename = `site-audit-${(site || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`
  const when = (auditRow.created_at ?? '') as string
  const rows: [string, string][] = [
    ['Site', site || '—'],
    ['Auditor', auditRow.submitted_by_name ?? '—'],
    ['Date', when ? new Date(when).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'],
  ]
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 16px;font-size:20px;">New Site Audit${site ? ': ' + esc(site) : ''}${body.test ? ' (TEST)' : ''}</h2>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        ${rows.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:6px 0;font-weight:600;">${esc(v)}</td></tr>`).join('')}
      </table>
      <p style="margin:20px 0 0;font-size:14px;">The full audit is attached as a PDF, with any photos shown beneath their line item.</p>
      <p style="margin:20px 0 0;color:#888;font-size:12px;">Submitted from WashLyfe Operator.</p>
    </div>`

  const resend = new Resend(resendKey)
  try {
    const { error } = await resend.emails.send({
      from: fromAddr,
      to: recipients,
      subject: `Site Audit${site ? ': ' + site : ''}${body.test ? ' (TEST)' : ''}`,
      html,
      attachments: [{ filename, content: pdfB64 }],
    })
    if (error) return json({ ok: false, error: (error as { message?: string }).message ?? 'send_failed' }, 502, origin)
    return json({ ok: true, test: !!body.test, recipients }, 200, origin)
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : 'send_failed' }, 502, origin)
  }
})
