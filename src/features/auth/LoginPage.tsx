import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AuthLayout } from '@/features/auth/AuthLayout'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
})
type Values = z.infer<typeof schema>

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), mode: 'onBlur' })

  const onSubmit = async (values: Values) => {
    setFormError(null)
    const { error } = await supabase.auth.signInWithPassword(values)
    if (error) {
      setFormError(error.message)
      return
    }
    const dest =
      (location.state as { from?: string } | null)?.from ?? '/app/dashboard'
    navigate(dest, { replace: true })
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back. Enter your credentials to continue."
      footer={
        <>
          No account?{' '}
          <Link to="/signup" className="font-medium text-accent hover:underline">
            Start a free trial
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <Field label="Email" error={errors.email?.message} required>
          {(id) => (
            <Input
              id={id}
              type="email"
              autoComplete="email"
              invalid={!!errors.email}
              {...register('email')}
            />
          )}
        </Field>
        <Field label="Password" error={errors.password?.message} required>
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              invalid={!!errors.password}
              {...register('password')}
            />
          )}
        </Field>
        <div className="-mt-1 text-right">
          <Link
            to="/forgot-password"
            className="text-xs text-ink-muted hover:text-ink"
          >
            Forgot password?
          </Link>
        </div>
        {formError && (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="size-4 animate-spin" />}
          Sign in
        </Button>
      </form>
    </AuthLayout>
  )
}
