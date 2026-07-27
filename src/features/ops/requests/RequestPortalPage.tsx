import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { Logo } from '@/components/ui/Logo'
import { workRequests, type PortalInfo } from '@/lib/queries/workRequests'
import { PRIORITY_OPTIONS } from '@/lib/queries/workOrders'

export default function RequestPortalPage() {
  const { token = '' } = useParams()
  const [info, setInfo] = useState<PortalInfo | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [locationId, setLocationId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('none')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    void (async () => {
      const { data, error } = await workRequests.portalInfo(token)
      const res = data as PortalInfo | { error: string; message?: string } | null
      if (error || !res || !('ok' in res)) {
        setLoadErr((res as { message?: string })?.message || 'This request link is not active.')
      } else {
        setInfo(res)
        if (res.locations.length === 1) setLocationId(res.locations[0].id)
      }
      setLoading(false)
    })()
  }, [token])

  const submit = async () => {
    setError(null)
    if (!locationId) return setError('Please choose a site.')
    if (!title.trim()) return setError('Please enter what the issue is.')
    setBusy(true)
    const { data, error: err } = await workRequests.submitPublic({
      token, title, description, priority, location_id: locationId,
      requester_name: name, requester_email: email,
    })
    const res = data as { ok?: boolean; message?: string } | null
    setBusy(false)
    if (err || !res?.ok) return setError(res?.message || 'Could not submit. Please try again.')
    setDone(true)
  }

  return (
    <div className="min-h-dvh bg-content px-4 py-10">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 flex justify-center"><Logo brand="washlyfe" /></div>

        {loading ? (
          <p className="text-center text-sm text-ink-muted">Loading...</p>
        ) : loadErr ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <p className="text-sm text-ink-muted">{loadErr}</p>
          </div>
        ) : done ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <CheckCircle2 className="mx-auto mb-3 size-12 text-ok" />
            <h1 className="text-lg font-semibold text-ink">Request submitted</h1>
            <p className="mt-1 text-sm text-ink-muted">Thanks. Your request has been sent to the maintenance team for review.</p>
            <Button className="mt-5" variant="secondary" onClick={() => { setDone(false); setTitle(''); setDescription(''); setPriority('none') }}>Submit another</Button>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <span className="grid size-9 place-items-center rounded-full bg-accent-soft text-accent"><Wrench className="size-4" /></span>
              <div>
                <h1 className="text-lg font-semibold text-ink">{info?.name ?? 'Submit a Work Request'}</h1>
                <p className="text-xs text-ink-muted">Report an issue for the maintenance team.</p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {info && info.locations.length > 1 && (
                <Field label="Site" required>{(id) => (
                  <Select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                    <option value="">Select...</option>
                    {info.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </Select>
                )}</Field>
              )}
              <Field label="What's the issue?" required>{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Bay 2 vacuum not working" />}</Field>
              <Field label="Details">{(id) => (
                <textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Anything that helps us fix it faster" className="rounded-md border border-border bg-card px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
              )}</Field>
              <Field label="Priority">{(id) => (
                <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </Select>
              )}</Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Your name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />}</Field>
                <Field label="Email">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />}</Field>
              </div>
              {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
              <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Submitting...' : 'Submit request'}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
