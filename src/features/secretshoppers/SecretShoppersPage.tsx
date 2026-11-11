import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { format } from 'date-fns'
import { Camera, CheckCircle2, KeyRound, Loader2, LogOut, Play, RotateCcw, Send, Star, UsersRound, VenetianMask, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useAuth } from '@/lib/auth'
import { cn, compareLocationName } from '@/lib/utils'
import {
  mediaType,
  secretShoppers,
  SHOPPER_MAX_FILES,
  SHOPPER_MEDIA_MAX_BYTES,
  type ShopperSession,
  type SubmitResult,
} from '@/lib/queries/secretShoppers'
import { SECRET_SHOPPER_EMAILS } from './access'
import { RATING_CATEGORIES, STAR_WORDS } from './ratings'
import { ManageShoppersModal } from './ManageShoppersModal'

// Secret Shoppers: a shopper visits a site unannounced, then signs in here with
// their PIN and rates the visit 1-5 stars on each question, with comments,
// photos and videos. Submitting emails the report to leadership. The PIN
// session lives only in this page's memory, so leaving the page signs out.

type Done = SubmitResult & { site: string }

export default function SecretShoppersPage() {
  const { profile } = useAuth()
  const [session, setSession] = useState<ShopperSession | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [formKey, setFormKey] = useState(0)
  const [manageOpen, setManageOpen] = useState(false)
  const isAdmin = SECRET_SHOPPER_EMAILS.includes((profile?.email ?? '').toLowerCase())

  const signOut = () => { setSession(null); setDone(null) }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Secret Shoppers"
        subtitle={session ? `Signed in as ${session.shopper.name}` : 'Rate a visit to any of our sites.'}
        actions={
          <>
            {isAdmin && !session && (
              <Button variant="secondary" size="sm" onClick={() => setManageOpen(true)}>
                <UsersRound className="size-4" /> Shoppers and PINs
              </Button>
            )}
            {session && (
              <Button variant="secondary" size="sm" onClick={signOut}>
                <LogOut className="size-4" /> Sign out
              </Button>
            )}
          </>
        }
      />

      {!session ? (
        <PinGate onSignedIn={(s) => { setSession(s); setDone(null) }} />
      ) : done ? (
        <SubmittedCard
          done={done}
          name={session.shopper.name}
          pin={session.pin}
          onAnother={() => { setDone(null); setFormKey((k) => k + 1) }}
          onSignOut={signOut}
          onResent={(d) => setDone({ ...done, ...d, failedUploads: done.failedUploads })}
        />
      ) : (
        <ReportForm key={formKey} session={session} onSubmitted={setDone} />
      )}

      {manageOpen && <ManageShoppersModal onClose={() => setManageOpen(false)} />}
    </div>
  )
}

// ---- PIN ---------------------------------------------------------------------

function PinGate({ onSignedIn }: { onSignedIn: (s: ShopperSession) => void }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (pin.length < 4 || busy) return
    setBusy(true)
    setError(null)
    const { data, error: err } = await secretShoppers.signIn(pin)
    setBusy(false)
    if (!data) { setError(err); setPin(''); return }
    onSignedIn(data)
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mx-auto mt-8 max-w-sm rounded-xl border border-border bg-card p-6 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
        <VenetianMask className="size-6" />
      </div>
      <h2 className="mt-3 text-lg font-semibold text-ink">Enter your PIN</h2>
      <p className="mt-1 text-sm text-ink-muted">Use the PIN you were given to start a report.</p>
      <Input
        type="password"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={8}
        aria-label="PIN"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
        className="mt-5 h-14 text-center text-2xl tracking-[0.5em]"
      />
      {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <Button type="submit" size="lg" className="mt-4 w-full" disabled={pin.length < 4 || busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />} Continue
      </Button>
    </form>
  )
}

// ---- The report --------------------------------------------------------------

type Picked = { id: string; file: File; url: string; kind: 'image' | 'video' }

const localNow = () => format(new Date(), "yyyy-MM-dd'T'HH:mm")
const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`

function ReportForm({ session, onSubmitted }: { session: ShopperSession; onSubmitted: (d: Done) => void }) {
  const sites = useMemo(() => [...session.sites].sort((a, b) => compareLocationName(a.name, b.name)), [session.sites])
  const [siteId, setSiteId] = useState('')
  const [visitedAt, setVisitedAt] = useState(localNow)
  const [washPackage, setWashPackage] = useState('')
  const [teamMembers, setTeamMembers] = useState('')
  const [stars, setStars] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [comments, setComments] = useState('')
  const [files, setFiles] = useState<Picked[]>([])
  const [fileNote, setFileNote] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Free the photo previews when the form goes away.
  const filesRef = useRef(files)
  useEffect(() => { filesRef.current = files }, [files])
  useEffect(() => () => { for (const f of filesRef.current) URL.revokeObjectURL(f.url) }, [])

  // A browser refresh or closed tab would lose a long report.
  const dirty = !!(siteId || washPackage || teamMembers || comments || files.length || Object.keys(stars).length)
  useEffect(() => {
    if (!dirty || busy) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, busy])

  const visitTime = new Date(visitedAt)
  const visitBad = isNaN(visitTime.getTime()) || visitTime.getTime() > Date.now() + 60 * 60_000
  const missingStars = RATING_CATEGORIES.filter((c) => !stars[c.key])
  const problems: { id: string; ok: boolean }[] = [
    { id: 'ss-site', ok: !!siteId },
    { id: 'ss-when', ok: !visitBad },
    ...RATING_CATEGORIES.map((c) => ({ id: `ss-rate-${c.key}`, ok: !!stars[c.key] })),
    { id: 'ss-comments', ok: !!comments.trim() },
  ]
  const firstProblem = problems.find((p) => !p.ok)
  const flag = (id: string) => showErrors && problems.some((p) => p.id === id && !p.ok)

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return
    const added: Picked[] = []
    const skipped: string[] = []
    for (const file of Array.from(list)) {
      const type = mediaType(file)
      if (!type) { skipped.push(`${file.name} isn't a photo or video`); continue }
      if (file.size > SHOPPER_MEDIA_MAX_BYTES) { skipped.push(`${file.name} is ${mb(file.size)}, over the 50 MB limit`); continue }
      if (files.length + added.length >= SHOPPER_MAX_FILES) { skipped.push(`only ${SHOPPER_MAX_FILES} files fit on one report`); break }
      added.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file), kind: type.startsWith('video/') ? 'video' : 'image' })
    }
    setFiles((prev) => [...prev, ...added])
    setFileNote(skipped.length ? `Skipped: ${skipped.join('; ')}.` : null)
  }
  const removeFile = (id: string) => {
    setFiles((prev) => {
      const f = prev.find((x) => x.id === id)
      if (f) URL.revokeObjectURL(f.url)
      return prev.filter((x) => x.id !== id)
    })
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (firstProblem) {
      setShowErrors(true)
      setError(missingStars.length
        ? `Rate every question from 1 to 5 stars (${missingStars.length} left), and fill in the highlighted fields.`
        : 'Fill in the highlighted fields.')
      document.getElementById(firstProblem.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setError(null)
    setBusy('Saving your report…')
    const { data, error: err } = await secretShoppers.submit(
      session.pin,
      {
        location_id: siteId,
        visited_at: visitTime.toISOString(),
        wash_package: washPackage.trim(),
        team_members: teamMembers.trim(),
        ratings: Object.fromEntries(RATING_CATEGORIES.map((c) => [c.key, { stars: stars[c.key], comment: (notes[c.key] ?? '').trim() }])),
        comments: comments.trim(),
      },
      files.map((f) => f.file),
      setBusy,
    )
    setBusy(null)
    if (!data) { setError(err); return }
    onSubmitted({ ...data, site: sites.find((s) => s.id === siteId)?.name ?? 'the site' })
  }

  const fieldLabel = 'mb-1.5 block text-sm font-medium text-ink'

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="mt-5 space-y-6">
      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Your visit</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div id="ss-site">
            <label htmlFor="ss-site-select" className={fieldLabel}>Site you visited</label>
            <Select id="ss-site-select" value={siteId} onChange={(e) => setSiteId(e.target.value)}
              className={cn(flag('ss-site') && 'border-danger')}>
              <option value="">Select a site…</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          <div id="ss-when">
            <label htmlFor="ss-when-input" className={fieldLabel}>When you visited</label>
            <Input id="ss-when-input" type="datetime-local" value={visitedAt} max={localNow()}
              onChange={(e) => setVisitedAt(e.target.value)} invalid={flag('ss-when')} />
          </div>
          <div>
            <label htmlFor="ss-package" className={fieldLabel}>Wash package you bought <span className="font-normal text-ink-subtle">(optional)</span></label>
            <Input id="ss-package" value={washPackage} maxLength={200} onChange={(e) => setWashPackage(e.target.value)}
              placeholder="Which wash did you buy?" />
          </div>
          <div>
            <label htmlFor="ss-team" className={fieldLabel}>Team members you dealt with <span className="font-normal text-ink-subtle">(optional)</span></label>
            <Input id="ss-team" value={teamMembers} maxLength={500} onChange={(e) => setTeamMembers(e.target.value)}
              placeholder="Names from name tags, or describe them" />
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">Ratings</h2>
        <div className="space-y-3">
          {RATING_CATEGORIES.map((c) => {
            const id = `ss-rate-${c.key}`
            return (
              <div key={c.key} id={id}
                className={cn('rounded-xl border bg-card p-4', flag(id) ? 'border-danger' : 'border-border')}>
                <div className="font-semibold text-ink">{c.label}</div>
                <div className="mt-0.5 text-sm text-ink-muted">{c.hint}</div>
                <StarPicker
                  label={c.label}
                  value={stars[c.key] ?? 0}
                  invalid={flag(id)}
                  onChange={(n) => setStars((prev) => ({ ...prev, [c.key]: n }))}
                />
                <textarea
                  value={notes[c.key] ?? ''}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [c.key]: e.target.value }))}
                  maxLength={1000}
                  rows={2}
                  aria-label={`${c.label} comment`}
                  placeholder="Comment (optional)"
                  className="mt-3 w-full rounded-lg border border-border bg-content px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            )
          })}
        </div>
      </section>

      <section id="ss-comments">
        <label htmlFor="ss-comments-input" className="mb-2 block text-sm font-semibold uppercase tracking-wide text-ink-muted">Tell us about your visit</label>
        <textarea
          id="ss-comments-input"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          maxLength={5000}
          rows={6}
          placeholder="Walk us through it: what went well, what didn't, and anything the team should know."
          className={cn(
            'w-full rounded-xl border bg-card px-4 py-3 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent',
            flag('ss-comments') ? 'border-danger' : 'border-border',
          )}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">Photos and videos</h2>
        {files.length > 0 && (
          <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {files.map((f) => (
              <div key={f.id} className="relative">
                <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-content" title={f.file.name}>
                  {f.kind === 'video' ? (
                    <>
                      <video src={`${f.url}#t=0.1`} preload="metadata" muted playsInline className="size-full object-cover" />
                      <span className="absolute inset-0 grid place-items-center bg-black/25 text-white"><Play className="size-6" /></span>
                    </>
                  ) : (
                    <img src={f.url} alt="" className="size-full object-cover" />
                  )}
                </div>
                <button type="button" onClick={() => removeFile(f.id)} aria-label={`Remove ${f.file.name}`} disabled={!!busy}
                  className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-danger text-white shadow">
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <label className={cn(
          'flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card px-4 py-4 text-sm font-medium text-ink hover:border-accent',
          (!!busy || files.length >= SHOPPER_MAX_FILES) && 'pointer-events-none opacity-60',
        )}>
          <Camera className="size-5 text-accent" /> Add photos or videos
          <input type="file" accept="image/*,video/*" multiple className="hidden"
            onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        </label>
        <p className="mt-1.5 text-xs text-ink-subtle">Up to {SHOPPER_MAX_FILES} files, 50 MB each. Keep videos short (under about 30 seconds).</p>
        {fileNote && <p className="mt-1.5 text-xs font-medium text-warn">{fileNote}</p>}
      </section>

      <div className="border-t border-border pt-5">
        {error && <p className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={!!busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} {busy ?? 'Submit report'}
        </Button>
        <p className="mt-2 text-center text-xs text-ink-subtle">Your report is emailed to the leadership team.</p>
      </div>
    </form>
  )
}

function StarPicker({ label, value, invalid, onChange }: { label: string; value: number; invalid: boolean; onChange: (n: number) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="mt-2 flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}, ${STAR_WORDS[n]}`}
          onClick={() => onChange(n)}
          className="grid size-11 place-items-center rounded-md hover:bg-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Star className={cn('size-8 transition-colors', n <= value ? 'fill-warn text-warn' : 'text-ink-subtle')} strokeWidth={1.5} />
        </button>
      ))}
      <span className={cn('ml-2 text-sm font-medium', value ? 'text-ink' : invalid ? 'text-danger' : 'text-ink-subtle')}>
        {value ? STAR_WORDS[value] : invalid ? 'Pick a rating' : ''}
      </span>
    </div>
  )
}

// ---- After submitting --------------------------------------------------------

function SubmittedCard({ done, name, pin, onAnother, onSignOut, onResent }: {
  done: Done
  name: string
  pin: string
  onAnother: () => void
  onSignOut: () => void
  onResent: (d: SubmitResult) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resend = async () => {
    setBusy(true)
    setError(null)
    const { data, error: err } = await secretShoppers.finish(pin, done.visitId)
    setBusy(false)
    if (!data) { setError(err); return }
    onResent(data)
    if (!data.emailed) setError(data.message ?? "The email still didn't go out.")
  }

  return (
    <div className="mx-auto mt-8 max-w-md rounded-xl border border-border bg-card p-6 text-center">
      <CheckCircle2 className={cn('mx-auto size-12', done.emailed ? 'text-ok' : 'text-warn')} />
      <h2 className="mt-3 text-lg font-semibold text-ink">{done.emailed ? 'Report submitted' : 'Report saved'}</h2>
      <p className="mt-1 text-sm text-ink-muted">
        {done.emailed
          ? `Thanks, ${name}. Your report on ${done.site} was sent.`
          : `Your report on ${done.site} was saved, but the email didn't go out${done.message ? `: ${done.message}` : '.'}`}
      </p>
      {done.failedUploads > 0 && (
        <p className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          {done.failedUploads} photo{done.failedUploads === 1 ? '' : 's'} or video{done.failedUploads === 1 ? '' : 's'} didn't upload and {done.failedUploads === 1 ? 'was' : 'were'} left off the report.
        </p>
      )}
      {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="mt-5 flex flex-col gap-2">
        {!done.emailed && (
          <Button onClick={() => void resend()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Try the email again
          </Button>
        )}
        <Button variant={done.emailed ? 'primary' : 'secondary'} onClick={onAnother}>
          <Send className="size-4" /> Submit another report
        </Button>
        <Button variant="ghost" onClick={onSignOut}>
          <LogOut className="size-4" /> Sign out
        </Button>
      </div>
    </div>
  )
}
