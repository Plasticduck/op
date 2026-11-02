import type { Json } from '@/lib/database.types'
import type { SiteAuditAnswers, SiteAuditSchema } from './siteAuditSchema'

// A Site Audit stores its answers across split columns (one per fixed section)
// plus flattened text for initial_observations / explanation. These move answers
// between that shape and the single answers-by-item-id object the form and the
// PDF use.
export type StoredAudit = {
  initial_observations: string | null
  primary_section: unknown
  secondary_section: unknown
  priority_section: unknown
  final_thoughts: unknown
  section_comments: unknown
  explanation: string | null
}

// In-progress edit of a submitted audit, saved on its row until the resubmit.
export type AuditEditDraft = {
  locationId: string
  answers: SiteAuditAnswers
  byName: string | null
  savedAt: string
}

const KNOWN_SECTION_IDS = new Set([
  'initial_observations',
  'primary',
  'secondary',
  'priority',
  'final_thoughts',
  'explanation',
  'attachments',
])

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

export function reconstructAuditAnswers(schema: SiteAuditSchema, audit: StoredAudit): SiteAuditAnswers {
  const answers: SiteAuditAnswers = {}
  const merge = (obj: unknown) => {
    if (isObject(obj)) {
      for (const [k, v] of Object.entries(obj)) answers[k] = v
    }
  }
  merge(audit.primary_section)
  merge(audit.secondary_section)
  merge(audit.priority_section)
  merge(audit.final_thoughts)
  // section_comments nests any custom sections: { sectionId: { itemId: answer } }.
  if (isObject(audit.section_comments)) {
    for (const v of Object.values(audit.section_comments)) merge(v)
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

function sliceAnswers(schema: SiteAuditSchema, answers: SiteAuditAnswers, sectionId: string): SiteAuditAnswers {
  const section = schema.sections.find((s) => s.id === sectionId)
  if (!section) return {}
  const slice: SiteAuditAnswers = {}
  for (const item of section.items) {
    if (item.id in answers) slice[item.id] = answers[item.id]
  }
  return slice
}

function firstCommentsText(schema: SiteAuditSchema, answers: SiteAuditAnswers, sectionId: string): string | null {
  const section = schema.sections.find((s) => s.id === sectionId)
  if (!section) return null
  for (const item of section.items) {
    if (item.type === 'comments') {
      const ans = (answers[item.id] ?? {}) as Record<string, unknown>
      const v = ((ans.value as string | undefined) ?? '').trim()
      if (v) return v
    }
  }
  return null
}

// The columns a set of answers is stored in. Photos are already uploaded to
// storage while filling the form; their paths ride along on each item's answer.
export function auditColumns(schema: SiteAuditSchema, answers: SiteAuditAnswers) {
  const extraComments: SiteAuditAnswers = {}
  for (const section of schema.sections) {
    if (KNOWN_SECTION_IDS.has(section.id)) continue
    const slice = sliceAnswers(schema, answers, section.id)
    if (Object.keys(slice).length > 0) extraComments[section.id] = slice
  }

  // Initial Observations carries scored items (e.g. Dress Code) alongside its
  // curb-appeal comments; the comments text goes to its own column, so persist
  // the scored items in section_comments too so they round-trip into the PDF.
  const initialObsSection = schema.sections.find((s) => s.id === 'initial_observations')
  if (initialObsSection) {
    const scored = sliceAnswers(schema, answers, 'initial_observations')
    for (const it of initialObsSection.items) if (it.type === 'comments') delete scored[it.id]
    if (Object.keys(scored).length > 0) extraComments['initial_observations'] = scored
  }

  return {
    initial_observations: firstCommentsText(schema, answers, 'initial_observations'),
    primary_section: sliceAnswers(schema, answers, 'primary') as Json,
    secondary_section: sliceAnswers(schema, answers, 'secondary') as Json,
    priority_section: sliceAnswers(schema, answers, 'priority') as Json,
    final_thoughts: sliceAnswers(schema, answers, 'final_thoughts') as Json,
    section_comments: (Object.keys(extraComments).length > 0 ? extraComments : null) as Json,
    explanation: firstCommentsText(schema, answers, 'explanation'),
  }
}

// The columns for a resubmit. The form can be customized after an audit is
// submitted, and answers to items no longer on it can't be shown for editing, so
// they're carried over instead of being dropped.
export function editedAuditColumns(schema: SiteAuditSchema, audit: StoredAudit, answers: SiteAuditAnswers) {
  const onForm = new Set(schema.sections.flatMap((s) => s.items.map((it) => it.id)))
  const retired = (stored: unknown): SiteAuditAnswers =>
    Object.fromEntries(Object.entries(isObject(stored) ? stored : {}).filter(([k]) => !onForm.has(k)))
  const hasCommentsItem = (sectionId: string) =>
    !!schema.sections.find((s) => s.id === sectionId)?.items.some((it) => it.type === 'comments')

  const next = auditColumns(schema, answers)
  const comments: Record<string, unknown> = isObject(next.section_comments) ? { ...next.section_comments } : {}
  for (const [sectionId, stored] of Object.entries(isObject(audit.section_comments) ? audit.section_comments : {})) {
    const kept = retired(stored)
    if (Object.keys(kept).length > 0) comments[sectionId] = { ...kept, ...(comments[sectionId] as object | undefined) }
  }

  return {
    initial_observations: hasCommentsItem('initial_observations') ? next.initial_observations : audit.initial_observations,
    primary_section: { ...retired(audit.primary_section), ...(next.primary_section as object) } as Json,
    secondary_section: { ...retired(audit.secondary_section), ...(next.secondary_section as object) } as Json,
    priority_section: { ...retired(audit.priority_section), ...(next.priority_section as object) } as Json,
    final_thoughts: { ...retired(audit.final_thoughts), ...(next.final_thoughts as object) } as Json,
    section_comments: (Object.keys(comments).length > 0 ? comments : null) as Json,
    explanation: hasCommentsItem('explanation') ? next.explanation : audit.explanation,
  }
}

// Whether an audit's answers line up with the current form. Audits from before
// this form (Mar-May 2026) stored them by position ("0", "1", ...), so the edit
// form would open blank on them. The comment columns don't count: they map onto
// any form, whether or not the rest of the audit does.
export function auditFitsForm(schema: SiteAuditSchema, audit: StoredAudit): boolean {
  const onForm = new Set(schema.sections.flatMap((s) => s.items.map((it) => it.id)))
  return [audit.primary_section, audit.secondary_section, audit.priority_section, audit.final_thoughts]
    .some((col) => isObject(col) && Object.keys(col).some((k) => onForm.has(k)))
}

// Every storage photo path attached to a set of answers.
export function answerPhotoPaths(answers: SiteAuditAnswers): string[] {
  const paths: string[] = []
  for (const v of Object.values(answers)) {
    const ph = (v as { photos?: unknown } | null | undefined)?.photos
    if (Array.isArray(ph)) for (const p of ph) if (typeof p === 'string') paths.push(p)
  }
  return [...new Set(paths)]
}
