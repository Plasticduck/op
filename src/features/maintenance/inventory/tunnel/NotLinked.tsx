import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, Pencil, X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import type { TunnelAsset, TunnelData, TunnelItem } from '@/lib/queries/miTunnel'
import { cn } from '@/lib/utils'
import { EQUIPMENT_BASE, shortName, STATUS } from '../equipment/format'
import { shapeFor } from './shapes'

// What "33 of 37 shapes linked" leaves out, opened from that line: the shapes with no
// machine behind them, and the site's machines that have no shape. A shape is picked the
// way it is on the drawing, so its panel opens where it can be linked; a machine opens its
// own page, and the way back comes back to this list.

type Unplaced = TunnelData['unplaced'][number]

type Props = {
  id: string
  // Shapes with no machine, entrance to exit.
  shapes: TunnelItem[]
  unplaced: Unplaced[]
  // The machines linked to a shape on this drawing.
  assets: Record<string, TunnelAsset>
  selectedId: string | null
  canEdit: boolean
  onPick: (id: string) => void
  // Opens the editor, whose list of the site's machines adds them. Left out where the
  // editor can't open (no rights, or a phone).
  onPlace?: () => void
  onClose: () => void
}

// A shape with a machine type is one the template tried to link. Usually the site has no
// machine of that type. One among the machines with no shape is the better thing to say,
// since it can be linked here. Failing that, one already on the drawing: a copied shape
// keeps its type but not its machine, and "No Top Brush 1" next to the Top Brush 1 is false.
function why(item: TunnelItem, unplaced: Unplaced[], drawn: TunnelAsset[]): string | null {
  const type = item.match_type?.trim()
  if (!type) return null
  const is = (t: string | null | undefined) => t?.trim().toLowerCase() === type.toLowerCase()
  const here = unplaced.find((u) => is(u.type))
  if (here) return `${shortName(here.name)} is here, not linked yet`
  const there = drawn.find((a) => is(a.type))
  return there ? `${shortName(there.name)} is already on the drawing` : `No ${type} at this site`
}

const ROW = 'flex min-h-11 w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:min-h-10'

export function NotLinked({ id, shapes, unplaced, assets, selectedId, canEdit, onPick, onPlace, onClose }: Props) {
  const here = useLocation()
  // The address already says the list is open, so coming back opens it again.
  const backTo = `${here.pathname}${here.search}`
  const drawn = Object.values(assets)

  return (
    <section id={id} aria-labelledby={`${id}-title`} className="rounded-md border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border py-1 pl-3 pr-1">
        <h2 id={`${id}-title`} className="min-w-0 flex-1 text-sm font-semibold text-ink">What's not linked</h2>
        <button type="button" onClick={onClose} aria-label="Close what's not linked"
          className="grid size-9 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <X className="size-4" />
        </button>
      </div>

      <div className="flex flex-col gap-4 p-3">
        {shapes.length === 0 && unplaced.length === 0 && (
          <p className="text-sm text-ink-muted">Every shape is linked to a machine, and every machine at this site is on the drawing.</p>
        )}

        {shapes.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <h3 className="text-xs font-semibold text-ink">Shapes with no machine ({shapes.length})</h3>
              <p className="text-xs text-ink-muted">{canEdit ? 'Pick one to link its machine, or add it.' : 'A manager can link them.'}</p>
            </div>
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
              {shapes.map((i) => {
                const on = i.id === selectedId
                const sub = [i.zone, why(i, unplaced, drawn)].filter(Boolean).join(' · ')
                return (
                  <li key={i.id} className="min-w-0">
                    <button type="button" aria-pressed={on} onClick={() => onPick(i.id)}
                      className={cn(ROW, on ? 'border-accent/50 bg-accent-soft' : 'border-border hover:bg-content')}>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate', on ? 'font-medium text-accent' : 'text-ink')}>{i.label || shapeFor(i.kind).label}</span>
                        {sub && <span className="block truncate text-xs text-ink-muted">{sub}</span>}
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-ink-subtle" aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {unplaced.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <h3 className="text-xs font-semibold text-ink">Machines at this site not on the drawing ({unplaced.length})</h3>
              {onPlace && <Button size="sm" variant="secondary" onClick={onPlace}><Pencil className="size-3.5" /> Add them to the drawing</Button>}
            </div>
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
              {unplaced.map((m) => {
                const s = STATUS[m.status]
                const name = shortName(m.name)
                // MaintainX names most machines after their type: once is enough.
                const sub = [m.type?.toLowerCase() === name.toLowerCase() ? null : m.type, m.area_name].filter(Boolean).join(' · ')
                return (
                  <li key={m.id} className="min-w-0">
                    <Link to={`${EQUIPMENT_BASE}/${m.id}`} state={{ from: { to: backTo, label: 'Back to tunnel' } }}
                      className={cn(ROW, 'border-border hover:bg-content')}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ink">{name}</span>
                        {sub && <span className="block truncate text-xs text-ink-muted">{sub}</span>}
                      </span>
                      <Badge tone={s?.tone ?? 'neutral'} className="shrink-0">{s?.short ?? m.status}</Badge>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
