import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { SITE_URL } from '@/lib/siteUrl'
import { AuthLayout } from '@/features/auth/AuthLayout'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

const schema = z.object({ email: z.string().email('Enter a valid email') })
type Values = z.infer<typeof schema>

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), mode: 'onBlur' })

  const onSubmit = async (values: Values) => {
    await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: `${SITE_URL}/reset-password`,
    })
    // Always show success — don't leak whether an email exists.
    setSent(true)
  }

  return (
    <AuthLayout
      title="Reset password"
      subtitle="We'll email you a link to set a new password."
      footer={
        <Link to="/login" className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="flex items-start gap-2 rounded-md bg-ok-soft px-3 py-3 text-sm text-ok">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>
            If an account exists for that email, a reset link is on its way.
          </span>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <Field label="Email" error={errors.email?.message} required>
            {(id) => (
              <Input id={id} type="email" autoComplete="email" invalid={!!errors.email} {...register('email')} />
            )}
          </Field>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
