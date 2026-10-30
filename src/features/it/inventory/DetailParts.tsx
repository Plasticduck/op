import { useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

// The labelled rows the asset page is built from (shared with its panels).

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{title}</div>
      <div className="divide-y divide-border rounded-md border border-border">{children}</div>
    </section>
  )
}

export function Row({ label, children, copy, mono }: { label: string; children: ReactNode; copy?: string | null; mono?: boolean }) {
  const empty = children === null || children === undefined || children === '' || children === false
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 text-sm">
      <div className="w-32 shrink-0 text-ink-muted">{label}</div>
      <div className={cn('min-w-0 flex-1 break-words', mono && 'font-mono', empty ? 'text-ink-subtle' : 'text-ink')}>{empty ? '–' : children}</div>
      {copy && <CopyButton value={copy} />}
    </div>
  )
}

export function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" aria-label="Copy" title="Copy"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        })
      }}
      className="grid size-8 shrink-0 place-items-center rounded-md text-ink-subtle hover:bg-content hover:text-ink">
      {done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
    </button>
  )
}
