import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-medium ' +
    'transition focus-visible:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-accent focus-visible:ring-offset-2 ' +
    'focus-visible:ring-offset-content disabled:opacity-50 ' +
    'disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-white hover:bg-accent-hover',
        secondary:
          'bg-card border border-border text-ink hover:bg-content',
        ghost: 'text-ink-muted hover:bg-border/40 hover:text-ink',
        danger: 'bg-danger text-white hover:opacity-90',
        link: 'text-accent hover:underline underline-offset-2 px-0 h-auto',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-11 px-5 text-base',
        icon: 'h-9 w-9 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button>

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ className, variant, size, ...props }, ref) {
    return (
      <button
        ref={ref}
        className={cn(button({ variant, size }), className)}
        {...props}
      />
    )
  },
)
