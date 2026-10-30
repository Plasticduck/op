import { useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import { itInventory } from '@/lib/queries/itInventory'

// Report a problem with a device. Becomes a Work Request linked to the asset
// (the existing issue flow) and shows on the asset's Timeline. Used on the
// public sticker page and from the asset page.

const QUICK = [
  "It won't turn on",
  'Screen is blank or frozen',
  "Card reader isn't working",
  "It's damaged",
  'No internet or network',
]

export function ProblemForm({
  short,
  tag,
  signedIn,
  onDone,
}: {
  short: string
  tag: string
  // Signed-in people are recorded as the reporter, so no name or contact asked.
  signedIn: boolean
  onDone: () => void
}) {
  const [quick, setQuick] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async () => {
    const description = [quick, text.trim()].filter(Boolean).join('. ')
    if (!description) { setError("Pick what's wrong or describe it."); return }
    setBusy(true)
    setError(null)
    const { message } = await itInventory.reportProblem({ short, tag, description, name, contact })
    setBusy(false)
    if (message) { setError(message); return }
    onDone()
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1.5 text-sm font-medium text-ink">What's wrong?</div>
        <div className="flex flex-wrap gap-2">
          {QUICK.map((q) => (
            <button key={q} type="button" onClick={() => setQuick(quick === q ? null : q)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition',
                quick === q ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-card text-ink hover:bg-content',
              )}>
              {q}
            </button>
          ))}
        </div>
      </div>
      <Field label={quick ? 'Anything else?' : 'Tell us what you see'}>
        {(id) => (
          <textarea id={id} value={text} onChange={(e) => setText(e.target.value)} rows={3}
            placeholder="What it's doing, and when it started"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent" />
        )}
      </Field>
      {!signedIn && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Your name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />}</Field>
          <Field label="Phone or email">{(id) => <Input id={id} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Optional, if you want a reply" />}</Field>
        </div>
      )}
      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <Button onClick={() => void send()} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send report
      </Button>
    </div>
  )
}

export function ReportProblemDialog({
  short,
  tag,
  name,
  onClose,
  onReported,
}: {
  short: string
  tag: string
  name: string
  onClose: () => void
  onReported: () => void
}) {
  return (
    <Modal open onClose={onClose} title="Report a problem" description={`${tag} ${name}`}>
      <ProblemForm short={short} tag={tag} signedIn onDone={onReported} />
    </Modal>
  )
}
