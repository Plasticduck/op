import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { cn, compareLocationName } from '@/lib/utils'
import { dateTime } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { siteAuditsV2, type SiteAuditV2 } from '@/lib/queries/siteAuditsV2'
import { ItemPhotos, StatusButtons } from '../SiteAuditForm'
import {
  AUDIT_SECTIONS,
  fmtPoints,
  gradeAudit,
  gradeTone,
  itemKey,
  normalizeAnswers,
  type AuditAnswers,
  type ItemAnswer,
  type Rating,
} from './form'
import { ResultBox, SectionChip } from './parts'

const LIST = '/app/site-audits-new'

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'gone'

// Taking an audit. The row is already a draft; every change saves to it (photos
// at once, typing after a pause), so leaving, a reload or a dropped connection
// loses nothing. Submitting grades it and locks it.
export function AuditEditor({ audit, onSubmitted }: { audit: SiteAuditV2; onSubmitted: () => void }) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { locations } = useLocations()
  const sortedLocations = useMemo(() => [...locations].sort((a, b) => compareLocationName(a.name, b.name)), [locations])

  const [answers, setAnswers] = useState<AuditAnswers>(() => normalizeAnswers(audit.answers))
  const [locationId, setLocationId] = useState(audit.location_id)
  const result = useMemo(() => gradeAudit(answers), [answers])

  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [showMissing, setShowMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  // Autosave. One save at a time, always of the latest answers.
  const latest = useRef({ answers, locationId })
  const dirty = useRef(false)
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  // Set once submitting starts (or the draft is discarded), so a late save can't follow it.
  const closed = useRef(false)
  const saveNow = useRef(false)
  const mounted = useRef(false)

  const persist = useCallback((): Promise<boolean> => {
    const run = async () => {
      if (closed.current || !dirty.current) return true
      dirty.current = false
      setSaveState('saving')
      const { answers: a, locationId: loc } = latest.current
      const { data, error: err } = await siteAuditsV2.saveDraft(audit.id, { answers: a as never, location_id: loc })
      if (err) {
        dirty.current = true
        setSaveState('error')
        return false
      }
      if (!data) {
        setSaveState('gone')
        return false
      }
      setSaveState('saved')
      return true
    }
    const p = chain.current.then(run, run)
    chain.current = p
    return p
  }, [audit.id])

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    latest.current = { answers, locationId }
    dirty.current = true
    if (saveNow.current) {
      saveNow.current = false
      void persist()
      return
    }
    const t = setTimeout(() => { void persist() }, 1000)
    return () => clearTimeout(t)
  }, [answers, locationId, persist])

  // Save before the page goes away: the phone's camera opening, switching apps,
  // closing the tab, or leaving the page in the app.
  useEffect(() => {
    const flush = () => { if (document.visibilityState === 'hidden') void persist() }
    const leave = () => { void persist() }
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('pagehide', leave)
    return () => {
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('pagehide', leave)
      void persist()
    }
  }, [persist])

  const setItem = (key: string, patch: Partial<ItemAnswer>, now = false) => {
    if (now) saveNow.current = true
    setAnswers((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  const hasContent = Object.values(answers).some((a) => a.value || a.comments.trim() || a.photos.length)

  const leave = async () => {
    // An audit with nothing in it isn't worth keeping in the In progress list.
    if (!hasContent) {
      closed.current = true
      await chain.current.catch(() => undefined)
      await siteAuditsV2.remove(audit.id)
    }
    navigate(LIST)
  }

  const discard = async () => {
    if (!window.confirm('Discard this audit? Its answers and photos will be deleted.')) return
    closed.current = true
    await chain.current.catch(() => undefined)
    const { error: err } = await siteAuditsV2.remove(audit.id)
    if (err) {
      closed.current = false
      setError('Could not discard the audit: ' + err.message)
      return
    }
    void siteAuditsV2.removePhotos(Object.values(answers).flatMap((a) => a.photos))
    navigate(LIST)
  }

  const trySubmit = () => {
    setError(null)
    if (!result.complete) {
      setShowMissing(true)
      const left = result.total - result.rated
      setError(`${left} item${left === 1 ? '' : 's'} still need${left === 1 ? 's' : ''} a rating. They're marked in red.`)
      const first = AUDIT_SECTIONS.flatMap((s) => s.items.map((it) => itemKey(s, it))).find((k) => !answers[k]?.value)
      if (first) document.getElementById('item-' + first)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setConfirming(true)
  }

  const submit = async () => {
    setBusy(true)
    closed.current = true
    await chain.current.catch(() => undefined)
    const r = gradeAudit(answers)
    const { data, error: err } = await siteAuditsV2.submit(audit.id, {
      answers: answers as never,
      location_id: locationId,
      score: r.points,
      grade: r.grade,
      safety_failed: r.safetyFailed,
      failed_sections: r.failedSections,
      auditor_name: profile?.name ?? audit.auditor_name,
    })
    if (err || !data) {
      closed.current = false
      setBusy(false)
      setConfirming(false)
      setError(err ? 'Could not submit the audit: ' + err.message : 'This audit was already submitted or deleted. Reload to see it.')
      return
    }
    // Best effort: the audit is saved either way, but say so if nothing went out.
    void siteAuditsV2.notify(audit.id).then(({ error: sendErr }) => {
      if (sendErr) window.alert('The audit was submitted, but the email and text did not go out.')
    })
    onSubmitted()
  }

  const siteName = locations.find((l) => l.id === locationId)?.name ?? audit.location?.name ?? 'Site'
  const tone = result.grade ? gradeTone(result.grade, result.safetyFailed) : null

  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={() => void leave()} className="inline-flex w-fit items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Site Audit NEW
      </button>

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border border-border bg-card p-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Site audit: {siteName}</h1>
          <p className="mt-0.5 text-sm text-ink-muted">Started {dateTime(audit.created_at)} · {audit.auditor_name ?? profile?.name}</p>
        </div>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
          Site
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="h-9 w-56" aria-label="Site">
            {!sortedLocations.some((l) => l.id === locationId) && <option value={locationId}>{siteName}</option>}
            {sortedLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </label>
      </div>

      {/* Stays at the top while scrolling: the result so far and how much is left. */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-border bg-content/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex items-center justify-between gap-3 text-sm">
          <p className="min-w-0 truncate font-semibold text-ink">
            {result.safetyFailed ? (
              <span className="inline-flex items-center gap-1 text-danger"><ShieldAlert className="size-4" /> FAILED on Safety</span>
            ) : result.grade ? (
              <span className={tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-danger'}>Grade {result.grade} · {fmtPoints(result.points)} / 100</span>
            ) : (
              <>Score so far {fmtPoints(result.points)} / 100</>
            )}
          </p>
          <p className={cn('shrink-0 text-xs', saveState === 'error' || saveState === 'gone' ? 'text-danger' : 'text-ink-muted')}>
            {result.rated} of {result.total} rated
            <span className="hidden sm:inline">
              {' · '}
              {saveState === 'saving' ? 'Saving…'
                : saveState === 'saved' ? 'Saved'
                : saveState === 'error' ? 'Not saved, check your connection'
                : saveState === 'gone' ? 'Already submitted'
                : 'Saves as you go'}
            </span>
          </p>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(result.rated / result.total) * 100}%` }} />
        </div>
        {(saveState === 'error' || saveState === 'gone') && (
          <p className="mt-1 text-xs text-danger sm:hidden">
            {saveState === 'gone' ? 'This audit was already submitted.' : 'Not saved. Check your connection.'}
          </p>
        )}
      </div>

      {AUDIT_SECTIONS.map((section, si) => {
        const r = result.sections[si]
        return (
          <section key={section.id} className="rounded-md border border-border bg-card px-4 pb-1 pt-3">
            <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
              <h2 className="text-base font-semibold text-ink">
                <span className="mr-1.5 text-ink-subtle">{si + 1}.</span>
                {section.title}
              </h2>
              <SectionChip r={r} />
            </div>
            {section.failsAudit && (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-danger">
                <ShieldAlert className="size-3.5" /> A red item here fails the whole audit.
              </p>
            )}
            <div className="flex flex-col">
              {section.items.map((item) => {
                const key = itemKey(section, item)
                const a = answers[key]
                const missing = showMissing && !a.value
                return (
                  <div
                    key={key}
                    id={'item-' + key}
                    className={cn('-mx-4 scroll-mt-24 border-b border-border px-4 py-3 last:border-b-0', missing && 'bg-danger-soft/60')}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 pt-2.5">
                        <p className="font-semibold text-ink">{item.label}</p>
                        {missing && <p className="text-xs font-medium text-danger">Rate this item</p>}
                      </div>
                      <StatusButtons tinted value={a.value} onChange={(v) => setItem(key, { value: v as Rating | null })} />
                    </div>
                    <div className="mt-2 flex items-start gap-2">
                      <Comments
                        value={a.comments}
                        label={`Comments on ${item.label}`}
                        onChange={(v) => setItem(key, { comments: v })}
                      />
                      <div className="max-w-[45%] shrink-0">
                        <ItemPhotos
                          accountId={audit.account_id}
                          draftId={audit.id}
                          itemId={key.replace('.', '-')}
                          photos={a.photos}
                          onChange={(next) => setItem(key, { photos: next }, true)}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={() => void discard()} className="text-danger">Discard audit</Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void leave()}>Finish later</Button>
          <Button onClick={trySubmit}>Submit audit</Button>
        </div>
      </div>

      {confirming && (
        <Modal open onClose={() => { if (!busy) setConfirming(false) }} title="Submit this audit?" size="sm">
          <div className="flex flex-col gap-4">
            <ResultBox result={result} />
            <p className="text-sm text-ink-muted">Once it's submitted, the audit can't be changed.</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>Keep editing</Button>
              <Button disabled={busy} onClick={() => void submit()}>{busy ? 'Submitting…' : 'Submit audit'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// A comments box that grows with what's typed.
function Comments({ value, label, onChange }: { value: string; label: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.max(64, el.scrollHeight + 2) + 'px'
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Comments"
      aria-label={label}
      rows={2}
      className="min-h-16 min-w-0 flex-1 resize-none rounded-md border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent"
    />
  )
}
