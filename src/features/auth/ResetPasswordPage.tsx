import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AuthLayout } from '@/features/auth/AuthLayout'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

const schema = z
  .object({
    password: z.string().min(8, 'At least 8 characters'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  })
type Values = z.infer<typeof schema>

// Reached via the password-reset email link. Supabase puts a recovery session
// in the URL hash, which the client picks up (detectSessionInUrl).
export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), mode: 'onBlur' })

  const onSubmit = async (values: Values) => {
    setFormError(null)
    const { error } = await supabase.auth.updateUser({ password: values.password })
    if (error) {
      setFormError(error.message)
      return
    }
    navigate('/app/dashboard', { replace: true })
  }

  return (
    <AuthLayout title="Set a new password">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <Field label="New password" error={errors.password?.message} required>
          {(id) => (
            <Input id={id} type="password" autoComplete="new-password" invalid={!!errors.password} {...register('password')} />
          )}
        </Field>
        <Field label="Confirm password" error={errors.confirm?.message} required>
          {(id) => (
            <Input id={id} type="password" autoComplete="new-password" invalid={!!errors.confirm} {...register('confirm')} />
          )}
        </Field>
        {formError && (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="size-4 animate-spin" />}
          Update password
        </Button>
      </form>
    </AuthLayout>
  )
}
