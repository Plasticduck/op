import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { AuthLayout } from '@/features/auth/AuthLayout'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

const schema = z.object({
  name: z.string().min(1, 'Enter your name'),
  accountName: z.string().min(1, 'Enter your company name'),
  locationName: z.string().min(1, 'Enter your first location'),
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters'),
})
type Values = z.infer<typeof schema>

export default function SignupPage() {
  const navigate = useNavigate()
  const { refreshProfile } = useAuth()
  const [formError, setFormError] = useState<string | null>(null)
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

    const { error: rpcError } = await supabase.rpc('signup_account', {
      p_account_name: values.accountName,
      p_location_name: values.locationName,
      p_user_name: values.name,
    })
    if (rpcError) {
      setFormError(rpcError.message)
      return
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
        {formError && (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="size-4 animate-spin" />}
          Create account
        </Button>
      </form>
    </AuthLayout>
  )
}
