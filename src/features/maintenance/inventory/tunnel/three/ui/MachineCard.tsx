import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, Link2, Minus, Plus, X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { day } from '../../../format'
import { cars, shortName } from '../../../equipment/format'
import { shapeFor } from '../../shapes'
import { alongText, statusOf, type Machine } from './machines'

// The card for the selected machine: enough to answer "what is this and is it all right"
// without leaving the tunnel, and the way on to its own page. Docked in the canvas's
// bottom left corner; on a narrow canvas (a phone) it is a sheet along the bottom, kept
// short so the machine stays in view above it.

type Props = {
  machine: Machine
  // The person may link machines and arrange them.
  canMove: boolean
  // Machines are being arranged and this one can be moved: show where it stands.
  stepper: boolean
  // The page's round Scan button may float over the bottom right corner (a phone, the
  // view inline in the page): keep the corner free.
  clearCorner: boolean
  // The page's unsaved-moves bar takes room from a phone's sheet: the facts keep to one
  // line, which scrolls sideways, so the card still fits with its buttons.
  oneLine?: boolean
  onOpen: () => void
  onDetails?: () => void
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  onNudge: (dir: -1 | 1) => void
}

const ICON = 'grid size-9 shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-content hover:text-ink ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent @max-[520px]:size-11 pointer-coarse:size-11'
const ACTION = 'shrink-0 whitespace-nowrap @max-[520px]:h-11 pointer-coarse:h-11'

// One fact: a row on the docked card, an inline pair on the sheet.
function Fact({ label, tone, children }: { label: string; tone?: 'ok' | 'warn' | 'danger'; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5 @min-[640px]:justify-between @min-[640px]:gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={cn('font-medium tabular-nums', tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : 'text-ink')}>{children}</dd>
    </div>
  )
}

export function MachineCard({ machine, canMove, stepper, clearCorner, oneLine, onOpen, onDetails, onPrev, onNext, onClose, onNudge }: Props) {
  const { item, asset, name } = machine
  const shape = shapeFor(item.kind)
  const status = asset ? statusOf(asset) : null
  const machineName = asset ? shortName(asset.name) : null
  const sub = asset
    ? [machineName !== name ? machineName : null, asset.type && asset.type !== machineName && asset.type !== name ? asset.type : null, asset.area_name ?? item.zone].filter(Boolean).join(' · ')
    : [shape.label !== name ? shape.label : null, item.zone].filter(Boolean).join(' · ')
  const actions = !!asset || (canMove && !!onDetails)

  return (
    // Squeezed (a phone, with the page's bar above it) the facts keep to one line, and
    // scroll first if even that doesn't fit; with less room than the header and the
    // buttons need, the whole card scrolls rather than lose its bottom edge. Docked, the scene frames the selected machine beside or above it
    // (data-t3d-inset, see cues.ts insetOf), and the name chip keeps out from under it.
    <section data-t3d="card" data-t3d-keepout data-t3d-inset="corner" aria-label={`Selected: ${name}`}
      className={cn('pointer-events-auto flex max-h-full min-h-0 flex-col overflow-y-auto overscroll-contain border-border bg-card text-sm shadow-lg',
        'rounded-t-xl border-t @min-[640px]:w-[21.5rem] @min-[640px]:rounded-xl @min-[640px]:border')}>
      {/* The way to the next machine sits up here by the close button, so the bottom row
          holds only the actions and its right end stays free. */}
      <div className="flex items-center gap-2 pl-3 pr-1.5 pt-1.5">
        {/* The status rides beside the name, or where a phone's 44 px buttons leave the
            name little room, at the end of the second line. */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 truncate text-[15px] font-semibold leading-tight text-ink">{name}</h3>
            {status && <Badge tone={status.tone} className="shrink-0 @max-[520px]:hidden">{status.label}</Badge>}
          </div>
          {(sub || status) && (
            <div className="mt-0.5 flex items-center gap-2">
              <span className="min-w-0 truncate text-xs text-ink-muted">{sub}</span>
              {status && <Badge tone={status.tone} className="shrink-0 @min-[520px]:hidden">{status.short}</Badge>}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center">
          <button type="button" onClick={onPrev} aria-label="Previous machine" title="Previous machine, toward the entrance" className={ICON}><ChevronLeft className="size-[18px]" /></button>
          <button type="button" onClick={onNext} aria-label="Next machine" title="Next machine, toward the exit" className={ICON}><ChevronRight className="size-[18px]" /></button>
          <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
          <button type="button" onClick={onClose} aria-label="Close" title="Close (Escape)" className={ICON}><X className="size-[18px]" /></button>
        </div>
      </div>

      {/* The last thing on a phone's sheet keeps clear of the home bar when full screen. */}
      <div className={cn('min-h-0 overflow-y-auto px-3 pb-2.5 pt-2', (!actions || stepper) && '@max-[640px]:pb-[calc(0.625rem+var(--t3d-bottom))]')}>
        {asset ? (
          <dl className={cn('flex flex-wrap gap-x-4 gap-y-0.5 text-xs @min-[640px]:flex-col @min-[640px]:flex-nowrap @min-[640px]:gap-y-1', stepper && '@max-[640px]:hidden',
            // Cut off at the right edge, faded so it reads as more to the side.
            oneLine && '@max-[520px]:-mr-3 @max-[520px]:flex-nowrap @max-[520px]:overflow-x-auto @max-[520px]:whitespace-nowrap @max-[520px]:pr-6 @max-[520px]:[mask-image:linear-gradient(to_left,transparent,black_1.5rem)] @max-[520px]:[scrollbar-width:none] @max-[520px]:[&>*]:shrink-0')}>
            {asset.cars_since != null
              ? <Fact label={asset.usage_since ? `Cars since ${day(asset.usage_since)}` : 'Cars since its start date'}>{cars(asset.cars_since)}</Fact>
              : <Fact label="Cars">{asset.usage_state === 'not_counted' || asset.usage_basis === 'none' ? 'Not counted' : 'No start date yet'}</Fact>}
            <Fact label="Open work orders" tone={asset.open_wos > 0 ? 'warn' : undefined}>{asset.open_wos}</Fact>
            <Fact label="Sticker" tone={asset.tag_printed ? 'ok' : asset.tag ? 'warn' : 'danger'}>
              {asset.tag_printed ? 'Printed' : asset.tag ? 'Tag made, not printed' : 'None'}
            </Fact>
            <Fact label="Components">{asset.children}</Fact>
            {asset.last_serviced_at && <Fact label="Last serviced">{day(asset.last_serviced_at)}</Fact>}
          </dl>
        ) : (
          <p className="text-xs text-ink-muted">
            No machine linked yet.{!(canMove && onDetails) && ' A manager can link it.'}
          </p>
        )}

        {/* The steppers lead, so the right edge (under the Scan button on a phone) has
            only words. */}
        {stepper && (
          <div className="flex items-center gap-2.5 @min-[640px]:mt-2 @min-[640px]:border-t @min-[640px]:border-border @min-[640px]:pt-2">
            <div className="flex shrink-0 rounded-md border border-border">
              <button type="button" onClick={() => onNudge(-1)} aria-label="Move half a foot toward the entrance" title="Half a foot toward the entrance (Left)" className={ICON}><Minus className="size-4" /></button>
              <span aria-hidden className="w-px bg-border" />
              <button type="button" onClick={() => onNudge(1)} aria-label="Move half a foot toward the exit" title="Half a foot toward the exit (Right)" className={ICON}><Plus className="size-4" /></button>
            </div>
            <span className="min-w-0 flex-1 text-xs font-semibold tabular-nums text-ink">{alongText(Number(item.x_ft))}</span>
          </div>
        )}
      </div>

      {/* While arranging on a phone the card is just the name and the steppers: the
          buttons come back when move mode is off. */}
      {actions && (
        <div className={cn('flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2 @max-[640px]:pb-[calc(0.5rem+var(--t3d-bottom))]',
          clearCorner && '@max-[640px]:pr-16', stepper && '@max-[640px]:hidden')}>
          {asset ? (
            <>
              <Button size="sm" onClick={onOpen} className={ACTION}><ExternalLink className="size-3.5" /> Open machine</Button>
              {onDetails && <Button size="sm" variant="secondary" onClick={onDetails} className={ACTION}>Details</Button>}
            </>
          ) : (
            <Button size="sm" onClick={onDetails} className={ACTION}><Link2 className="size-3.5" /> Link a machine</Button>
          )}
        </div>
      )}
    </section>
  )
}
