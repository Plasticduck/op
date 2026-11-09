import { useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { levelStatus, type OutlineLevel, type Progress, type PublicQuestion } from '@/lib/queries/academy'
import { levelPath, lessonPath, stepPath } from './context'

// What a level's screens share: the level and its questions (without answers).
export type LevelCtx = { level: OutlineLevel; questions: PublicQuestion[] | null; reloadQuestions: () => void }
export const useLevel = () => useOutletContext<LevelCtx>()

// Where "Continue" goes: the first open lesson, then scenarios, assessment, sign-off.
export function nextStep(level: OutlineLevel, p: Progress | null): string {
  const open = level.lessons.find((l) => !p?.lessons.get(l.id)?.done_at)
  if (open) return lessonPath(level.key, open.key)
  const s = levelStatus(level, p)
  if (level.scenarioCount > 0 && !s.scenarios) return stepPath(level.key, 'scenarios')
  if (level.assessmentCount > 0 && !s.passed) return stepPath(level.key, 'assessment')
  if (s.skillsTotal > 0 && s.skillsDone < s.skillsTotal) return stepPath(level.key, 'skills')
  if (!s.signed) return stepPath(level.key, 'signoff')
  return levelPath(level.key)
}

// The sites the signed-in person works at (an Admin has them all).
export function useMySites() {
  const { locations } = useLocations()
  const { profile } = useAuth()
  return useMemo(() => {
    if (profile?.role === 'owner') return locations
    const mine = new Set(profile?.location_ids ?? [])
    return locations.filter((l) => mine.has(l.id))
  }, [locations, profile?.role, profile?.location_ids])
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return ''
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export const randomKey = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 8)}`
