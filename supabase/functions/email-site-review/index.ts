// email-site-review — Supabase Edge Function (Deno).
// Emails an RM Site Review PDF to the recipients. The PDF is built SERVER-SIDE
// from the review id (the function has service-role access to the review + its
// photos), so email delivery never depends on the submitter's device building
// and uploading a large PDF. A client may still pass a prebuilt pdf_base64 for
// back-compat.
//
// Recipients: lkeith + kjowers (override via SITE_REVIEW_EMAIL_TO), the site's
// own address (MW01 -> mw01@mighty-wash.com), and the submitter.
// Required secret: RESEND_API_KEY. Optional: RESEND_FROM, SITE_REVIEW_EMAIL_TO.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'
import { jsPDF } from 'npm:jspdf@4.2.1'
import autoTable from 'npm:jspdf-autotable@5.0.8'
import { format } from 'npm:date-fns@4'
import { encodeBase64 } from 'jsr:@std/encoding@1/base64'

const BUCKET = 'site-review-photos'
// deno-lint-ignore no-explicit-any
type Any = any

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

const DEFAULT_SCHEMA = {
  version: 1,
  sections: [
    { id: 'site_approach', title: 'Site Approach', items: [
      { id: 'trash_on_lot', label: 'Trash on lot and curbs', type: 'pass_fail' },
      { id: 'signs_clean_visible', label: 'Signs are clean, visible, and not fading', type: 'pass_fail' },
      { id: 'xpt_screens_clean', label: 'XPT screens and area are clean', type: 'pass_fail' },
      { id: 'building_clean_yard_maintained', label: 'Building clean and yard maintained with no weeds', type: 'pass_fail' },
      { id: 'employees_clean_attire', label: 'Employees clean and in proper attire', type: 'pass_fail' },
      { id: 'employee_present_at_xpts', label: 'Employee present at XPTs when arrived', type: 'pass_fail' },
      { id: 'dumpster_pad_clean', label: 'Dumpster pad clean of debris and gates shut', type: 'pass_fail' },
    ] },
    { id: 'tunnel', title: 'Tunnel', items: [
      { id: 'cleanliness_of_walls', label: 'Cleanliness of walls', type: 'pass_fail' },
      { id: 'windows_cleaned', label: 'Windows cleaned outside and in (including sills)', type: 'pass_fail' },
      { id: 'equipment_working', label: 'Equipment working properly', type: 'pass_fail' },
      { id: 'equipment_cleaned', label: 'Equipment cleaned properly', type: 'pass_fail' },
      { id: 'chain_tension', label: 'Chain tension', type: 'pass_fail' },
      { id: 'tool_room_clean', label: 'Tool room cleaned and organized', type: 'pass_fail' },
      { id: 'floor_ceiling_cleaned', label: 'Floor and ceiling cleaned', type: 'pass_fail' },
      { id: 'trash_cleaned_power_locks', label: 'Trash cleaned from power locks', type: 'pass_fail' },
      { id: 'cameras_wiped', label: 'All cameras wiped', type: 'pass_fail' },
    ] },
    { id: 'procedures_management', title: 'Procedures / Management', items: [
      { id: 'proper_prepping', label: 'Proper prepping procedures', type: 'pass_fail' },
      { id: 'proper_hand_dry', label: 'Proper hand dry procedures', type: 'pass_fail' },
      { id: 'proper_qc', label: 'Proper QC procedures', type: 'pass_fail' },
      { id: 'proper_interior', label: 'Proper interior procedures', type: 'pass_fail' },
      { id: 'finished_product', label: 'Finished product', type: 'pass_fail' },
    ] },
    { id: 'summary', title: 'Summary', items: [
      { id: 'summary', label: 'Overall summary / action items', type: 'comments' },
      { id: 'photos', label: 'Photos / attachments', type: 'attachment' },
    ] },
  ],
}

function pngSize(b: Uint8Array): { w: number; h: number } {
  return { w: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], h: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] }
}
function drawPhotoPlaceholder(doc: Any, x: number, y: number, w: number, h: number): void {
  doc.setDrawColor(210, 214, 220); doc.setFillColor(240, 242, 245); doc.rect(x, y, w, h, 'FD')
  doc.setFontSize(7); doc.setTextColor(140, 146, 154); doc.text('Photo', x + w / 2, y + h / 2, { align: 'center' })
}
const fmt12 = (hhmm: string | null | undefined): string => {
  if (!hhmm) return '-'
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return '-'
  const period = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return h12 + ':' + String(m).padStart(2, '0') + ' ' + period
}
const fmtDate = (d: string | null | undefined): string => {
  if (!d) return '-'
  const p = new Date(d)
  return Number.isNaN(p.getTime()) ? '-' : format(p, 'MMM d, yyyy')
}
const fmtDateTime = (d: Date): string => format(d, 'MMM d, yyyy h:mm a')

// Renders the review onto the doc: header, per-section tables, photos inline
// under each item's row, summary, footer. Mirrors src/lib/reports/siteReviewPdf.ts.
function renderReview(doc: Any, input: Any): void {
  doc.setFont('helvetica', 'normal')
  const marginX = 14, topMargin = 16
  const pageHeight = doc.internal.pageSize.getHeight()
  const pageWidth = doc.internal.pageSize.getWidth()
  const contentWidth = pageWidth - marginX * 2

  doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(11, 15, 20)
  doc.text(input.title ?? 'Monthly Site Review', marginX, topMargin)
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(110, 116, 124)
  const meta = ['Site: ' + (input.siteName ?? '-'), 'Date: ' + fmtDate(input.date), 'Weather: ' + (input.weather ?? '-'), 'Time Arrived: ' + fmt12(input.timeArrived)].join('  |  ')
  doc.text(meta, marginX, topMargin + 7)

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
    const rows: Any[] = []
    const rowPhotos: Any[] = []
    for (const item of section.items) {
      if (item.type === 'attachment') continue
      const ans = input.answers[item.id]
      if (item.type === 'pass_fail') {
        const v = ans?.value
        const pf = v === 'pass' ? 'Pass' : v === 'fail' ? 'Fail' : '-'
        const comments = ((ans?.comments as string | undefined) ?? '').toString().trim() || '-'
        rows.push([item.label, pf, comments])
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
      head: [['Item', 'Pass/Fail', 'Comments']],
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

  const summary = (input.summaryText ?? '').trim()
  if (summary) {
    ensureSpace(20)
    doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(11, 15, 20)
    doc.text('Summary', marginX, y); y += 6
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 44, 52)
    for (const line of doc.splitTextToSize(summary, contentWidth) as string[]) { ensureSpace(5); doc.text(line, marginX, y); y += 5 }
  }

  const footer = (input.submitterName ?? 'Submitted by -') + '  -  generated ' + fmtDateTime(new Date())
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(140, 146, 154)
  doc.text(footer, marginX, pageHeight - 8)
}

// Long-lived signed link for a photo. The server does NOT download/decode the
// image (full-size phone photos would exceed the edge worker's memory), so the
// PDF shows a placeholder with a clickable link to the full photo. Thumbnails
// stay a portrait-size default (portrait phone photos).
async function resolvePhoto(svc: Any, path: string): Promise<Any | null> {
  const { data: signed } = await svc.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365 * 5)
  const url = signed?.signedUrl ?? ''
  return url ? { url, w: 3, h: 4 } : null
}

async function buildPdfBase64(svc: Any, reviewRow: Any, siteName: string): Promise<string> {
  const answers = (reviewRow.answers ?? {}) as Record<string, Any>
  const metaObj = (answers.__meta ?? {}) as { weather?: string; timeArrived?: string }

  // Schema: the account's customized site_review form, else the default.
  let schema: Any = DEFAULT_SCHEMA
  const { data: cf } = await svc.from('custom_forms').select('schema').eq('account_id', reviewRow.account_id).eq('form_key', 'site_review').maybeSingle()
  if (cf?.schema) schema = cf.schema

  // Photos, one at a time to keep peak memory low.
  const photoImages: Record<string, Any> = {}
  const paths: string[] = []
  for (const v of Object.values(answers)) {
    const ph = (v as Any)?.photos
    if (Array.isArray(ph)) for (const p of ph) if (typeof p === 'string') paths.push(p)
  }
  for (const p of paths) {
    const resolved = await resolvePhoto(svc, p)
    if (resolved) photoImages[p] = resolved
  }

  // Logo (Mighty Wash), top-right.
  let logo: Any = null
  try {
    const lr = await fetch('https://operator.washlyfe.com/mw-logo.png')
    if (lr.ok) { const lb = new Uint8Array(await lr.arrayBuffer()); const d = pngSize(lb); logo = { dataUrl: 'data:image/png;base64,' + encodeBase64(lb), w: d.w, h: d.h } }
  } catch (_) { /* skip logo */ }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  renderReview(doc, {
    title: 'Monthly Site Review',
    siteName,
    date: reviewRow.submitted_at,
    weather: metaObj.weather ?? null,
    timeArrived: metaObj.timeArrived ?? null,
    schema,
    answers,
    summaryText: reviewRow.additional_notes,
    submitterName: reviewRow.submitted_by_name,
    photoImages,
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
  const baseTo = (Deno.env.get('SITE_REVIEW_EMAIL_TO') ?? 'lkeith@mighty-wash.com,kjowers@mighty-wash.com')
    .split(',').map((s) => s.trim()).filter(Boolean)

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  const callerId = u.user?.id
  if (!callerId) return json({ error: 'unauthorized' }, 401, origin)

  let body: { review_id?: string; pdf_base64?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  const reviewId = body.review_id
  if (!reviewId) return json({ error: 'bad_request' }, 400, origin)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: caller } = await svc.from('users').select('account_id, role').eq('id', callerId).maybeSingle()
  const callerRow = caller as Any
  if (!callerRow || !(callerRow.role === 'owner' || callerRow.role === 'manager')) {
    return json({ error: 'forbidden' }, 403, origin)
  }

  const { data: review } = await svc
    .from('site_evaluations')
    .select('id, account_id, submitted_by, submitted_by_name, submitted_at, additional_notes, answers, location:location_id(name)')
    .eq('id', reviewId)
    .maybeSingle()
  const reviewRow = review as Any
  if (!reviewRow || reviewRow.account_id !== callerRow.account_id) {
    return json({ error: 'not_found' }, 404, origin)
  }

  let submitterEmail: string | null = null
  if (reviewRow.submitted_by) {
    const { data: sub } = await svc.from('users').select('email').eq('id', reviewRow.submitted_by).maybeSingle()
    submitterEmail = ((sub as Any)?.email ?? '').trim() || null
  }

  const site = ((reviewRow.location?.name ?? '') as string).trim()
  const when = (reviewRow.submitted_at ?? '') as string
  const filename = `site-review-${(site || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`

  const siteLocal = site.toLowerCase().replace(/[^a-z0-9]/g, '')
  const siteEmail = siteLocal ? `${siteLocal}@mighty-wash.com` : null
  const recipients = Array.from(new Set([...baseTo, ...(siteEmail ? [siteEmail] : []), ...(submitterEmail ? [submitterEmail] : [])]))

  let pdfB64: string
  try {
    pdfB64 = body.pdf_base64 ?? (await buildPdfBase64(svc, reviewRow, site))
  } catch (e) {
    return json({ ok: false, error: 'pdf_build_failed: ' + (e instanceof Error ? e.message : String(e)) }, 500, origin)
  }

  const rows: [string, string][] = [
    ['Site', site || '—'],
    ['Submitted by', reviewRow.submitted_by_name ?? '—'],
    ['Date', when ? new Date(when).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'],
  ]
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 16px;font-size:20px;">New RM Site Review${site ? ': ' + esc(site) : ''}</h2>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        ${rows.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:6px 0;font-weight:600;">${esc(v)}</td></tr>`).join('')}
      </table>
      <p style="margin:20px 0 0;font-size:14px;">The full review is attached as a PDF. Photos are included as clickable links.</p>
      <p style="margin:20px 0 0;color:#888;font-size:12px;">Submitted from WashLyfe Operator.</p>
    </div>`

  const resend = new Resend(resendKey)
  try {
    const { error } = await resend.emails.send({
      from: fromAddr,
      to: recipients,
      subject: `RM Site Review${site ? ' — ' + site : ''}`,
      html,
      attachments: [{ filename, content: pdfB64 }],
    })
    if (error) return json({ ok: false, error: (error as { message?: string }).message ?? 'send_failed' }, 502, origin)
    return json({ ok: true, recipients }, 200, origin)
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : 'send_failed' }, 502, origin)
  }
})
