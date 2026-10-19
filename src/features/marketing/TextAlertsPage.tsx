import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { AuthLayout } from '@/features/auth/AuthLayout'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Field } from '@/components/forms/Field'
import { smsOptIn, type OptInState } from '@/lib/queries/smsOptIn'

// Public opt-in page reached from the "Turn on text alerts" email. No login: the
// personal token in the URL identifies the user. Consent wording matches the
// signup form except "condition of employment", since these are existing staff.
export default function TextAlertsPage() {
  const { token = '' } = useParams<{ token: string }>()
  const [state, setState] = useState<OptInState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    smsOptIn.info(token)
      .then((s) => { if (active) setState(s) })
      .catch((e: unknown) => { if (active) setLoadError(e instanceof Error ? e.message : String(e)) })
    return () => { active = false }
  }, [token])

  const save = async () => {
    setError(null)
    if (phone.replace(/\D/g, '').length < 10) return setError('Enter a 10-digit US mobile number.')
    if (!consent) return setError('Check the box to agree to receive text alerts.')
    setBusy(true)
    try {
      setState(await smsOptIn.save(token, phone))
      setEditing(false)
      setConsent(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const turnOff = async () => {
    setError(null)
    setBusy(true)
    try { setState(await smsOptIn.optOut(token)) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  if (loadError) {
    return (
      <AuthLayout title="Text alerts">
        <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{loadError}</p>
      </AuthLayout>
    )
  }
  if (!state) {
    return (
      <AuthLayout title="Text alerts">
        <div className="grid place-items-center py-6 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
      </AuthLayout>
    )
  }

  const greeting = state.first_name ? `Hi ${state.first_name}. ` : ''

  if (state.opted_in && !editing) {
    return (
      <AuthLayout title="Text alerts" subtitle={`${greeting}Get operational alerts from Mighty Wash by text.`}>
        <div className="flex flex-col gap-4">
          <p className="flex items-start gap-2 rounded-md bg-ok-soft px-3 py-2.5 text-sm font-medium text-ok">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            Text alerts are on for {state.phone_masked}.
          </p>
          <p className="text-xs leading-relaxed text-ink-muted">
            You can turn them off anytime by replying STOP to any text, or below.
          </p>
          {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)} disabled={busy}>Change number</Button>
            <Button variant="secondary" onClick={() => void turnOff()} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Turn off
            </Button>
          </div>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Text alerts" subtitle={`${greeting}Get operational alerts from Mighty Wash by text.`}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save() }}>
        <Field label="Mobile number">
          {(id) => (
            <Input id={id} type="tel" autoComplete="tel" placeholder="(806) 555-1234" value={phone} onChange={(e) => setPhone(e.target.value)} />
          )}
        </Field>
        <label className="flex items-start gap-2 text-xs leading-relaxed text-ink-muted">
          <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-accent" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            I agree to receive recurring automated operational and account text alerts from Mighty Wash (e.g. labor, approval, and account/security notifications) at the mobile number above.
            Consent is not a condition of employment. Message frequency varies. Message &amp; data rates may apply. Reply STOP to opt out, HELP for help. See our{' '}
            <a href="/mighty-wash/sms-terms" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">SMS Terms</a>
            {' '}&amp;{' '}
            <a href="/mighty-wash/sms-privacy" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Privacy Policy</a>.
          </span>
        </label>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          Turn on text alerts
        </Button>
        {state.opted_in && (
          <button type="button" onClick={() => setEditing(false)} className="text-center text-xs text-ink-muted hover:text-ink">Cancel</button>
        )}
      </form>
    </AuthLayout>
  )
}
