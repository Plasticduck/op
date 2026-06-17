import { format } from 'date-fns'
import type { Database } from '@/lib/database.types'

type Injury = Database['public']['Tables']['injury_reports']['Row'] & {
  employee?: { first_name: string | null; last_name: string | null } | null
  location?: { name: string | null } | null
}

const CLASSIFICATION_LABEL: Record<string, string> = {
  death: 'Death',
  days_away: 'Days away from work',
  job_transfer: 'Job transfer or restriction',
  other_recordable: 'Other recordable case',
}

const ILLNESS_LABEL: Record<string, string> = {
  injury: 'Injury',
  skin: 'Skin disorder',
  respiratory: 'Respiratory condition',
  poisoning: 'Poisoning',
  hearing: 'Hearing loss',
  other_illness: 'All other illnesses',
}

function escapeCell(value: unknown): string {
  if (value == null) return ''
  const s = String(value)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((row) => row.map(escapeCell).join(',')).join('\r\n')
}

function employeeName(injury: Injury): string {
  const first = injury.employee?.first_name ?? ''
  const last = injury.employee?.last_name ?? ''
  return `${first} ${last}`.trim()
}

function formatIncidentDate(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return format(parsed, 'MM/dd/yyyy')
}

function joinNonEmpty(parts: (string | null | undefined)[], sep: string): string {
  return parts.filter((p) => p != null && String(p).trim() !== '').join(sep)
}

function download(filename: string, csv: string): void {
  // Excel respects a UTF-8 BOM and renders accented characters correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function exportOsha300(
  injuries: Injury[],
  options?: { year?: number; establishmentName?: string; establishmentCity?: string; establishmentState?: string },
): void {
  const year = options?.year ?? new Date().getFullYear()
  const establishment = joinNonEmpty(
    [options?.establishmentName ?? '', options?.establishmentCity ?? '', options?.establishmentState ?? ''],
    ', ',
  )

  const headerRows: (string | number | null | undefined)[][] = [
    ['OSHA Form 300 - Log of Work-Related Injuries and Illnesses'],
    [`Establishment: ${establishment}`],
    [`Year: ${year}`],
    [],
    [
      'Case No.',
      'Employee Name',
      'Job Title',
      'Date of Injury or Onset of Illness',
      'Where the event occurred',
      'Describe injury or illness, parts of body affected',
      'Classification',
      'Days Away From Work',
      'Days On Job Transfer or Restriction',
      'Injury or Illness Type',
    ],
  ]

  const dataRows = injuries.map((i) => {
    const description = joinNonEmpty([i.description, i.body_part_affected], ', ')
    const classification = i.classification ? (CLASSIFICATION_LABEL[i.classification] ?? '') : ''
    const illnessType = i.illness_type ? (ILLNESS_LABEL[i.illness_type] ?? '') : ''
    return [
      i.case_number ?? '',
      employeeName(i),
      i.job_title_snapshot ?? '',
      formatIncidentDate(i.incident_date),
      i.area_description ?? '',
      description,
      classification,
      i.days_lost ?? '',
      i.days_restricted ?? '',
      illnessType,
    ]
  })

  const csv = toCsv([...headerRows, ...dataRows])
  download(`OSHA-300-${year}.csv`, csv)
}

export function exportOsha301Summary(
  injuries: Injury[],
  options?: { year?: number; establishmentName?: string },
): void {
  const year = options?.year ?? new Date().getFullYear()
  const establishment = options?.establishmentName ?? ''

  const headerRows: (string | number | null | undefined)[][] = [
    ['OSHA Form 301 - Injury and Illness Incident Report (Detail)'],
    [`Establishment: ${establishment}`],
    [`Year: ${year}`],
    [],
    [
      'Report ID',
      'Incident Date',
      'Incident Time',
      'Employee Name',
      'Location',
      'Area',
      'Description',
      'Cause',
      'Body Part Affected',
      'Severity',
      'Treatment Given',
      'Days Away From Work',
      'Days On Restriction',
      'Medical Treatment Required',
      'Doctor Visit',
      'OSHA Recordable',
      'Illness Type',
      'Classification',
      'Witnesses',
      'Reported By',
      'Created At',
    ],
  ]

  const dataRows = injuries.map((i) => [
    i.id,
    formatIncidentDate(i.incident_date),
    i.incident_time ?? '',
    employeeName(i),
    i.location?.name ?? '',
    i.area_description ?? '',
    i.description ?? '',
    i.cause ?? '',
    i.body_part_affected ?? '',
    i.severity ?? '',
    i.treatment_given ?? '',
    i.days_lost ?? '',
    i.days_restricted ?? '',
    i.medical_treatment_required ? 'Yes' : 'No',
    i.doctor_visit ? 'Yes' : 'No',
    i.osha_recordable ? 'Yes' : 'No',
    i.illness_type ? (ILLNESS_LABEL[i.illness_type] ?? i.illness_type) : '',
    i.classification ? (CLASSIFICATION_LABEL[i.classification] ?? i.classification) : '',
    i.witness_names ?? '',
    i.reported_by_name ?? '',
    i.created_at ? format(new Date(i.created_at), 'MM/dd/yyyy HH:mm') : '',
  ])

  const csv = toCsv([...headerRows, ...dataRows])
  download(`OSHA-301-detail-${year}.csv`, csv)
}
