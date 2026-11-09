import { createContext, useContext } from 'react'
import type { Learner, Me, Outline, OutlineLevel, Progress } from '@/lib/queries/academy'

export const ACADEMY_BASE = '/app/training/academy'
// Pre-launch: who sees the content editor. The database lets any Admin edit; this
// list decides who gets the screens. Add an email here to open it up.
export const ACADEMY_EDITOR_EMAILS = ['kevan@washlyfe.com']

export type AcademyCtx = {
  outline: Outline | null
  loading: boolean
  error: string | null
  me: Me | null
  // The person whose progress the screens show and record: a team member a leader is
  // training on this device, otherwise the signed-in person (null for the office screen).
  learner: Learner | null
  trainee: Learner | null
  progress: Progress | null
  canEdit: boolean
  reloadOutline: () => Promise<void>
  reloadProgress: () => Promise<void>
  startTrainee: (employeeId: string) => Promise<void>
  stopTrainee: () => void
  setLearner: (l: Learner) => void
  level: (key: string | undefined) => OutlineLevel | undefined
  toast: (text: string) => void
}

export const AcademyContext = createContext<AcademyCtx | null>(null)

export function useAcademy(): AcademyCtx {
  const c = useContext(AcademyContext)
  if (!c) throw new Error('useAcademy outside AcademyProvider')
  return c
}

export const levelPath = (key: string) => `${ACADEMY_BASE}/${key}`
export const lessonPath = (levelKey: string, lessonKey: string) => `${ACADEMY_BASE}/${levelKey}/${lessonKey}`
export const stepPath = (levelKey: string, step: 'scenarios' | 'assessment' | 'skills' | 'signoff') => `${ACADEMY_BASE}/${levelKey}/${step}`
// A track's home: its tab on the Training page.
export const trackPath = (trackKey: string) => `/app/training?tab=${trackKey}`
export const EDIT_BASE = `${ACADEMY_BASE}/edit`
