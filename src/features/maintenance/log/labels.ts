import { format, parseISO } from 'date-fns'
import type { EntryResult, EntryType, ScheduleRow, ScheduleStatus, TaskType } from '@/lib/queries/maintenanceLog'
import type { Tone } from '../inventory/format'

export const ENTRY_TYPE: Record<EntryType | 'parts', string> = {
  preventive: 'Scheduled',
  repair: 'Repair',
  inspection: 'Inspection',
  cleaning: 'Cleaning',
  lubrication: 'Lubrication',
  replacement: 'Replacement',
  adjustment: 'Adjustment',
  note: 'Note',
  parts: 'Parts used',
}
export const ENTRY_TYPES: EntryType[] = ['repair', 'inspection', 'cleaning', 'lubrication', 'replacement', 'adjustment', 'preventive', 'note']

export const TASK_TYPE: Record<TaskType, string> = {
  inspect: 'Inspect',
  lubricate: 'Lubricate',
  clean: 'Clean',
  replace: 'Replace',
  adjust: 'Adjust',
  test: 'Test',
  other: 'Other',
}

export const RESULT: Record<EntryResult, { label: string; tone: Tone }> = {
  ok: { label: 'Done', tone: 'ok' },
  follow_up: { label: 'Needs follow-up', tone: 'warn' },
  failed: { label: 'Failed', tone: 'danger' },
  skipped: { label: 'Skipped', tone: 'neutral' },
}

export const STATUS: Record<ScheduleStatus, { label: string; tone: Tone }> = {
  overdue: { label: 'Overdue', tone: 'danger' },
  due: { label: 'Due', tone: 'warn' },
  soon: { label: 'Coming up', tone: 'accent' },
  ok: { label: 'On track', tone: 'ok' },
  paused: { label: 'Paused', tone: 'neutral' },
}

export const ASSET_STATUS: Record<string, string> = {
  online: 'Running',
  offline_planned: 'Down (planned)',
  offline_unplanned: 'Down (broken)',
  retired: 'Retired',
}

const n0 = (n: number | null | undefined) => (n == null ? '-' : Math.round(Number(n)).toLocaleString('en-US'))
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
const shortDay = (iso: string) => format(parseISO(iso), 'MMM d')

export function everyText(s: Pick<ScheduleRow, 'every_n' | 'every_unit' | 'every_cars'>): string {
  const time = s.every_n && s.every_unit ? `every ${s.every_n === 1 ? s.every_unit.replace(/s$/, '') : plural(s.every_n, s.every_unit.replace(/s$/, ''))}` : null
  const cars = s.every_cars ? `every ${n0(s.every_cars)} cars` : null
  const both = time && cars ? `${time} or ${cars.replace('every ', '')}, whichever comes first` : time ?? cars ?? ''
  return both.charAt(0).toUpperCase() + both.slice(1)
}

// What a person needs to know about when it's due, in a few words.
export function dueText(s: ScheduleRow): string {
  if (s.status === 'paused') return 'Paused'
  const carsBit = s.every_cars ? `${n0(s.cars_since)} of ${n0(s.every_cars)} cars` : null
  const d = s.days_left
  let when: string | null = null
  if (s.due_on && d != null) {
    if (d < 0) when = `${plural(-d, 'day')} late`
    else if (d === 0) when = 'Due today'
    else if (d === 1) when = 'Due tomorrow'
    else when = `Due ${shortDay(s.due_on)}${d <= 14 ? `, in ${d} days` : ''}`
    // A car-based date is an estimate from the site's recent volume.
    if (s.every_cars && s.cars_due_on && s.due_on === s.cars_due_on && (!s.next_due_date || s.cars_due_on < s.next_due_date) && d > 0) when = `About ${shortDay(s.due_on)} at current volume`
  }
  if (!when && s.every_cars && !s.daily_cars) when = 'No car counts for this site yet'
  return [when, carsBit].filter(Boolean).join(' · ')
}

export function minutesText(m: number | null | undefined): string {
  if (m == null) return '-'
  const h = Math.floor(m / 60)
  const r = m % 60
  if (!h) return `${r} min`
  return r ? `${h} hr ${r} min` : `${h} hr`
}

export function localInputValue(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function isoDay(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function addDays(iso: string, days: number): string {
  const d = parseISO(iso)
  d.setDate(d.getDate() + days)
  return isoDay(d)
}

export function addInterval(iso: string, n: number, unit: 'days' | 'weeks' | 'months'): string {
  const d = parseISO(iso)
  if (unit === 'days') d.setDate(d.getDate() + n)
  else if (unit === 'weeks') d.setDate(d.getDate() + 7 * n)
  else d.setMonth(d.getMonth() + n)
  return isoDay(d)
}
