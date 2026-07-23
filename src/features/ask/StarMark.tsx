import { cn } from '@/lib/utils'

// The assistant's mark: a four-point sparkle. When `active` it turns slowly,
// breathes, and throws off two satellites twinkling out of phase, so a long
// answer still reads as something in motion rather than a frozen icon.
export function StarMark({
  active = false,
  className,
}: {
  active?: boolean
  className?: string
}) {
  return (
    <span
      className={cn('relative inline-flex items-center justify-center', className)}
      aria-hidden="true"
    >
      <span className={cn('inline-flex size-full', active && 'ai-breathe')}>
        <svg viewBox="0 0 24 24" className={cn('size-full', active && 'ai-spin')}>
          <path
            d="M12 1.2c.62 5.35 5.43 10.16 10.8 10.8-5.37.64-10.18 5.45-10.8 10.8-.62-5.35-5.43-10.16-10.8-10.8C6.57 11.36 11.38 6.55 12 1.2Z"
            fill="currentColor"
          />
        </svg>
      </span>
      {active && (
        <>
          <span
            className="ai-twinkle absolute -right-1 -top-1 size-1.5 rounded-full bg-current"
            style={{ animationDelay: '0.4s' }}
          />
          <span
            className="ai-twinkle absolute -bottom-1 -left-1 size-1 rounded-full bg-current opacity-70"
            style={{ animationDelay: '1.1s' }}
          />
        </>
      )}
    </span>
  )
}
