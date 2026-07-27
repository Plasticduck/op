import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'
import { useAuth } from '@/lib/auth'
import { AuthLayout } from '@/features/auth/AuthLayout'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

const schema = z.object({
  password: z.string().min(8, 'At least 8 characters'),
})
type Values = z.infer<typeof schema>

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { refreshProfile } = useAuth()
  const [email, setEmail] = useState<string | null>(null)
  const [name, setName] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), mode: 'onBlur' })

  useEffect(() => {
    let active = true
    // Name was captured when the invite was created, so we don't ask again --
    // just confirm the invite is valid and greet them by name.
    supabase
      .rpc('get_invitation_info', { p_token: token ?? '' })
      .then(({ data }) => {
        if (!active) return
        const info = data as { email: string; name: string | null } | null
        setEmail(info?.email ?? null)
        setName(info?.name ?? null)
        setChecking(false)
      })
    return () => {
      active = false
    }
  }, [token])

  const onSubmit = async (values: Values) => {
    setFormError(null)
    if (!email) return

    // Server-side acceptance: creates the login (or sets the password on an
    // existing one) AND the profile atomically, so a re-invited email that
    // already has a login no longer strands the user without an account.
    const { data, error } = await supabase.functions.invoke('accept-invite', {
      body: { token: token ?? '', password: values.password },
    })
    if (error) {
      setFormError(await fnErrorMessage(error, data as { message?: string; error?: string } | null, 'Could not finish joining'))
      return
    }
    const res = data as { ok?: boolean; alreadyMember?: boolean; error?: string; message?: string }
    if (!res?.ok) {
      setFormError(res?.message || res?.error || 'Could not finish joining')
      return
    }
    if (res.alreadyMember) {
      // They already have an account in this team; sign in with their own password.
      navigate('/login', { replace: true })
      return
    }

    // Sign in with the password they just set to establish the session.
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password: values.password })
    if (signInErr) {
      setFormError(signInErr.message)
      return
    }
    await refreshProfile()
    navigate('/app/dashboard', { replace: true })
  }

  if (checking) {
    return (
      <AuthLayout title="Checking your invite…">
        <div className="grid place-items-center py-6 text-ink-muted">
          <Loader2 className="size-5 animate-spin" />
        </div>
      </AuthLayout>
    )
  }

  if (!email) {
    return (
      <AuthLayout
        title="Invite not valid"
        subtitle="This invitation link is invalid, already used, or expired."
        footer={
          <Link to="/login" className="font-medium text-accent hover:underline">
            Go to sign in
          </Link>
        }
      >
        <p className="text-sm text-ink-muted">
          Ask your account admin to send a fresh invite.
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title={name ? `Welcome, ${name.split(' ')[0]}` : 'Join your team'}
      subtitle={`You were invited as ${email}. Create a password to finish joining.`}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <Field label="Email">
          {(id) => <Input id={id} value={email} disabled readOnly />}
        </Field>
        <Field label="Password" error={errors.password?.message} required>
          {(id) => (
            <Input id={id} type="password" autoComplete="new-password" invalid={!!errors.password} {...register('password')} />
          )}
        </Field>
        {formError && (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="size-4 animate-spin" />}
          Join team
        </Button>
      </form>
    </AuthLayout>
  )
}
