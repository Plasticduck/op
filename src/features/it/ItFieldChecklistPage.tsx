import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, ClipboardCheck, Download, Loader2, MessageSquare, Play, Send, Trash2, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { cn } from '@/lib/utils'
import {
  IT_MEDIA_MAX_BYTES,
  itemsOf,
  itFieldChecklists,
  type ItChecklistItem,
  type ItFieldChecklistRow,
} from '@/lib/queries/itFieldChecklists'
import { downloadItFieldChecklistPdf } from '@/lib/reports/itFieldChecklistPdf'

// IT Field Checklist: an IT field tech works through the checks at a site,
// checking items off, attaching photos or videos and commenting where needed.
// A checklist saves as they go (a draft they can come back to) and becomes a
// read-only record once submitted. /app/it-field-checklist lists them;
// /app/it-field-checklist/:id is one checklist.

const fmtDay = (iso: string) => format(new Date(iso), 'MMM d, yyyy')
const fmtStamp = (iso: string) => format(new Date(iso), 'MMM d, yyyy h:mm a')

function tally(items: ItChecklistItem[]) {
  return {
    checked: items.filter((i) => i.checked).length,
    issues: items.filter((i) => i.issue).length,
    total: items.length,
    comments: items.filter((i) => i.comment.trim()).length,
    media: items.reduce((a, i) => a + i.media.length, 0),
  }
}

export default function ItFieldChecklistPage() {
  const { id } = useParams()
  return id ? <ChecklistView id={id} /> : <ChecklistList />
}

// ---- List: start a checklist, continue drafts, open submitted ones ---------

function ChecklistList() {
  const { profile } = useAuth()
  const { locations, activeLocation } = useLocations()
  const navigate = useNavigate()
  const [rows, setRows] = useState<ItFieldChecklistRow[]>([])
  const [loading, setLoading] = useState(true)
  const [siteId, setSiteId] = useState(activeLocation?.id ?? '')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await itFieldChecklists.list()
    setRows((data as unknown as ItFieldChecklistRow[]) ?? [])
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (activeLocation?.id) setSiteId((v) => v || activeLocation.id) }, [activeLocation?.id])

  const start = async () => {
    if (!profile) return
    if (!siteId) { setError('Choose the site first.'); return }
    setStarting(true)
    setError(null)
    const { data, error: err } = await itFieldChecklists.start({
      account_id: profile.account_id,
      location_id: siteId,
      tech_id: profile.id,
      tech_name: profile.name || null,
    })
    setStarting(false)
    if (err || !data) { setError(err?.message ?? 'Could not start the checklist.'); return }
    navigate(`/app/it-field-checklist/${data.id}`)
  }

  const remove = async (r: ItFieldChecklistRow) => {
    if (!window.confirm(`Delete the ${r.location?.name ?? ''} checklist you started? This can't be undone.`)) return
    for (const it of itemsOf(r)) for (const m of it.media) void itFieldChecklists.removeMedia(m.path)
    await itFieldChecklists.remove(r.id)
    void load()
  }

  const drafts = rows.filter((r) => r.status === 'draft')
  const submitted = rows.filter((r) => r.status === 'submitted')

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="IT Field Checklist"
        subtitle="Work through the IT checks at a site. Check items off, add photos or videos, and leave comments where needed."
      />

      <section className="mt-5 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><ClipboardCheck className="size-4 text-accent" /> Start a checklist</h2>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="sm:max-w-xs">
            <option value="">Select a site…</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
          <Button onClick={() => void start()} disabled={starting}>
            {starting ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />} Start checklist
          </Button>
        </div>
        {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      </section>

      {drafts.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink">In progress</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {drafts.map((r) => {
              const t = tally(itemsOf(r))
              const mine = r.tech_id === profile?.id
              return (
                <div key={r.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-ink">{r.location?.name ?? 'Site'}</div>
                      <div className="text-xs text-ink-muted">Started {fmtStamp(r.created_at)}{mine ? '' : ` by ${r.tech_name ?? 'a tech'}`}</div>
                    </div>
                    {mine && (
                      <button type="button" onClick={() => void remove(r)} aria-label="Delete checklist"
                        className="grid size-8 shrink-0 place-items-center rounded-md border border-border text-danger hover:bg-danger-soft">
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                  <Progress checked={t.checked} issues={t.issues} total={t.total} className="mt-3" />
                  <div className="mt-3">
                    <Link to={`/app/it-field-checklist/${r.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-content px-3 py-1.5 text-sm font-medium text-ink hover:border-accent">
                      {mine ? 'Continue' : 'View'}
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink">Submitted</h2>
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          {loading ? (
            <p className="px-4 py-8 text-center text-sm text-ink-muted">Loading checklists…</p>
          ) : submitted.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-muted">No submitted checklists yet.</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border bg-content text-left text-[11px] uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th className="px-3 py-2 font-medium">Submitted</th>
                  <th className="px-3 py-2 font-medium">Site</th>
                  <th className="px-3 py-2 font-medium">Tech</th>
                  <th className="px-3 py-2 text-right font-medium">Checked</th>
                  <th className="px-3 py-2 text-right font-medium">Issues</th>
                  <th className="px-3 py-2 text-right font-medium">Comments</th>
                  <th className="px-3 py-2 text-right font-medium">Photos / videos</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {submitted.map((r) => {
                  const t = tally(itemsOf(r))
                  return (
                    <tr key={r.id} onClick={() => navigate(`/app/it-field-checklist/${r.id}`)} className="cursor-pointer hover:bg-content">
                      <td className="whitespace-nowrap px-3 py-2.5 text-ink-muted">{fmtDay(r.submitted_at ?? r.created_at)}</td>
                      <td className="px-3 py-2.5 font-medium text-ink">{r.location?.name ?? '–'}</td>
                      <td className="px-3 py-2.5 text-ink-muted">{r.tech_name ?? '–'}</td>
                      <td className={cn('px-3 py-2.5 text-right tabular-nums', t.checked + t.issues < t.total ? 'font-semibold text-warn' : 'text-ink-muted')}>
                        {t.checked} / {t.total}
                      </td>
                      <td className={cn('px-3 py-2.5 text-right tabular-nums', t.issues ? 'font-semibold text-danger' : 'text-ink-muted')}>
                        {t.issues || '–'}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{t.comments || '–'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{t.media || '–'}</td>
                      <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                        <PdfButton row={r} label="PDF" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  )
}

// Done = checked or marked an issue. Issues show as the red part of the bar.
function Progress({ checked, issues, total, className }: { checked: number; issues: number; total: number; className?: string }) {
  const done = checked + issues
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between text-xs text-ink-muted">
        <span>
          {done} of {total} done
          {issues > 0 && <span className="font-semibold text-danger"> · {issues} issue{issues === 1 ? '' : 's'}</span>}
        </span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-content">
        <div className={cn('h-full transition-all', pct === 100 && !issues ? 'bg-ok' : 'bg-accent')} style={{ width: `${total ? (checked / total) * 100 : 0}%` }} />
        <div className="h-full bg-danger transition-all" style={{ width: `${total ? (issues / total) * 100 : 0}%` }} />
      </div>
    </div>
  )
}

// ---- One checklist ----------------------------------------------------------

function ChecklistView({ id }: { id: string }) {
  const { profile } = useAuth()
  const [row, setRow] = useState<ItFieldChecklistRow | null>(null)
  const [missing, setMissing] = useState(false)
  const [items, setItems] = useState<ItChecklistItem[]>([])
  const [notes, setNotes] = useState('')
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [openComments, setOpenComments] = useState<Set<string>>(() => new Set())
  const [uploading, setUploading] = useState<Set<string>>(() => new Set())
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const dirty = useRef(false)

  const load = useCallback(async () => {
    const { data } = await itFieldChecklists.get(id)
    const r = data as unknown as ItFieldChecklistRow | null
    if (!r) { setMissing(true); return }
    const its = itemsOf(r)
    setRow(r)
    setItems(its)
    setNotes(r.notes ?? '')
    dirty.current = false
    setUrls(await itFieldChecklists.mediaUrls(its.flatMap((i) => i.media.map((m) => m.path))))
  }, [id])
  useEffect(() => { void load() }, [load])

  const canEdit = !!row && row.status === 'draft' && row.tech_id === profile?.id

  // Save as they go: a short pause after the last change. A change still waiting
  // when they leave the page is saved on the way out.
  const pending = useRef<{ items: ItChecklistItem[]; notes: string } | null>(null)
  useEffect(() => {
    if (!canEdit || !dirty.current) return
    pending.current = { items, notes }
    setSaveState('saving')
    const t = setTimeout(async () => {
      pending.current = null
      const { error: err } = await itFieldChecklists.save(id, items, notes)
      setSaveState(err ? 'error' : 'saved')
    }, 700)
    return () => clearTimeout(t)
  }, [items, notes, canEdit, id])
  useEffect(() => () => {
    if (pending.current) void itFieldChecklists.save(id, pending.current.items, pending.current.notes)
  }, [id])

  const update = (key: string, patch: Partial<ItChecklistItem>) => {
    dirty.current = true
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)))
  }

  const addMedia = async (key: string, files: FileList | null) => {
    if (!files?.length || !profile || !row) return
    setError(null)
    const picked = Array.from(files).filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'))
    const tooBig = picked.filter((f) => f.size > IT_MEDIA_MAX_BYTES)
    if (tooBig.length) {
      setError(`${tooBig.map((f) => f.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} over 50 MB. Record a shorter clip (about a minute or less) or trim it, then try again.`)
    }
    const ok = picked.filter((f) => f.size <= IT_MEDIA_MAX_BYTES)
    if (!ok.length) return
    setUploading((prev) => new Set(prev).add(key))
    for (const f of ok) {
      const { media, error: err } = await itFieldChecklists.uploadMedia(profile.account_id, row.id, f)
      if (!media) { setError(`Couldn't upload ${f.name}: ${err ?? 'unknown error'}`); continue }
      const signed = await itFieldChecklists.mediaUrls([media.path])
      setUrls((prev) => ({ ...prev, ...signed }))
      dirty.current = true
      setItems((prev) => prev.map((i) => (i.key === key ? { ...i, media: [...i.media, media] } : i)))
    }
    setUploading((prev) => { const n = new Set(prev); n.delete(key); return n })
  }

  const removeMedia = async (key: string, path: string) => {
    if (!window.confirm('Remove this photo or video?')) return
    void itFieldChecklists.removeMedia(path)
    dirty.current = true
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, media: i.media.filter((m) => m.path !== path) } : i)))
  }

  // Marking an issue clears the check (and checking clears the issue); an issue
  // opens its comment box, since it needs a comment before submitting.
  const toggleIssue = (i: ItChecklistItem) => {
    update(i.key, i.issue ? { issue: false } : { issue: true, checked: false })
    if (!i.issue) setOpenComments((prev) => new Set(prev).add(i.key))
  }

  const submit = async () => {
    const needComment = items.filter((i) => i.issue && !i.comment.trim())
    if (needComment.length) {
      setError(`Add a comment for every item marked Issue (${needComment.length} still need${needComment.length === 1 ? 's' : ''} one).`)
      return
    }
    setError(null)
    const left = items.filter((i) => !i.checked && !i.issue).length
    const msg = left
      ? `${left} item${left === 1 ? ' is' : 's are'} not checked or marked as an issue. Submit anyway?`
      : 'Submit this checklist? It can’t be edited after.'
    if (!window.confirm(msg)) return
    setSubmitting(true)
    pending.current = null
    const { error: err } = await itFieldChecklists.submit(id, items, notes)
    setSubmitting(false)
    if (err) { setError(err.message); return }
    void load()
  }

  const sections = useMemo(() => {
    const out: { title: string; items: ItChecklistItem[] }[] = []
    for (const i of items) {
      const s = out.find((x) => x.title === i.section)
      if (s) s.items.push(i)
      else out.push({ title: i.section, items: [i] })
    }
    return out
  }, [items])

  if (missing) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <BackLink />
        <p className="mt-6 text-sm text-ink-muted">This checklist doesn’t exist or you don’t have access to it.</p>
      </div>
    )
  }
  if (!row) return <div className="grid place-items-center py-16 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>

  const t = tally(items)
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <BackLink />
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">{row.location?.name ?? 'Site'}</h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            IT Field Checklist · {row.tech_name ?? 'Tech'} · {row.status === 'submitted' && row.submitted_at
              ? `Submitted ${fmtStamp(row.submitted_at)}`
              : `Started ${fmtStamp(row.created_at)}`}
          </p>
        </div>
        {row.status === 'submitted' ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2.5 py-1 text-xs font-semibold text-ok"><CheckCircle2 className="size-3.5" /> Submitted</span>
            <PdfButton row={{ ...row, items: items as unknown as ItFieldChecklistRow['items'], notes }} label="Export PDF" />
          </div>
        ) : (
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">In progress</span>
        )}
      </div>

      <Progress checked={t.checked} issues={t.issues} total={t.total} className="mt-4" />
      {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {sections.map((s) => (
        <section key={s.title} className="mt-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{s.title}</h2>
          <div className="flex flex-col gap-2.5">
            {s.items.map((i) => {
              const showComment = !!i.comment || !!i.issue || openComments.has(i.key)
              const commentMissing = !!i.issue && !i.comment.trim()
              return (
                <div key={i.key} className={cn(
                  'rounded-xl border p-3',
                  i.issue ? 'border-danger/60 bg-danger-soft/40' : i.checked ? 'border-ok/40 bg-card' : 'border-border bg-card',
                )}>
                  <div className="flex items-start gap-3">
                    <label className={cn('flex min-w-0 flex-1 items-start gap-3', canEdit && 'cursor-pointer')}>
                      <input
                        type="checkbox"
                        checked={i.checked}
                        disabled={!canEdit}
                        onChange={(e) => update(i.key, e.target.checked ? { checked: true, issue: false } : { checked: false })}
                        className="mt-0.5 size-5 shrink-0 accent-accent"
                      />
                      <span className="text-sm leading-snug text-ink">{i.label}</span>
                    </label>
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => toggleIssue(i)}
                        aria-pressed={!!i.issue}
                        className={cn(
                          'inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold transition',
                          i.issue ? 'border-danger bg-danger text-white' : 'border-danger/50 bg-card text-danger hover:bg-danger-soft',
                        )}
                      >
                        <AlertTriangle className="size-3.5" /> Issue
                      </button>
                    ) : i.issue ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-danger px-2.5 py-1 text-xs font-semibold text-white">
                        <AlertTriangle className="size-3.5" /> Issue
                      </span>
                    ) : null}
                  </div>

                  {i.media.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2 pl-8">
                      {i.media.map((m) => {
                        const url = urls[m.path]
                        return (
                          <div key={m.path} className="relative">
                            <a href={url} target="_blank" rel="noopener noreferrer" title={m.name}
                              className="relative block size-16 overflow-hidden rounded-md border border-border bg-content">
                              {url && m.kind === 'video' ? (
                                <>
                                  <video src={`${url}#t=0.1`} preload="metadata" muted playsInline className="size-full object-cover" />
                                  <span className="absolute inset-0 grid place-items-center bg-black/25 text-white"><Play className="size-5" /></span>
                                </>
                              ) : url ? (
                                <img src={url} alt="" className="size-full object-cover" />
                              ) : null}
                            </a>
                            {canEdit && (
                              <button type="button" onClick={() => void removeMedia(i.key, m.path)} aria-label="Remove"
                                className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-danger text-white shadow">
                                <X className="size-3" />
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {showComment && (
                    <div className="mt-3 pl-8">
                      {canEdit ? (
                        <>
                          <textarea
                            value={i.comment}
                            onChange={(e) => update(i.key, { comment: e.target.value })}
                            rows={2}
                            placeholder={i.issue ? 'Describe the issue (required)' : 'Comment'}
                            className={cn(
                              'w-full rounded-lg border bg-content px-3 py-2 text-sm text-ink',
                              commentMissing ? 'border-danger' : 'border-border',
                            )}
                          />
                          {commentMissing && <p className="mt-1 text-xs font-medium text-danger">A comment is required for an issue.</p>}
                        </>
                      ) : (
                        <p className="whitespace-pre-wrap rounded-lg bg-content px-3 py-2 text-sm text-ink">{i.comment}</p>
                      )}
                    </div>
                  )}

                  {canEdit && (
                    <div className="mt-2.5 flex flex-wrap gap-2 pl-8">
                      <label className={cn(
                        'inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-content px-2.5 py-1.5 text-xs font-medium text-ink hover:border-accent',
                        uploading.has(i.key) && 'pointer-events-none opacity-60',
                      )}>
                        {uploading.has(i.key) ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
                        {uploading.has(i.key) ? 'Uploading…' : 'Photo / video'}
                        <input type="file" accept="image/*,video/*" multiple className="hidden"
                          onChange={(e) => { void addMedia(i.key, e.target.files); e.target.value = '' }} />
                      </label>
                      {!showComment && (
                        <button type="button" onClick={() => setOpenComments((prev) => new Set(prev).add(i.key))}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-content px-2.5 py-1.5 text-xs font-medium text-ink hover:border-accent">
                          <MessageSquare className="size-3.5" /> Comment
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}

      <section className="mt-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Overall notes</h2>
        {canEdit ? (
          <textarea
            value={notes}
            onChange={(e) => { dirty.current = true; setNotes(e.target.value) }}
            rows={3}
            placeholder="Anything else about this visit (optional)"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink"
          />
        ) : (
          <p className="whitespace-pre-wrap rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink">{notes || 'None'}</p>
        )}
      </section>

      {canEdit && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <span className={cn('text-xs', saveState === 'error' ? 'text-danger' : 'text-ink-muted')}>
            {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Couldn’t save. Check your connection.' : saveState === 'saved' ? 'Saved' : 'Saves as you go. You can come back and finish later.'}
          </span>
          <Button onClick={() => void submit()} disabled={submitting || uploading.size > 0}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Submit checklist
          </Button>
        </div>
      )}
    </div>
  )
}

// Export a submitted checklist to PDF (photos are fetched and embedded, so it
// can take a moment with a lot of media).
function PdfButton({ row, label }: { row: ItFieldChecklistRow; label: string }) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      await downloadItFieldChecklistPdf(row)
    } catch {
      window.alert('Could not build the PDF. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" onClick={() => void run()} disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-ink hover:bg-content disabled:opacity-60">
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />} {label}
    </button>
  )
}

function BackLink() {
  return (
    <Link to="/app/it-field-checklist" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
      <ArrowLeft className="size-4" /> IT Field Checklist
    </Link>
  )
}
