import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// What stands in for the 3D view while its code and its first frame are on the way: the
// page color (the scene's own backdrop), a faint slab where the tunnel will be, and a
// small chip. Fills its parent, which gives it the canvas's size. onFaded: the view fades
// it out over its first frame and takes it away when the fade is done.
export function LoadingVeil({ className, onFaded }: { className?: string; onFaded?: () => void }) {
  return (
    <div role="status" onTransitionEnd={onFaded} className={cn('absolute inset-0 grid place-items-center overflow-hidden rounded-xl bg-content', className)}>
      <div aria-hidden className="absolute left-[12%] right-[12%] top-[54%] h-[16%] -skew-x-[28deg] rounded-md bg-border/50 motion-safe:animate-pulse" />
      <div aria-hidden className="absolute left-[30%] top-[36%] h-[20%] w-[7%] -skew-x-[28deg] rounded-sm bg-border/40 motion-safe:animate-pulse" />
      <div aria-hidden className="absolute left-[46%] top-[32%] h-[24%] w-[9%] -skew-x-[28deg] rounded-sm bg-border/40 motion-safe:animate-pulse" />
      <div aria-hidden className="absolute left-[64%] top-[38%] h-[18%] w-[6%] -skew-x-[28deg] rounded-sm bg-border/40 motion-safe:animate-pulse" />
      <span className="relative inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-ink-muted shadow-sm">
        <Loader2 className="size-3.5 motion-safe:animate-spin" /> Loading 3D
      </span>
    </div>
  )
}
