import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Field } from '@/components/forms/Field'
import { SITE_URL } from '@/lib/siteUrl'
import { MarketingNav } from './components'

// On-Demand Demo: capture the lead (name/email/phone required), then email a
// magic link the visitor uses to enter the shared demo account. The demo creds
// are consumed on the /demo/access page once their email is verified.
// Demo credentials live as Edge Function secrets (DEMO_EMAIL) only — the
// `enter-demo` function mints a one-time magic-link verify URL for the demo
// account so no demo password ever ships to the browser.

export default function DemoLauncher() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [company, setCompany] = useState('')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!name.trim() || !email.trim() || !phone.trim()) {
      setError('Please enter your name, email, and phone.')
      return
    }
    setBusy(true)

    // 1) Store the lead. The id is generated client-side so we don't need a read
    //    policy (leads aren't publicly readable) just to learn the new row's id.
    const leadId = crypto.randomUUID()
    const { error: insErr } = await supabase.from('demo_requests').insert({
      id: leadId,
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      company: company.trim() || null,
      details: details.trim() || null,
    })
    if (insErr) {
      setBusy(false)
      setError("We couldn't submit your request. Please try again.")
      return
    }

    // 2) Email a magic link that returns to /demo/access (which enters the demo).
    const redirect = `${SITE_URL}/demo/access?lead=${leadId}`
    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirect, data: { name: name.trim(), phone: phone.trim() } },
    })
    setBusy(false)
    if (otpErr) {
      setError(otpErr.message)
      return
    }
    setSent(true)
  }

  return (
    <div className="min-h-dvh bg-content">
      <MarketingNav />
      <div className="mx-auto flex w-full max-w-md flex-col px-4 py-12 sm:px-6">
        {sent ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
              <MailCheck className="size-6" />
            </div>
            <h1 className="text-xl font-semibold text-ink">Check your email</h1>
            <p className="mt-2 text-sm text-ink-muted">
              We sent a demo access link to <span className="font-medium text-ink">{email}</span>.
              Open it on this device to step into the live demo. The link can take a minute to arrive.
            </p>
            <Link to="/" className="mt-5 inline-block text-sm text-accent hover:underline">
              Back to home
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              Try the on-demand demo
            </h1>
            <p className="mt-2 text-sm text-ink-muted">
              Tell us where to send your access link and we'll email you a one-click way into a
              fully loaded demo. No sales call, no obligation.
            </p>
            <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
              <Field label="Name" required>
                {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
              </Field>
              <Field label="Work email" required>
                {(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />}
              </Field>
              <Field label="Phone" required>
                {(id) => <Input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />}
              </Field>
              <Field label="Company" hint="Optional">
                {(id) => <Input id={id} value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" />}
              </Field>
              <Field label="What do you want to see?" hint="Optional">
                {(id) => (
                  <textarea
                    id={id}
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                )}
              </Field>
              {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
              <Button type="submit" size="lg" disabled={busy}>
                {busy ? 'Sending…' : 'Email me the demo link'}
              </Button>
              <p className="text-center text-xs text-ink-subtle">
                We'll only use your details to give you access and follow up about WashLyfe.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
