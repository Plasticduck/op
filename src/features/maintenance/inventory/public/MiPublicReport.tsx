import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleCheck, Loader2, Send, Wrench } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { miPublic, type PublicMachine } from '@/lib/queries/miPublic'
import { cn } from '@/lib/utils'

// What a machine sticker's QR shows to anyone who can't open Maintenance Inventory: the
// machine (name, type, site, zone, nothing else) and a short form. The report becomes a
// Maintenance ticket in Work Orders NEW, linked to the machine, for a reviewer to triage.

const QUICK = ['Making a noise', 'Leaking', "Not spinning or moving", 'Not spraying right', "It's damaged"]

export default function MiPublicReport({ short, tag, signedIn }: { short: string; tag: string; signedIn: boolean }) {
  const [info, setInfo] = useState<{ company: string | null; asset: PublicMachine } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)
  const [quick, setQuick] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [down, setDown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void miPublic.info(short, tag).then(({ data, message }) => {
      if (!alive) return
      if (data) setInfo(data)
      else setError(message)
    })
    return () => { alive = false }
  }, [short, tag])

  const send = async () => {
    const description = [quick, text.trim()].filter(Boolean).join('. ')
    if (!description) { setSendError("Pick what's wrong or describe it."); return }
    setBusy(true)
    setSendError(null)
    const { data, message } = await miPublic.report({ short, tag, description, name, contact, down })
    setBusy(false)
    if (message || !data) { setSendError(message ?? 'Something went wrong. Try again.'); return }
    setDone(data.number)
  }

  if (error) return <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-ink-muted">{error}</div>
  if (!info) return <div className="grid place-items-center py-10 text-ink-muted"><Loader2 className="size-6 animate-spin" /></div>
  if (done != null) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <CircleCheck className="mx-auto mb-3 size-12 text-ok" />
        <h1 className="text-lg font-semibold text-ink">Thanks, it's reported</h1>
        <p className="mt-1 text-sm text-ink-muted">Maintenance has it as ticket #{done} and will take a look.</p>
        <Button className="mt-5" variant="secondary" onClick={() => { setDone(null); setQuick(null); setText(''); setDown(false) }}>Report something else</Button>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent"><Wrench className="size-5" /></span>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">Report a problem</h1>
          <p className="text-xs text-ink-muted">Let {info.company ?? 'maintenance'} know something's wrong with this machine.</p>
        </div>
      </div>
      <div className="mb-4 rounded-md border border-border bg-content px-3 py-2.5">
        <div className="font-medium text-ink">{info.asset.name}</div>
        <div className="text-sm text-ink-muted">{[info.asset.site, info.asset.zone].filter(Boolean).join(' · ')}</div>
        <div className="mt-0.5 font-mono text-xs text-ink-subtle">{info.asset.tag}</div>
      </div>
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1.5 text-sm font-medium text-ink">What's wrong?</div>
          <div className="flex flex-wrap gap-2">
            {QUICK.map((q) => (
              <button key={q} type="button" onClick={() => setQuick(quick === q ? null : q)}
                className={cn('rounded-full border px-3 py-1.5 text-sm transition', quick === q ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-card text-ink hover:bg-content')}>
                {q}
              </button>
            ))}
          </div>
        </div>
        <Field label={quick ? 'Anything else?' : 'Tell us what you see'}>
          {(id) => (
            <textarea id={id} value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="What it's doing, and when it started"
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent" />
          )}
        </Field>
        <label className="flex items-start gap-2.5 rounded-md border border-border bg-content/40 px-3 py-2.5 text-sm text-ink">
          <input type="checkbox" checked={down} onChange={(e) => setDown(e.target.checked)} className="mt-0.5 size-4 rounded border-border text-accent focus:ring-accent" />
          <span>It's not running at all<span className="block text-xs text-ink-muted">Sends it to maintenance as high priority.</span></span>
        </label>
        {!signedIn && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Your name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />}</Field>
            <Field label="Phone or email">{(id) => <Input id={id} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Optional, if you want a reply" />}</Field>
          </div>
        )}
        {sendError && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{sendError}</p>}
        <Button onClick={() => void send()} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send report</Button>
      </div>
      {!signedIn && (
        <p className="mt-4 border-t border-border pt-4 text-center text-sm text-ink-muted">
          On the maintenance team? <Link to="/login" state={{ from: `/t/${short}/${tag}` }} className="font-medium text-accent hover:underline">Sign in</Link> to open this machine.
        </p>
      )}
    </div>
  )
}
