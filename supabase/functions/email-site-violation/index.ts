// email-site-violation — Supabase Edge Function (Deno).
// Emails a Site Violation PDF (photos embedded) to a fixed short list: kjowers,
// the site's regional manager, and lkeith. The PDF is built SERVER-SIDE from the
// violation id (service-role access to the row + its ops_attachments photos), so
// delivery never depends on the device.
//
// Body: { violation_id: string, test?: boolean }. When test is true, the email
// goes ONLY to kjowers@mighty-wash.com.
//
// Mighty Wash only: the recipients are all @mighty-wash.com, so a non-MW
// account's violation is skipped (never emailed).
//
// Auth: owner/manager of the violation's account, or the service role.
// Required secret: RESEND_API_KEY. Optional: RESEND_FROM.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'
import { jsPDF } from 'npm:jspdf@4.2.1'
import autoTable from 'npm:jspdf-autotable@5.0.8'
import { format } from 'npm:date-fns@4'
import { encodeBase64, decodeBase64 } from 'jsr:@std/encoding@1/base64'

// deno-lint-ignore no-explicit-any
type Any = any

const MW_ACCOUNT_ID = '54f3e299-1f61-4ed2-9921-3d02160b72e6'

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

const fmtDate = (d: string | null | undefined): string => {
  if (!d) return '-'
  const p = new Date(d)
  return Number.isNaN(p.getTime()) ? '-' : format(p, 'MMM d, yyyy')
}
const titleCase = (s: string | null | undefined): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '-')

type ViolationImage = { dataUrl: string; fmt: 'JPEG' | 'PNG'; w: number; h: number }

// Mirrors src/lib/reports/siteViolationPdf.ts: header, detail grid, photos (2-up),
// attached documents, footer.
function renderViolation(doc: Any, input: Any): void {
  const marginX = 14
  const topMargin = 16
  const pageHeight = doc.internal.pageSize.getHeight()
  const pageWidth = doc.internal.pageSize.getWidth()
  const contentWidth = pageWidth - marginX * 2

  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(11, 15, 20)
  doc.text('Site Violation', marginX, topMargin)

  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(110, 116, 124)
  const meta = ['Site: ' + (input.siteName ?? '-'), 'Department: ' + (input.department ?? '-'), 'Reported: ' + fmtDate(input.reportedAt)].join('  |  ')
  doc.text(meta, marginX, topMargin + 7)

  if (input.logo?.dataUrl) {
    const logoH = 18
    const logoW = input.logo.w > 0 && input.logo.h > 0 ? logoH * (input.logo.w / input.logo.h) : logoH
    try { doc.addImage(input.logo.dataUrl, 'PNG', pageWidth - marginX - logoW, 6, logoW, logoH) } catch { /* skip */ }
  }

  const rows: [string, string][] = []
  const push = (k: string, v: string | null | undefined) => { if (v && String(v).trim()) rows.push([k, String(v).trim()]) }
  push('Violation Type', input.violationType)
  push('Severity', titleCase(input.severity))
  push('Status', titleCase(input.status))
  push('Reported by', input.reportedByName)
  push('Due date', input.dueDate ? fmtDate(input.dueDate) : null)
  push('Resolved by', input.resolvedByName)
  push('Resolved', input.resolvedAt ? fmtDate(input.resolvedAt) : null)
  push('Resolution notes', input.resolutionNotes)
  push('Notes / description', input.description)

  autoTable(doc, {
    startY: topMargin + 14,
    body: rows.length ? rows : [['-', '-']],
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 3, valign: 'top' },
    columnStyles: {
      0: { cellWidth: contentWidth * 0.28, fontStyle: 'bold', textColor: [90, 96, 104] },
      1: { cellWidth: contentWidth * 0.72, textColor: [20, 24, 30] },
    },
  })
  let y = doc.lastAutoTable.finalY + 8

  const images = (input.images ?? []) as ViolationImage[]
  const docs = (input.docs ?? []) as { name: string }[]

  if (images.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(11, 15, 20)
    doc.text('Photos', marginX, y); y += 4

    const gap = 4, cols = 2
    const cellW = (contentWidth - gap * (cols - 1)) / cols
    const cellH = 55
    let col = 0
    for (const im of images) {
      if (y + cellH > pageHeight - 16) { doc.addPage(); y = topMargin }
      const x = marginX + col * (cellW + gap)
      const ratio = im.w && im.h ? im.w / im.h : 1
      let w = cellW, h = w / ratio
      if (h > cellH) { h = cellH; w = h * ratio }
      try { doc.addImage(im.dataUrl, im.fmt, x, y, w, h) } catch {
        doc.setDrawColor(210, 214, 220); doc.setFillColor(240, 242, 245); doc.rect(x, y, cellW, cellH, 'FD')
      }
      col += 1
      if (col >= cols) { col = 0; y += cellH + gap }
    }
    if (col !== 0) y += cellH + gap
  }

  if (docs.length) {
    if (y + 12 > pageHeight - 16) { doc.addPage(); y = topMargin }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(11, 15, 20)
    doc.text('Attached documents', marginX, y); y += 5
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 96, 104)
    for (const d of docs) { doc.text('• ' + (d.name || 'document'), marginX, y); y += 5 }
  }

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(140, 146, 154)
  doc.text('Generated ' + format(new Date(), 'MMM d, yyyy h:mm a'), marginX, pageHeight - 8)
}

async function buildPdfBase64(svc: Any, v: Any, siteName: string): Promise<string> {
  const { data: atts } = await svc
    .from('ops_attachments')
    .select('id, label, file_type, file_name, data_uri')
    .eq('entity_type', 'violation')
    .eq('entity_id', v.id)
    .order('created_at')

  const images: ViolationImage[] = []
  const docs: { name: string }[] = []
  for (const a of (atts ?? []) as Any[]) {
    const ft = String(a.file_type ?? '')
    if (ft.startsWith('image/') && a.data_uri) {
      const b64 = String(a.data_uri).split(',')[1] ?? ''
      let w = 3, h = 4
      const fmt: 'JPEG' | 'PNG' = ft.includes('png') ? 'PNG' : 'JPEG'
      try {
        const bytes = decodeBase64(b64)
        const dim = fmt === 'PNG' ? pngSize(bytes) : jpegSize(bytes)
        if (dim && dim.w > 0 && dim.h > 0) { w = dim.w; h = dim.h }
      } catch (_) { /* keep default ratio */ }
      images.push({ dataUrl: a.data_uri, fmt, w, h })
    } else {
      docs.push({ name: a.file_name ?? a.label ?? 'document' })
    }
  }

  let logo: Any = null
  try {
    const lr = await fetch('https://operator.washlyfe.com/mw-logo.png')
    if (lr.ok) { const lb = new Uint8Array(await lr.arrayBuffer()); const d = pngSize(lb); logo = { dataUrl: 'data:image/png;base64,' + encodeBase64(lb), w: d.w, h: d.h } }
  } catch (_) { /* skip logo */ }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true })
  renderViolation(doc, {
    siteName,
    department: v.department,
    violationType: v.violation_type,
    severity: v.severity,
    status: v.status,
    description: v.description,
    reportedByName: v.reported_by_name,
    reportedAt: v.reported_at ?? v.created_at,
    dueDate: v.due_date,
    resolvedByName: v.resolved_by_name,
    resolvedAt: v.resolved_at,
    resolutionNotes: v.resolution_notes,
    images,
    docs,
    logo,
  })
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

  let body: { violation_id?: string; test?: boolean } = {}
  try { body = await req.json() } catch { /* empty */ }
  const violationId = body.violation_id
  if (!violationId) return json({ error: 'bad_request' }, 400, origin)

  // Auth: owner/manager of the account, or the service role.
  const auth = req.headers.get('Authorization') ?? ''
  let callerAccount: string | null = null
  if (jwtRole(auth) === 'service_role') {
    callerAccount = null
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

  const { data: v } = await svc
    .from('site_violations')
    .select('id, account_id, department, violation_type, severity, status, description, due_date, reported_by_name, reported_at, resolved_by_name, resolved_at, resolution_notes, created_at, location:location_id(name)')
    .eq('id', violationId)
    .maybeSingle()
  const row = v as Any
  if (!row || (callerAccount && row.account_id !== callerAccount)) return json({ error: 'not_found' }, 404, origin)

  // MW-only: recipients are all @mighty-wash.com, so skip other accounts.
  if (row.account_id !== MW_ACCOUNT_ID) return json({ ok: true, skipped: 'not_mw' }, 200, origin)

  const site = ((row.location?.name ?? '') as string).trim()
  const siteKey = site.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const rmEmail = RM_BY_SITE[siteKey] ?? null

  const recipients = body.test
    ? ['kjowers@mighty-wash.com']
    : Array.from(new Set(['kjowers@mighty-wash.com', ...(rmEmail ? [rmEmail] : []), 'lkeith@mighty-wash.com']))

  let pdfB64: string
  try {
    pdfB64 = await buildPdfBase64(svc, row, site)
  } catch (e) {
    return json({ ok: false, error: 'pdf_build_failed: ' + (e instanceof Error ? e.message : String(e)) }, 500, origin)
  }

  const filename = `site-violation-${(site || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`
  const detailRows: [string, string][] = [
    ['Site', site || '—'],
    ['Department', row.department ?? '—'],
    ['Violation Type', row.violation_type ?? '—'],
    ['Severity', titleCase(row.severity)],
    ['Reported by', row.reported_by_name ?? '—'],
    ['Reported', fmtDate(row.reported_at ?? row.created_at)],
  ]
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 16px;font-size:20px;">New Site Violation${site ? ': ' + esc(site) : ''}${body.test ? ' (TEST)' : ''}</h2>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        ${detailRows.map(([k, val]) => `<tr><td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:6px 0;font-weight:600;">${esc(val)}</td></tr>`).join('')}
      </table>
      <p style="margin:20px 0 0;font-size:14px;">The full violation report is attached as a PDF, with any photos included.</p>
      <p style="margin:20px 0 0;color:#888;font-size:12px;">Submitted from WashLyfe Operator.</p>
    </div>`

  const resend = new Resend(resendKey)
  try {
    const { error } = await resend.emails.send({
      from: fromAddr,
      to: recipients,
      subject: `Site Violation${site ? ': ' + site : ''}${body.test ? ' (TEST)' : ''}`,
      html,
      attachments: [{ filename, content: pdfB64 }],
    })
    if (error) return json({ ok: false, error: (error as { message?: string }).message ?? 'send_failed' }, 502, origin)
    return json({ ok: true, test: !!body.test, recipients }, 200, origin)
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : 'send_failed' }, 502, origin)
  }
})
