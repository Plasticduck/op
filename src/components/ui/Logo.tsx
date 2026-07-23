import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

// Two brand lockups:
//   - operator (default): the "OPERATOR" wordmark used everywhere inside the
//     authenticated app (sidebar, topbar, dashboard, kiosk) and on the auth
//     pages (login, signup, accept-invite).
//   - washlyfe: the older "WASH LYFE" lockup kept only on the public
//     marketing surface (landing, pricing, demo, legal) since those pages
//     pre-date the rebrand.
//
// Both ship as a pair of pre-rendered PNGs: a dark-on-light variant and a
// light-on-dark variant. The light-on-dark (white wordmark) one is used
// whenever the surface underneath is dark: either because the caller passed
// `invert` (the sidebar rail and kiosk are dark in both themes) or because the
// app is in dark mode, where the dark-ink wordmark would be unreadable.

const WIDTHS: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'w-20',
  md: 'w-28',
  lg: 'w-32',
}

type Brand = 'operator' | 'washlyfe'

const SRC: Record<Brand, { light: string; dark: string; alt: string }> = {
  operator: {
    light: '/operator-logo-dark.png',   // dark wordmark on light bg
    dark: '/operator-logo-white.png',   // white wordmark on dark bg
    alt: 'Operator',
  },
  washlyfe: {
    light: '/washlyfe-logo.png',
    dark: '/washlyfe-logo-dark.png',
    alt: 'WashLyfe',
  },
}

export function Logo({
  className,
  invert = false,
  size = 'md',
  brand = 'operator',
}: {
  className?: string
  invert?: boolean
  size?: 'sm' | 'md' | 'lg'
  brand?: Brand
}) {
  const { resolved } = useTheme()
  const src = SRC[brand]
  const onDark = invert || resolved === 'dark'
  return (
    <span className={cn('inline-block max-w-full', WIDTHS[size], className)}>
      <img
        src={onDark ? src.dark : src.light}
        alt={src.alt}
        className="block h-auto w-full object-contain"
      />
    </span>
  )
}
