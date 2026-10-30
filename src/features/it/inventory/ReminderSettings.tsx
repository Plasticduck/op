import { useEffect, useMemo, useState } from 'react'
import { Eye, Loader2, Save, Send, X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { cn } from '@/lib/utils'
import { itInventory, type ItPerson, type ItReminderRule, type RemindersPreview } from '@/lib/queries/itInventory'
import { friendlyError } from './format'
import type { ItRefs } from './useItRefs'

// Settings > Reminders: the morning texts and emails (it-reminders edge
// function, 8 AM Central). Off until an admin turns them on. Per kind: on or
// off, how many days ahead, text and/or email. Who gets them is one choice for
// all kinds: Admins and technicians hear about every site, managers about
// their own sites, plus anyone named.

const KINDS = [
  { kind: 'warranty', label: 'Warranties ending', days: true },
  { kind: 'subscription_renewal', label: 'Subscriptions to cancel or renew', days: true, hint: 'Counts down to the last day to cancel when it renews by itself.' },
  { kind: 'eol', label: 'End of life', days: true },
  { kind: 'audit_due', label: 'Audits due', days: true },
  { kind: 'low_stock', label: 'Supplies running low', days: false, hint: 'Once each time a counted supply drops to its minimum.' },
] as const

const ROLES = [
  { role: 'owner', label: 'Admins', hint: 'every site' },
  { role: 'technician', label: 'Technicians', hint: 'every site' },
  { role: 'manager', label: 'Managers', hint: 'their own sites' },
] as const

type Draft = { enabled: boolean; days: string; sms: boolean; email: boolean }
type Recipients = { roles: string[]; user_ids: string[] }

const daysText = (d: number[]) => [...d].sort((a, b) => b - a).join(', ')
const parseDays = (s: string) => [...new Set(s.split(/[\s,]+/).filter(Boolean).map(Number))]

export function ReminderSettings({ refs, admin, onSaved }: { refs: ItRefs; admin: boolean; onSaved: (m: string) => void }) {
  const [rules, setRules] = useState<ItReminderRule[] | null>(null)
  const [people, setPeople] = useState<ItPerson[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [who, setWho] = useState<Recipients>({ roles: ['owner', 'manager'], user_ids: [] })
  const [digest, setDigest] = useState(true)
  const [on, setOn] = useState(refs.settings.reminders_enabled)
  const [busy, setBusy] = useState<null | 'save' | 'preview' | 'test'>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<RemindersPreview | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void Promise.all([itInventory.reminderRules(), itInventory.people()]).then(([r, p]) => {
      if (!alive) return
      const rs = r.data ?? []
      setRules(rs)
      setPeople((p.data as ItPerson[] | null) ?? [])
      setDrafts(Object.fromEntries(rs.map((x) => [x.kind, {
        enabled: x.enabled, days: daysText(x.days_before), sms: x.channels.includes('sms'), email: x.channels.includes('email'),
      }])))
      const first = rs.find((x) => KINDS.some((k) => k.kind === x.kind))
      const rec = (first?.recipients ?? null) as Recipients | null
      if (rec) setWho({ roles: rec.roles ?? [], user_ids: rec.user_ids ?? [] })
      if (first) setDigest(first.digest)
    })
    return () => { alive = false }
  }, [])

  // Who that adds up to, and how many of them can get texts.
  const reach = useMemo(() => {
    const picked = people.filter((p) => (who.roles.includes(p.role) && p.role !== 'employee') || who.user_ids.includes(p.id))
    return { total: picked.length, texts: picked.filter((p) => p.sms_opt_in && p.phone).length }
  }, [people, who])

  const setDraft = (kind: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [kind]: { ...d[kind], ...patch } }))
  const toggleRole = (role: string) => setWho((w) => ({ ...w, roles: w.roles.includes(role) ? w.roles.filter((r) => r !== role) : [...w.roles, role] }))

  const save = async () => {
    if (!rules) return
    for (const k of KINDS) {
      const d = drafts[k.kind]
      if (!d || !k.days || !d.enabled) continue
      const days = parseDays(d.days)
      if (!days.length || days.some((n) => !Number.isInteger(n) || n < 0 || n > 365)) {
        setError(`${k.label}: list days like "60, 30, 7" (0 to 365).`)
        return
      }
    }
    setBusy('save')
    setError(null)
    for (const k of KINDS) {
      const rule = rules.find((r) => r.kind === k.kind)
      const d = drafts[k.kind]
      if (!rule || !d) continue
      const channels = [...(d.sms ? ['sms'] : []), ...(d.email ? ['email'] : [])]
      const { error: err } = await itInventory.updateReminderRule(rule.id, {
        enabled: d.enabled && channels.length > 0,
        days_before: k.days ? parseDays(d.days) : rule.days_before,
        channels,
        recipients: who,
        digest,
      })
      if (err) { setBusy(null); setError(friendlyError(err.message)); return }
    }
    if (on !== refs.settings.reminders_enabled) {
      const { error: err } = await itInventory.updateSettings(refs.settings.id, { reminders_enabled: on })
      if (err) { setBusy(null); setError(friendlyError(err.message)); return }
    }
    setBusy(null)
    onSaved(on ? 'Saved. Reminders go out at 8 AM Central.' : 'Saved. Reminders are off, so nothing is sent.')
  }

  const runPreview = async () => {
    setBusy('preview')
    setError(null)
    const { data, message } = await itInventory.remindersPreview()
    setBusy(null)
    if (message) setError(message)
    else setPreview(data)
  }

  const runTest = async () => {
    setBusy('test')
    setError(null)
    setTestResult(null)
    const { data, message } = await itInventory.remindersTest()
    setBusy(null)
    if (message || !data) { setError(message ?? 'The test did not go out.'); return }
    const part = (what: string, r: { ok: boolean; error?: string }) => (r.ok ? `${what} sent` : `${what} not sent: ${r.error}`)
    setTestResult(`${part('Text', data.sms)}. ${part('Email', data.email)}.`)
  }

  if (!rules) {
    return (
      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-ink">Reminders</h2>
        <div className="grid place-items-center py-6 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
      </section>
    )
  }

  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Reminders</h2>
          <p className="mt-1 text-xs text-ink-muted">Texts and emails at 8 AM Central about what's coming up. Each reminder goes to each person once.</p>
        </div>
        <label className={cn('flex items-center gap-2 text-sm font-medium', admin ? 'cursor-pointer' : 'opacity-70')}>
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} disabled={!admin}
            className="size-4 rounded border-border text-accent focus:ring-accent" />
          <span className={on ? 'text-ok' : 'text-ink-muted'}>{on ? 'On' : 'Off'}</span>
        </label>
      </div>
      {!on && <p className="mt-3 rounded-md bg-content px-3 py-2 text-sm text-ink-muted">Off: nothing is sent until an admin turns this on. Preview shows what would go out.</p>}

      <div className="mt-4 divide-y divide-border rounded-md border border-border">
        {KINDS.map((k) => {
          const d = drafts[k.kind]
          if (!d) return null
          return (
            <div key={k.kind} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
              <label className="flex min-w-0 flex-1 items-start gap-2.5 text-sm text-ink">
                <input type="checkbox" checked={d.enabled} onChange={(e) => setDraft(k.kind, { enabled: e.target.checked })} disabled={!admin}
                  className="mt-0.5 size-4 rounded border-border text-accent focus:ring-accent" />
                <span>
                  {k.label}
                  {'hint' in k && <span className="block text-xs text-ink-muted">{k.hint}</span>}
                </span>
              </label>
              <div className={cn('flex flex-wrap items-center gap-3 pl-6 sm:pl-0', !d.enabled && 'opacity-50')}>
                {k.days && (
                  <label className="flex items-center gap-2 text-xs text-ink-muted">
                    <Input value={d.days} onChange={(e) => setDraft(k.kind, { days: e.target.value })} disabled={!admin || !d.enabled}
                      className="h-8 w-28 text-sm" aria-label={`${k.label}: days before`} />
                    days before
                  </label>
                )}
                <label className="flex items-center gap-1.5 text-sm text-ink">
                  <input type="checkbox" checked={d.sms} onChange={(e) => setDraft(k.kind, { sms: e.target.checked })} disabled={!admin || !d.enabled}
                    className="size-4 rounded border-border text-accent focus:ring-accent" /> Text
                </label>
                <label className="flex items-center gap-1.5 text-sm text-ink">
                  <input type="checkbox" checked={d.email} onChange={(e) => setDraft(k.kind, { email: e.target.checked })} disabled={!admin || !d.enabled}
                    className="size-4 rounded border-border text-accent focus:ring-accent" /> Email
                </label>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-4">
        <div className="mb-1.5 text-sm font-medium text-ink">Who gets them</div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {ROLES.map((r) => {
            const n = people.filter((p) => p.role === r.role).length
            return (
              <label key={r.role} className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={who.roles.includes(r.role)} onChange={() => toggleRole(r.role)} disabled={!admin}
                  className="size-4 rounded border-border text-accent focus:ring-accent" />
                {r.label} <span className="text-xs text-ink-muted">({n}, {r.hint})</span>
              </label>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {who.user_ids.map((id) => {
            const p = people.find((x) => x.id === id)
            return (
              <span key={id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-content px-2.5 py-1 text-xs text-ink">
                {p?.name ?? 'Someone'}
                {admin && (
                  <button type="button" aria-label={`Remove ${p?.name ?? 'person'}`} className="text-ink-subtle hover:text-ink"
                    onClick={() => setWho((w) => ({ ...w, user_ids: w.user_ids.filter((x) => x !== id) }))}><X className="size-3" /></button>
                )}
              </span>
            )
          })}
          {admin && (
            <Select value="" onChange={(e) => { const id = e.target.value; if (id) setWho((w) => ({ ...w, user_ids: [...w.user_ids, id] })) }}
              className="h-8 w-auto text-sm" aria-label="Also send to">
              <option value="">Also send to…</option>
              {people.filter((p) => p.role !== 'employee' && !who.user_ids.includes(p.id) && !who.roles.includes(p.role))
                .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          {reach.total} {reach.total === 1 ? 'person' : 'people'}; {reach.texts} can get texts (mobile number on file and opted in). The rest get email only.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={digest} onChange={(e) => setDigest(e.target.checked)} disabled={!admin}
            className="size-4 rounded border-border text-accent focus:ring-accent" />
          One text and one email a day per person, listing everything (recommended)
        </label>
      </div>

      {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {testResult && <p className="mt-3 rounded-md bg-content px-3 py-2 text-sm text-ink">{testResult}</p>}
      {admin && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void save()} disabled={!!busy}>{busy === 'save' ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save</Button>
          <Button variant="secondary" onClick={() => void runPreview()} disabled={!!busy}>
            {busy === 'preview' ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />} Preview today's
          </Button>
          <Button variant="secondary" onClick={() => void runTest()} disabled={!!busy}>
            {busy === 'test' ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send me a test
          </Button>
        </div>
      )}
      {admin && <p className="mt-2 text-xs text-ink-muted">Preview and test use the saved settings.</p>}

      {preview && (
        <Modal open onClose={() => setPreview(null)} size="lg" title="Today's reminders"
          description={`${preview.people.length ? `${preview.people.length} ${preview.people.length === 1 ? 'person' : 'people'} would hear about something.` : 'Nothing is due today.'}${preview.enabled ? '' : ' Reminders are off, so none of this is sent.'} Ones already sent are included.`}>
          {preview.people.length === 0 ? (
            <p className="text-sm text-ink-muted">When something comes up (a warranty ending, a subscription to cancel, a supply running low), it shows here.</p>
          ) : (
            <ul className="max-h-[60vh] space-y-3 overflow-y-auto">
              {preview.people.map((p) => (
                <li key={p.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink">{p.name}</span>
                    {p.text.length > 0 && <Badge tone="accent">Text</Badge>}
                    {p.email && <Badge tone="neutral">Email</Badge>}
                    {p.no_text_reason && <span className="text-xs text-ink-muted">No text: {p.no_text_reason}</span>}
                  </div>
                  <ul className="mt-2 space-y-1 text-sm text-ink">
                    {p.items.map((i, n) => <li key={n} className="flex gap-2"><span className="text-ink-subtle">•</span>{i.text}</li>)}
                  </ul>
                  {p.text[0] && (
                    <pre className="mt-2 whitespace-pre-wrap rounded-md bg-content px-3 py-2 font-sans text-xs text-ink-muted">{p.text[0]}</pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </section>
  )
}
