import { NavLink } from 'react-router-dom'
import { Check, Lock } from 'lucide-react'
import { levelStatus, type OutlineLevel } from '@/lib/queries/academy'
import { cn } from '@/lib/utils'
import { levelPath, useAcademy } from './context'

// Which levels this one needs, and whether each is done.
export function PrereqNote({ level }: { level: OutlineLevel }) {
  const { progress, outline, trainee } = useAcademy()
  const all = outline?.allLevels ?? []
  const needs = level.requires.map((id) => all.find((l) => l.id === id)).filter((l): l is OutlineLevel => !!l && l.active)
  if (!needs.length) return null
  const open = needs.filter((n) => !levelStatus(n, progress).finished)
  return (
    <div className={cn('rounded-xl border px-4 py-3 text-sm', open.length ? 'border-warn/50 bg-warn-soft' : 'border-ok/50 bg-ok-soft')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <b className="text-ink">{level.short_title} requires:</b>
        {needs.map((n) => {
          const ok = !open.includes(n)
          return (
            <NavLink key={n.id} to={levelPath(n.key)} className={cn('inline-flex items-center gap-1 font-medium hover:underline', ok ? 'text-ok' : 'text-warn')}>
              {ok ? <Check className="size-4" /> : <Lock className="size-4" />} {n.title}
            </NavLink>
          )
        })}
      </div>
      {open.length > 0 && (
        <p className="mt-1 text-ink-muted">
          {trainee ? 'They' : 'You'} can work through it now, but it can't be signed off until {open.map((n) => n.short_title).join(' and ')} {open.length > 1 ? 'are' : 'is'} complete.
        </p>
      )}
    </div>
  )
}
