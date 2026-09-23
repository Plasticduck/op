import { format } from 'date-fns'
import type { SiteAuditSchema, SiteAuditAnswers } from '@/features/opssuite/siteAuditSchema'
import type { SiteReviewSchema } from '@/features/opssuite/siteReviewSchema'
import type { SiteReviewPdfInput } from './siteReviewPdf'
import { buildSiteReviewPdf } from './siteReviewPdf'
import type { PdfLogo } from '@/lib/pdfLogo'

export { openPdfInNewTab, downloadBlob } from './siteReviewPdf'

// A Site Audit stores its answers across split columns (one per fixed section)
// plus flattened text for initial_observations / explanation. This rebuilds the
// single answers-by-item-id object the shared review PDF builder expects.
type AuditRow = {
  initial_observations: string | null
  primary_section: unknown
  secondary_section: unknown
  priority_section: unknown
  final_thoughts: unknown
  section_comments: unknown
  explanation: string | null
  submitted_by_name: string | null
  created_at: string | null
  location?: { name: string } | null
}

export function reconstructAuditAnswers(schema: SiteAuditSchema, audit: AuditRow): SiteAuditAnswers {
  const answers: SiteAuditAnswers = {}
  const merge = (obj: unknown) => {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) answers[k] = v
    }
  }
  merge(audit.primary_section)
  merge(audit.secondary_section)
  merge(audit.priority_section)
  merge(audit.final_thoughts)
  // section_comments nests any custom sections: { sectionId: { itemId: answer } }.
  if (audit.section_comments && typeof audit.section_comments === 'object') {
    for (const v of Object.values(audit.section_comments as Record<string, unknown>)) merge(v)
  }
  // initial_observations + explanation are stored as flat text; map each back to
  // the first comments item of its section so it renders in place.
  const setFirstComments = (sectionId: string, text: string | null) => {
    if (!text) return
    const section = schema.sections.find((s) => s.id === sectionId)
    const item = section?.items.find((it) => it.type === 'comments')
    if (item) answers[item.id] = { value: text }
  }
  setFirstComments('initial_observations', audit.initial_observations)
  setFirstComments('explanation', audit.explanation)
  return answers
}

export type AuditAttachment = { id: string; label: string | null; file_type: string | null; data_uri: string | null }

// Turn each attachment's base64 data URI into an embeddable JPEG thumbnail (with
// pixel size), grouped by the item id stored in `label`. Undecodable images
// (e.g. HEIC) are dropped rather than failing the whole export. No clickable URL
// is set (the image lives only in the DB), so the PDF just embeds the thumbnail.
async function resolveAuditPhotos(attachments: AuditAttachment[]): Promise<{
  photosByItem: Record<string, string[]>
  photoImages: Record<string, { url: string; dataUrl?: string; w?: number; h?: number }>
}> {
  const photosByItem: Record<string, string[]> = {}
  const photoImages: Record<string, { url: string; dataUrl?: string; w?: number; h?: number }> = {}
  await Promise.all(
    attachments.map(async (a) => {
      if (!a.data_uri || !(a.file_type ?? '').startsWith('image/')) return
      const itemId = a.label ?? ''
      if (!itemId) return
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const im = new Image()
          im.onload = () => resolve(im)
          im.onerror = reject
          im.src = a.data_uri as string
        })
        const maxDim = 1200
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
        const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale))
        const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0, w, h)
        photoImages[a.id] = { url: '', dataUrl: canvas.toDataURL('image/jpeg', 0.82), w, h }
        ;(photosByItem[itemId] ??= []).push(a.id)
      } catch {
        // Skip a single unreadable image.
      }
    }),
  )
  return { photosByItem, photoImages }
}

// Build the review-PDF input for one audit: reconstruct the answers, attach each
// item's photos, drop attachment-only sections, and add an audit-specific meta
// line. The shared builder then renders it (with the logo top-right).
export async function buildAuditPdfInput(
  audit: AuditRow,
  schema: SiteAuditSchema,
  attachments: AuditAttachment[],
  logo: PdfLogo | null,
): Promise<SiteReviewPdfInput> {
  const answers = reconstructAuditAnswers(schema, audit) as Record<string, { value?: unknown; comments?: unknown; photos?: string[] }>
  const { photosByItem, photoImages } = await resolveAuditPhotos(attachments)
  for (const [itemId, keys] of Object.entries(photosByItem)) {
    answers[itemId] = { ...(answers[itemId] ?? {}), photos: keys }
  }
  // Only render sections that have at least one non-attachment item (skips the
  // empty "Attachments" section, since photos hang off their own items).
  const sections = schema.sections.filter((s) => s.items.some((it) => it.type !== 'attachment'))
  const dateStr = audit.created_at
  const dateLabel = dateStr && !Number.isNaN(new Date(dateStr).getTime()) ? format(new Date(dateStr), 'MMM d, yyyy') : '-'
  const meta = ['Site: ' + (audit.location?.name ?? '-'), 'Date: ' + dateLabel, 'Auditor: ' + (audit.submitted_by_name ?? '-')].join('  |  ')
  return {
    title: 'Site Audit',
    siteName: audit.location?.name ?? null,
    date: dateStr,
    metaLine: meta,
    schema: { ...schema, sections } as unknown as SiteReviewSchema,
    answers,
    submitterName: audit.submitted_by_name,
    photoImages,
    logo,
  }
}

export async function buildSiteAuditPdf(input: SiteReviewPdfInput): Promise<Blob> {
  return buildSiteReviewPdf(input)
}
