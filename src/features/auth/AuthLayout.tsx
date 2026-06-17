import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '@/components/ui/Logo'
import { isNativeShell } from '@/lib/nativeBridge'

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  // In the iOS native shell there is no marketing/homepage to land on, so the
  // logo is rendered as plain art instead of a link. On the web it stays a
  // link to "/" so visitors can bounce back to the landing page.
  const native = isNativeShell()
  const logo = (
    <div className="mb-8 flex items-center justify-center">
      <Logo size="lg" />
    </div>
  )

  return (
    <div className="grid min-h-dvh place-items-center bg-content px-4 py-10">
      <div className="w-full max-w-sm">
        {native ? logo : <Link to="/">{logo}</Link>}
        <div className="rounded-md border border-border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-ink">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {footer && (
          <div className="mt-4 text-center text-sm text-ink-muted">{footer}</div>
        )}
      </div>
    </div>
  )
}
