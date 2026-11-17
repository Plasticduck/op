// Site Audit NEW: the questions and how an audit is graded.
//
// Eight sections, each worth an equal share of 100 points (12.5). Every item is
// rated green (pass), yellow (needs attention) or red (fail). One red item fails
// its section, so the section earns nothing; yellow is noted but doesn't fail it.
// A red item in Safety fails the whole audit, whatever the points.
//
// Answers are stored by `${section.id}.${item.id}`, so renaming a label is safe but
// changing an id orphans old answers. Bump FORM_VERSION if the questions change.

export type Rating = 'pass' | 'warn' | 'fail'
export type ItemAnswer = { value: Rating | null; comments: string; photos: string[] }
export type AuditAnswers = Record<string, ItemAnswer>

export type AuditItem = { id: string; label: string }
export type AuditSection = { id: string; title: string; items: AuditItem[]; failsAudit?: boolean }

export const FORM_VERSION = 1

export const AUDIT_SECTIONS: AuditSection[] = [
  {
    id: 'site',
    title: 'SITE',
    items: [
      { id: 'lot_cleanliness', label: 'Lot Cleanliness' },
      { id: 'landscaping', label: 'Landscaping' },
      { id: 'dumpster_trash_cans', label: 'Dumpster and/or Trash Cans' },
      { id: 'lot_trash', label: 'Lot Trash' },
    ],
  },
  {
    id: 'msa',
    title: 'MSA',
    items: [
      { id: 'attended', label: 'Attended' },
      { id: 'smile_wave', label: 'Smile and Wave' },
      { id: 'greet', label: 'Greet' },
      { id: 'dress_code', label: 'Dress Code (vest included)' },
    ],
  },
  {
    id: 'prep',
    title: 'PREP',
    items: [
      { id: 'bam', label: 'B.A.M. (Big Arm Movements)' },
      { id: 'smile_wave', label: 'Smile and Wave' },
      { id: 'pass_off', label: 'Pass off to Loader' },
      { id: 'dress_code', label: 'Dress Code (vest & PPE included)' },
      { id: 'under_45_seconds', label: 'Under 45 Seconds' },
      { id: 'positioning', label: 'Positioning' },
    ],
  },
  {
    id: 'tunnel',
    title: 'TUNNEL EQUIPMENT & CLEANLINESS',
    items: [
      { id: 'cleanliness', label: 'Cleanliness' },
      { id: 'equipment_working', label: 'Equipment Working' },
    ],
  },
  {
    id: 'qc',
    title: 'QC',
    items: [
      { id: 'dress_code', label: 'Dress Code (vest & PPE included)' },
      { id: 'smile_wave', label: 'Smile and Wave' },
      { id: 'positioning', label: 'Positioning' },
    ],
  },
  {
    id: 'vacs',
    title: 'VACS',
    items: [
      { id: 'cleanliness', label: 'Cleanliness' },
      { id: 'suction', label: 'Suction' },
      { id: 'trash', label: 'Trash' },
      { id: 'vac_pads', label: 'Vac Pads' },
      { id: 'holsters', label: 'Holsters' },
      { id: 'hoses', label: 'Hoses' },
      { id: 'air_pressure', label: 'Air Pressure' },
    ],
  },
  {
    id: 'site_walk',
    title: 'SITE WALK',
    items: [
      { id: 'bathrooms', label: 'Bathrooms' },
      { id: 'office', label: 'Office' },
      { id: 'storage', label: 'Storage' },
      { id: 'vac_shed', label: 'Vac Shed' },
      { id: 'mechanical_room', label: 'Mechanical Room' },
    ],
  },
  {
    id: 'safety',
    title: 'SAFETY',
    failsAudit: true,
    items: [
      { id: 'fire_extinguishers', label: 'Fire Extinguishers' },
      { id: 'safety_supplies', label: 'Safety Supplies' },
      { id: 'first_aid_kits', label: '1st Aid Kits' },
      { id: 'hazmat_suits', label: 'Hazmat Suits' },
      { id: 'eye_wash_stations', label: 'Eye Wash Stations' },
    ],
  },
]

export const SECTION_POINTS = 100 / AUDIT_SECTIONS.length
export const ITEM_COUNT = AUDIT_SECTIONS.reduce((n, s) => n + s.items.length, 0)

export const itemKey = (section: AuditSection, item: AuditItem) => `${section.id}.${item.id}`

// Every item on the form with a well-formed answer, whatever was stored (a draft
// saved mid-change, or one from an older form).
export function normalizeAnswers(raw: unknown): AuditAnswers {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out: AuditAnswers = {}
  for (const s of AUDIT_SECTIONS) {
    for (const it of s.items) {
      const k = itemKey(s, it)
      const a = (src[k] && typeof src[k] === 'object' ? src[k] : {}) as Partial<Record<keyof ItemAnswer, unknown>>
      out[k] = {
        value: a.value === 'pass' || a.value === 'warn' || a.value === 'fail' ? a.value : null,
        comments: typeof a.comments === 'string' ? a.comments : '',
        photos: Array.isArray(a.photos) ? a.photos.filter((p): p is string => typeof p === 'string') : [],
      }
    }
  }
  return out
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F'
export type SectionStatus = 'pass' | 'fail' | 'open'
export type SectionResult = {
  section: AuditSection
  status: SectionStatus
  rated: number
  warns: number
  fails: number
  points: number
}
export type AuditResult = {
  sections: SectionResult[]
  rated: number
  total: number
  complete: boolean
  points: number
  sectionsPassed: number
  safetyFailed: boolean
  failedSections: string[]
  // F as soon as a Safety item is red; otherwise set once every item is rated.
  grade: Grade | null
}

// A school scale: with eight equal sections, every failed section costs a letter
// (none failed A, one B, two C, three D, four or more F).
export function gradeFor(points: number): Grade {
  if (points >= 90) return 'A'
  if (points >= 80) return 'B'
  if (points >= 70) return 'C'
  if (points >= 60) return 'D'
  return 'F'
}

export function gradeAudit(answers: AuditAnswers): AuditResult {
  const sections: SectionResult[] = AUDIT_SECTIONS.map((section) => {
    let rated = 0
    let warns = 0
    let fails = 0
    for (const it of section.items) {
      const v = answers[itemKey(section, it)]?.value
      if (!v) continue
      rated++
      if (v === 'warn') warns++
      if (v === 'fail') fails++
    }
    const status: SectionStatus = fails > 0 ? 'fail' : rated === section.items.length ? 'pass' : 'open'
    return { section, status, rated, warns, fails, points: status === 'pass' ? SECTION_POINTS : 0 }
  })
  const rated = sections.reduce((n, s) => n + s.rated, 0)
  const complete = rated === ITEM_COUNT
  const points = sections.reduce((n, s) => n + s.points, 0)
  const safetyFailed = sections.some((s) => s.section.failsAudit && s.status === 'fail')
  return {
    sections,
    rated,
    total: ITEM_COUNT,
    complete,
    points,
    sectionsPassed: sections.filter((s) => s.status === 'pass').length,
    safetyFailed,
    failedSections: sections.filter((s) => s.status === 'fail').map((s) => s.section.title),
    grade: safetyFailed ? 'F' : complete ? gradeFor(points) : null,
  }
}

export type Tone = 'ok' | 'warn' | 'danger'

// Green for A and B, yellow for C, red for D, F and any Safety fail.
export function gradeTone(grade: string | null | undefined, safetyFailed?: boolean | null): Tone {
  if (safetyFailed) return 'danger'
  if (grade === 'A' || grade === 'B') return 'ok'
  if (grade === 'C') return 'warn'
  return 'danger'
}

export const RATING_LABEL: Record<Rating, string> = { pass: 'Pass', warn: 'Needs attention', fail: 'Fail' }

export const fmtPoints = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
