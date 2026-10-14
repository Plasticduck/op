import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { setSitePlan, type SitePlan } from '@/lib/queries/companySettings'
import { AuthLayout } from '@/features/auth/AuthLayout'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

const schema = z
  .object({
    name: z.string().min(1, 'Enter your name'),
    accountName: z.string().min(1, 'Enter your company name'),
    locationName: z.string().min(1, 'Enter your first location'),
    email: z.string().email('Enter a valid email'),
    password: z.string().min(8, 'At least 8 characters'),
    phone: z.string().optional(),
    smsConsent: z.boolean().optional(),
  })
  // If they tick the SMS consent box, a valid mobile number is required.
  .refine((v) => !v.smsConsent || (!!v.phone && v.phone.replace(/\D/g, '').length >= 10), {
    message: 'Enter a valid mobile number to receive texts.',
    path: ['phone'],
  })
type Values = z.infer<typeof schema>

export default function SignupPage() {
  const navigate = useNavigate()
  const { refreshProfile } = useAuth()
  const [formError, setFormError] = useState<string | null>(null)
  const [sitePlan, setSitePlanChoice] = useState<SitePlan>('multi')
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), mode: 'onBlur' })

  const onSubmit = async (values: Values) => {
    setFormError(null)

    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: { data: { name: values.name } },
    })
    if (error) {
      setFormError(error.message)
      return
    }
    if (!data.session) {
      // Email confirmation is enabled on this project — no session yet.
      setFormError(
        'Check your email to confirm your account, then sign in to finish setup.',
      )
      return
    }

    const { data: accountId, error: rpcError } = await supabase.rpc('signup_account', {
      p_account_name: values.accountName,
      p_location_name: values.locationName,
      p_user_name: values.name,
    })
    if (rpcError) {
      setFormError(rpcError.message)
      return
    }

    // Persist the chosen site plan (best effort; the account is already created).
    if (accountId) {
      try {
        await setSitePlan(accountId as string, sitePlan)
      } catch {
        /* ignore — defaults to multi until set */
      }
    }

    // Record the SMS opt-in (consent record for A2P 10DLC) if they opted in.
    if (values.smsConsent && values.phone && data.user?.id) {
      const e164 = '+1' + values.phone.replace(/\D/g, '').slice(-10)
      try {
        await supabase
          .from('users')
          .update({ phone: e164, sms_opt_in: true, sms_opt_in_at: new Date().toISOString() })
          .eq('id', data.user.id)
      } catch {
        /* best effort — the account is already created */
      }
    }

    await refreshProfile()
    navigate('/app/dashboard', { replace: true })
  }

  return (
    <AuthLayout
      title="Start your free trial"
      subtitle="14 days, no credit card. Set up your wash in under a minute."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <Field label="Your name" error={errors.name?.message} required>
          {(id) => (
            <Input id={id} autoComplete="name" invalid={!!errors.name} {...register('name')} />
          )}
        </Field>
        <Field label="Company name" error={errors.accountName?.message} required>
          {(id) => (
            <Input id={id} invalid={!!errors.accountName} {...register('accountName')} />
          )}
        </Field>
        <Field label="How many locations?" required>
          {() => (
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { key: 'single', title: 'Single location', blurb: 'One site.' },
                  { key: 'multi', title: 'Multiple locations', blurb: 'Two or more sites.' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setSitePlanChoice(opt.key)}
                  className={cn(
                    'flex flex-col rounded-md border p-3 text-left transition',
                    sitePlan === opt.key
                      ? 'border-accent bg-accent-soft'
                      : 'border-border bg-card hover:bg-content',
                  )}
                >
                  <span className="text-sm font-medium text-ink">{opt.title}</span>
                  <span className="text-xs text-ink-muted">{opt.blurb}</span>
                </button>
              ))}
            </div>
          )}
        </Field>
        <Field
          label="First location"
          hint="e.g. Highway 40 — you can add more later"
          error={errors.locationName?.message}
          required
        >
          {(id) => (
            <Input id={id} invalid={!!errors.locationName} {...register('locationName')} />
          )}
        </Field>
        <Field label="Work email" error={errors.email?.message} required>
          {(id) => (
            <Input id={id} type="email" autoComplete="email" invalid={!!errors.email} {...register('email')} />
          )}
        </Field>
        <Field label="Password" error={errors.password?.message} required>
          {(id) => (
            <Input id={id} type="password" autoComplete="new-password" invalid={!!errors.password} {...register('password')} />
          )}
        </Field>
        <Field label="Mobile number" hint="Optional — only needed if you want text alerts" error={errors.phone?.message}>
          {(id) => (
            <Input id={id} type="tel" autoComplete="tel" placeholder="(806) 555-1234" invalid={!!errors.phone} {...register('phone')} />
          )}
        </Field>
        <label className="flex items-start gap-2 text-xs leading-relaxed text-ink-muted">
          <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-accent" {...register('smsConsent')} />
          <span>
            I agree to receive recurring automated account and informational text messages from Mighty Wash at the mobile number above.
            Consent is not a condition of signing up. Message frequency varies. Message &amp; data rates may apply. Reply STOP to opt out, HELP for help. See our{' '}
            <a href="/mighty-wash/sms-terms" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">SMS Terms</a>
            {' '}&amp;{' '}
            <a href="/mighty-wash/sms-privacy" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Privacy Policy</a>.
          </span>
        </label>
        {formError && (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="size-4 animate-spin" />}
          Create account
        </Button>
        <p className="text-center text-xs text-ink-muted">
          By creating an account, you agree to our{' '}
          <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Terms of Service</a>
          {' '}and{' '}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Privacy Policy</a>.
        </p>
      </form>
    </AuthLayout>
  )
}
