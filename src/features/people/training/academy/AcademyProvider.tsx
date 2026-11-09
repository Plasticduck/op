import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '@/lib/auth'
import { academy, type Learner, type Me, type Outline, type Progress } from '@/lib/queries/academy'
import { ACADEMY_EDITOR_EMAILS, AcademyContext, type AcademyCtx } from './context'
import './academy.css'

const TRAINEE_KEY = 'academy.trainee'
// Where the old hosted Academy page kept progress in this browser.
const OLD_KEY = 'mw-academy-v2'
const OLD_KEY_V1 = 'mw-gm-academy-v1'

function readSession(key: string): string | null {
  try { return sessionStorage.getItem(key) } catch { return null }
}
function writeSession(key: string, v: string | null) {
  try { if (v) sessionStorage.setItem(key, v); else sessionStorage.removeItem(key) } catch { /* private mode */ }
}

export function AcademyProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [outline, setOutline] = useState<Outline | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [trainee, setTrainee] = useState<Learner | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [toastText, setToastText] = useState<string | null>(null)
  const toastTimer = useRef(0)

  const toast = useCallback((text: string) => {
    setToastText(text)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastText(null), 2800)
  }, [])

  const reloadOutline = useCallback(async () => {
    try {
      const o = await academy.outline()
      setOutline(o)
      setError(null)
      return o
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    }
  }, [])

  // First load: the program, then (only if this account has one) who I am and any
  // team member I was training on this device.
  useEffect(() => {
    let live = true
    void (async () => {
      const o = await reloadOutline()
      if (!live) return
      if (o && o.allLevels.length > 0) {
        try {
          const m = await academy.me()
          if (!live) return
          setMe(m)
          const tid = readSession(TRAINEE_KEY)
          if (tid && m.leader) {
            const t = await academy.learner(tid).catch(() => null)
            if (live && t?.employee_id) setTrainee(t)
            else writeSession(TRAINEE_KEY, null)
          }
        } catch (e) {
          if (live) setError(e instanceof Error ? e.message : String(e))
        }
      }
      if (live) setLoading(false)
    })()
    return () => { live = false }
  }, [reloadOutline])

  const learner = trainee ?? me?.learner ?? null
  const learnerId = learner?.id ?? null

  const reloadProgress = useCallback(async () => {
    if (!learnerId) { setProgress(null); return }
    try {
      setProgress(await academy.progress(learnerId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [learnerId])
  useEffect(() => {
    setProgress(null)
    void reloadProgress()
  }, [reloadProgress])

  // Bring over progress from the old hosted page, once per person per browser.
  const myLearnerId = me?.learner?.id ?? null
  useEffect(() => {
    if (!myLearnerId) return
    const flag = `academy.imported.${myLearnerId}`
    let raw: string | null
    try {
      if (localStorage.getItem(flag)) return
      raw = localStorage.getItem(OLD_KEY) ?? localStorage.getItem(OLD_KEY_V1)
    } catch { return }
    if (!raw) return
    let state: unknown = null
    try { state = JSON.parse(raw) } catch { /* unreadable: nothing to bring over */ }
    if (!state || typeof state !== 'object') return
    // The v1 page only had the GM level.
    const s = state as Record<string, unknown>
    if (!('assess' in s) && !('role' in s)) {
      state = {
        lessons: s.lessons ?? {},
        selfcheck: s.selfcheck,
        scenarios: s.scenarios ? { l6: s.scenarios } : {},
        assess: s.final ? { l6: s.final } : {},
        ack: s.ack ? { l6: s.ack } : {},
      }
    }
    void academy.importLocal(state).then((r) => {
      try { localStorage.setItem(flag, new Date().toISOString()) } catch { /* ignore */ }
      if (r.imported > 0) {
        toast(`Brought over ${r.imported} item${r.imported === 1 ? '' : 's'} of progress from the old Academy page`)
        if (!trainee) void reloadProgress()
      }
    }).catch(() => { /* try again next visit */ })
  }, [myLearnerId, reloadProgress, toast, trainee])

  const startTrainee = useCallback(async (employeeId: string) => {
    const t = await academy.trainee(employeeId)
    writeSession(TRAINEE_KEY, t.id)
    setTrainee(t)
  }, [])
  const stopTrainee = useCallback(() => {
    writeSession(TRAINEE_KEY, null)
    setTrainee(null)
  }, [])
  const setLearner = useCallback((l: Learner) => {
    if (trainee && l.id === trainee.id) setTrainee(l)
    else setMe((m) => (m && m.learner?.id === l.id ? { ...m, learner: l } : m))
  }, [trainee])

  const email = profile?.email?.toLowerCase() ?? ''
  const canEdit = !!me?.editor && ACADEMY_EDITOR_EMAILS.includes(email)
  const ctx = useMemo<AcademyCtx>(() => ({
    outline, loading, error, me, learner, trainee, progress, canEdit,
    reloadOutline: async () => { await reloadOutline() },
    reloadProgress, startTrainee, stopTrainee, setLearner, toast,
    level: (key) => outline?.allLevels.find((l) => l.key === key),
  }), [outline, loading, error, me, learner, trainee, progress, canEdit, reloadOutline, reloadProgress, startTrainee, stopTrainee, setLearner, toast])

  return (
    <AcademyContext.Provider value={ctx}>
      {children}
      {toastText && (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 rounded-full bg-shell px-4 py-2 text-sm text-ink-invert shadow-lg md:bottom-8"
        >
          {toastText}
        </div>
      )}
    </AcademyContext.Provider>
  )
}
