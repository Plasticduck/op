import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type Ref } from 'react'
import type { TunnelAsset, TunnelItem, TunnelLayout } from '@/lib/queries/miTunnel'
import { cn } from '@/lib/utils'
import { cars, shortName, STATUS } from '../equipment/format'
import { groupTransform, labelVertical, layoutBox, toScreen, viewBox, type Orientation } from './geometry'
import { shapeFor } from './shapes'

// The top-down tunnel. Hovering (or tabbing to) a machine lights up every shape linked
// to it and dims the rest; clicking or Enter opens it. Shapes are drawn in layout feet
// inside one transformed group, so the editor can turn pointer positions back into feet;
// names are drawn on top, upright, in screen units.

export type ColorBy = 'status' | 'usage' | 'wos' | 'sticker'

const TONE = {
  ok: 'fill-ok-soft stroke-ok',
  warn: 'fill-warn-soft stroke-warn',
  danger: 'fill-danger-soft stroke-danger',
  accent: 'fill-accent-soft stroke-accent',
  quiet: 'fill-card stroke-ink-muted',
  placeholder: 'fill-card stroke-ink-subtle [stroke-dasharray:0.6_0.4]',
  retired: 'fill-border stroke-ink-subtle [stroke-dasharray:0.6_0.4]',
  scenery: 'fill-content stroke-border-strong',
} as const
const HEAT = ['fill-accent/10', 'fill-accent/25', 'fill-accent/45', 'fill-accent/65', 'fill-accent/85']

const FONT = 1.25

type Props = {
  layout: Pick<TunnelLayout, 'length_ft' | 'width_ft' | 'zones'>
  items: TunnelItem[]
  assets: Record<string, TunnelAsset>
  orientation: Orientation
  colorBy: ColorBy
  selectedId: string | null
  onSelect: (id: string | null) => void
  editing?: boolean
  onItemPointerDown?: (e: PointerEvent<SVGGElement>, item: TunnelItem) => void
  onBackgroundPointerDown?: () => void
  shapesRef?: Ref<SVGGElement>
  className?: string
}

export function TunnelDiagram({ layout, items, assets, orientation: o, colorBy, selectedId, onSelect, editing, onItemPointerDown, onBackgroundPointerDown, shapesRef, className }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const nodes = useRef(new Map<string, SVGGElement>())
  const [hover, setHover] = useState<{ id: string; x: number; y: number; w: number } | null>(null)
  const half = Number(layout.width_ft) / 2

  const box = useMemo(() => {
    const b = layoutBox(layout, items)
    return { ...b, minY: Math.min(b.minY, -half - 18), maxY: Math.max(b.maxY, half + 14) }
  }, [layout, items, half])
  const vb = viewBox(o, box)

  // Draw scenery under machines, then in the saved order.
  const ordered = useMemo(() => [...items].sort((a, b) => Number(!!shapeFor(b.kind).scenery) - Number(!!shapeFor(a.kind).scenery) || a.sort_order - b.sort_order), [items])
  const focusOrder = useMemo(() => ordered.filter((i) => !shapeFor(i.kind).scenery).sort((a, b) => Number(a.x_ft) - Number(b.x_ft) || Number(a.y_ft) - Number(b.y_ft)), [ordered])

  // Use-count shading is relative to the busiest machine on this drawing.
  const maxCars = useMemo(() => Math.max(0, ...items.map((i) => (i.asset_id ? assets[i.asset_id]?.cars_since ?? 0 : 0))), [items, assets])

  const hovered = hover ? items.find((i) => i.id === hover.id) : undefined
  const hoverKey = hovered ? hovered.asset_id ?? hovered.id : null
  const selected = selectedId ? items.find((i) => i.id === selectedId) : undefined
  const selectedKey = selected ? selected.asset_id ?? selected.id : null

  const toneFor = (i: TunnelItem): string => {
    const s = shapeFor(i.kind)
    if (s.scenery) return TONE.scenery
    const a = i.asset_id ? assets[i.asset_id] : undefined
    if (!a) return TONE.placeholder
    if (a.status === 'retired') return TONE.retired
    if (colorBy === 'status') return a.status === 'offline_unplanned' ? TONE.danger : a.status === 'offline_planned' ? TONE.warn : TONE.ok
    if (colorBy === 'wos') return a.open_wos >= 2 ? TONE.danger : a.open_wos === 1 ? TONE.warn : TONE.quiet
    if (colorBy === 'sticker') return a.tag_printed ? TONE.ok : a.tag ? TONE.warn : TONE.danger
    if (a.cars_since == null || !maxCars) return TONE.quiet
    return `${HEAT[Math.min(HEAT.length - 1, Math.floor((a.cars_since / maxCars) * HEAT.length))]} stroke-accent`
  }

  const showTip = (i: TunnelItem, clientX: number, clientY: number) => {
    const r = wrap.current?.getBoundingClientRect()
    if (!r) return
    setHover({ id: i.id, x: clientX - r.left, y: clientY - r.top, w: r.width })
  }
  const keyNav = (e: KeyboardEvent<SVGGElement>, i: TunnelItem) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(i.id); return }
    if (editing) return
    const k = focusOrder.findIndex((x) => x.id === i.id)
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = focusOrder[(k + step + focusOrder.length) % focusOrder.length]
    nodes.current.get(next.id)?.focus()
  }

  const tipAsset = hovered?.asset_id ? assets[hovered.asset_id] : undefined

  return (
    <div ref={wrap} className={cn('relative', className)}>
      <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="block h-auto w-full touch-manipulation select-none" role="group"
        aria-label="Tunnel diagram. Tab to a machine, Enter to open it." onPointerDown={(e) => { if (e.target === e.currentTarget) onBackgroundPointerDown?.() }}>
        <g ref={shapesRef} transform={groupTransform(o)}>
          <Scenery layout={layout} box={box} o={o} />
          {ordered.map((i) => {
            const s = shapeFor(i.kind)
            const w = Number(i.w_ft)
            const h = Number(i.h_ft)
            const interactive = !s.scenery || editing
            const key = i.asset_id ?? i.id
            const lit = (hoverKey && key === hoverKey) || (selectedKey && key === selectedKey)
            const dim = !!hoverKey && !lit && !s.scenery
            const a = i.asset_id ? assets[i.asset_id] : undefined
            const name = i.label || (a ? shortName(a.name) : s.label)
            return (
              <g key={i.id}
                ref={(el) => { if (el) nodes.current.set(i.id, el); else nodes.current.delete(i.id) }}
                transform={`translate(${Number(i.x_ft)} ${Number(i.y_ft)}) rotate(${i.rotation})`}
                className={cn(toneFor(i), 'outline-none transition-opacity duration-150', dim && 'opacity-35')}
                role={interactive ? 'button' : undefined}
                tabIndex={interactive ? 0 : undefined}
                aria-label={interactive ? `${name}${a ? `, ${STATUS[a.status]?.label ?? a.status}` : ', not linked to a machine'}` : undefined}
                aria-pressed={interactive ? selectedId === i.id : undefined}
                style={{ cursor: editing ? 'move' : interactive ? 'pointer' : 'default' }}
                onPointerEnter={(e) => { if (!s.scenery && e.pointerType === 'mouse') showTip(i, e.clientX, e.clientY) }}
                onPointerMove={(e) => { if (!s.scenery && e.pointerType === 'mouse' && !editing) showTip(i, e.clientX, e.clientY) }}
                onPointerLeave={() => setHover((x) => (x?.id === i.id ? null : x))}
                onFocus={(e) => {
                  if (s.scenery) return
                  const r = e.currentTarget.getBoundingClientRect()
                  showTip(i, r.left + r.width / 2, r.top)
                }}
                onBlur={() => setHover((x) => (x?.id === i.id ? null : x))}
                onPointerDown={(e) => { if (editing) onItemPointerDown?.(e, i) }}
                onClick={(e) => { e.stopPropagation(); if (interactive && !editing) onSelect(i.id) }}
                onKeyDown={(e) => keyNav(e, i)}>
                {lit && !s.scenery && (
                  <rect x={-w / 2 - 0.8} y={-h / 2 - 0.8} width={w + 1.6} height={h + 1.6} rx={0.8}
                    className={cn('fill-accent/15 stroke-accent', selectedId === i.id && 'fill-accent/25')} strokeWidth={0.35} />
                )}
                {s.draw(w, h, i.props ?? {}, i.side)}
                {/* Thin shapes (a photo eye's beam) still need a decent target. */}
                <rect x={-Math.max(w, 2) / 2} y={-Math.max(h, 2) / 2} width={Math.max(w, 2)} height={Math.max(h, 2)} fill="transparent" stroke="none" />
                {editing && selectedId === i.id && (
                  <rect x={-w / 2 - 0.5} y={-h / 2 - 0.5} width={w + 1} height={h + 1} className="fill-none stroke-accent" strokeWidth={0.25} strokeDasharray="0.6 0.4" />
                )}
              </g>
            )
          })}
        </g>
        <Labels items={ordered} assets={assets} o={o} half={half} dimKey={hoverKey} />
      </svg>

      {hover && hovered && !editing && (
        <div className="pointer-events-none absolute z-10 w-56 -translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md"
          style={{ left: Math.min(Math.max(hover.x, 112), hover.w - 112), top: hover.y }}>
          <div className="truncate text-sm font-semibold text-ink">{hovered.label || (tipAsset ? shortName(tipAsset.name) : shapeFor(hovered.kind).label)}</div>
          {tipAsset ? (
            <>
              {hovered.label && shortName(tipAsset.name) !== hovered.label && <div className="truncate text-ink-muted">{shortName(tipAsset.name)}</div>}
              <div className={cn('mt-1 font-medium', STATUS[tipAsset.status]?.tone === 'danger' ? 'text-danger' : STATUS[tipAsset.status]?.tone === 'warn' ? 'text-warn' : 'text-ok')}>
                {STATUS[tipAsset.status]?.label ?? tipAsset.status}
              </div>
              <div className="mt-0.5 text-ink-muted">
                {tipAsset.cars_since != null ? `${cars(tipAsset.cars_since)} cars since ${tipAsset.usage_since ? 'its start date' : ''}` : 'No use count start date yet'}
              </div>
              {tipAsset.open_wos > 0 && <div className="text-warn">{tipAsset.open_wos} open work order{tipAsset.open_wos === 1 ? '' : 's'}</div>}
              {tipAsset.children > 0 && <div className="text-ink-subtle">{tipAsset.children} components</div>}
            </>
          ) : (
            <div className="mt-1 text-ink-muted">Not linked to a machine yet. Click to link one.</div>
          )}
        </div>
      )}
    </div>
  )
}

// Walls, the prep lane, zone bands and names, a car for scale, the way cars go.
function Scenery({ layout, box, o }: { layout: Props['layout']; box: { minX: number; maxX: number }; o: Orientation }) {
  const L = Number(layout.length_ft)
  const half = Number(layout.width_ft) / 2
  const zones = layout.zones ?? []
  const prepFrom = Math.min(0, ...zones.map((z) => Number(z.x_from)))
  const stripY = -half - 15
  return (
    <g className="pointer-events-none">
      {/* Floor and zone bands */}
      <rect x={0} y={-half} width={L} height={half * 2} className="fill-card" />
      {zones.map((z, k) => (
        <rect key={z.name + k} x={Number(z.x_from)} y={-half} width={Number(z.x_to) - Number(z.x_from)} height={half * 2}
          className={k % 2 ? 'fill-content' : 'fill-card'} opacity={0.9} />
      ))}
      {/* Walls (the ends are open) */}
      <line x1={0} x2={L} y1={-half} y2={-half} className="stroke-ink-muted" strokeWidth={0.45} />
      <line x1={0} x2={L} y1={half} y2={half} className="stroke-ink-muted" strokeWidth={0.45} />
      {prepFrom < 0 && (
        <>
          <line x1={prepFrom} x2={0} y1={-half} y2={-half} className="stroke-border-strong" strokeWidth={0.25} strokeDasharray="1 0.8" />
          <line x1={prepFrom} x2={0} y1={half} y2={half} className="stroke-border-strong" strokeWidth={0.25} strokeDasharray="1 0.8" />
          {/* A car in the prep lane, for scale and direction */}
          <g transform={`translate(${Math.max(prepFrom + 9, -16)} 0)`} className="fill-none stroke-border-strong" strokeWidth={0.2}>
            <rect x={-7.2} y={-3.1} width={14.4} height={6.2} rx={1.6} />
            <path d="M 2.2 -2.6 Q 3.6 0 2.2 2.6 M -3.6 -2.6 Q -4.6 0 -3.6 2.6" />
          </g>
        </>
      )}
      {/* Direction of travel */}
      <path d={`M ${box.minX + 3} 0 l 4 0 m -1.4 -1.2 l 1.4 1.2 l -1.4 1.2`} className="fill-none stroke-ink-subtle" strokeWidth={0.3} />
      {/* Zone strip outside the driver's side */}
      {zones.map((z, k) => {
        const x0 = Number(z.x_from)
        const x1 = Number(z.x_to)
        const [sx, sy] = toScreen(o, (x0 + x1) / 2, stripY)
        return (
          <g key={'z' + k}>
            <line x1={x0} x2={x0} y1={stripY - 1.5} y2={-half} className="stroke-border" strokeWidth={0.15} strokeDasharray="0.5 0.5" />
            <rect x={x0 + 0.2} y={stripY - 1.4} width={Math.max(0.1, x1 - x0 - 0.4)} height={2.8} rx={0.6} className="fill-content stroke-border" strokeWidth={0.12} />
            {/* The name itself is drawn upright: undo the group's turn */}
            <g transform={o === 'v' ? `matrix(0 -1 1 0 0 0) translate(${sx} ${sy})` : `translate(${sx} ${sy})`}>
              <text textAnchor="middle" dominantBaseline="central" fontSize={1.35} fontWeight={600} className="fill-ink-muted"
                transform={o === 'v' ? 'rotate(90)' : undefined}>{z.name}</text>
            </g>
          </g>
        )
      })}
    </g>
  )
}

// Names: along the wall outside the tunnel for shapes in it (so they never overlap the
// machines), inside the tile for things beside it, top-left for rooms.
function Labels({ items, assets, o, half, dimKey }: { items: TunnelItem[]; assets: Record<string, TunnelAsset>; o: Orientation; half: number; dimKey: string | null }) {
  return (
    <g className="pointer-events-none">
      {items.map((i) => {
        const s = shapeFor(i.kind)
        if (s.label_at === 'none') return null
        const a = i.asset_id ? assets[i.asset_id] : undefined
        const text = i.label || (a ? shortName(a.name) : s.label)
        const dim = dimKey && (i.asset_id ?? i.id) !== dimKey && !s.scenery
        const cls = cn('fill-ink stroke-card [paint-order:stroke]', dim && 'opacity-35', !a && !s.scenery && 'fill-ink-muted')
        if (s.label_at === 'callout') {
          const ps = i.side === 'ps'
          const [sx, sy] = toScreen(o, Number(i.x_ft), ps ? half + 0.9 : -half - 0.9)
          // Horizontal: the text runs away from the wall, turned upright. Vertical: it already does.
          const anchor = ps ? 'end' : 'start'
          return (
            <text key={i.id} x={sx} y={sy} fontSize={FONT} textAnchor={o === 'h' ? anchor : ps ? 'end' : 'start'} dominantBaseline="central"
              transform={o === 'h' ? `rotate(-90 ${sx} ${sy})` : undefined} className={cls} strokeWidth={0.35}>
              {text}
            </text>
          )
        }
        const turned = i.rotation === 90 || i.rotation === 270
        const w = Number(turned ? i.h_ft : i.w_ft)
        const h = Number(turned ? i.w_ft : i.h_ft)
        const screenW = o === 'h' ? w : h
        const screenH = o === 'h' ? h : w
        const [cx, cy] = toScreen(o, Number(i.x_ft), Number(i.y_ft))
        if (s.label_at === 'room') {
          return (
            <text key={i.id} x={cx - screenW / 2 + 0.9} y={cy - screenH / 2 + 1.8} fontSize={1.5} fontWeight={600} className="fill-ink-muted" letterSpacing={0.05}>
              {text.toUpperCase()}
            </text>
          )
        }
        const vertical = labelVertical(o, i)
        const lines = wrapText(text, (vertical ? screenH : screenW) - 0.6, 1.1)
        return (
          <text key={i.id} x={cx} y={cy} fontSize={1.1} textAnchor="middle" dominantBaseline="central" className={cls} strokeWidth={0.3}
            transform={vertical ? `rotate(-90 ${cx} ${cy})` : undefined}>
            {lines.map((ln, k) => <tspan key={k} x={cx} dy={k === 0 ? `${-(lines.length - 1) * 0.55}em` : '1.1em'}>{ln}</tspan>)}
          </text>
        )
      })}
    </g>
  )
}

function wrapText(text: string, width: number, font: number): string[] {
  const per = Math.max(4, Math.floor(width / (font * 0.56)))
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    if (!line) line = word
    else if ((line + ' ' + word).length <= per) line += ' ' + word
    else { out.push(line); line = word }
  }
  if (line) out.push(line)
  return out.slice(0, 3)
}

export function DiagramLegend({ colorBy }: { colorBy: ColorBy }) {
  const swatch = (cls: string, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <svg viewBox="0 0 10 10" className="size-3.5"><rect x={1} y={1} width={8} height={8} rx={2} className={cls} strokeWidth={1.2} /></svg>
      {label}
    </span>
  )
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
      {colorBy === 'status' && <>{swatch(TONE.ok, 'Running')}{swatch(TONE.warn, 'Down for maintenance')}{swatch(TONE.danger, 'Broken down')}</>}
      {colorBy === 'wos' && <>{swatch(TONE.quiet, 'No open work orders')}{swatch(TONE.warn, 'One open')}{swatch(TONE.danger, 'Two or more')}</>}
      {colorBy === 'sticker' && <>{swatch(TONE.ok, 'Sticker printed')}{swatch(TONE.warn, 'Tag made, not printed')}{swatch(TONE.danger, 'No sticker')}</>}
      {colorBy === 'usage' && <>{swatch('fill-accent/10 stroke-accent', 'Fewer cars')}{swatch('fill-accent/85 stroke-accent', 'Most cars since its start date')}{swatch(TONE.quiet, 'No start date')}</>}
      {swatch(TONE.placeholder, 'Not linked to a machine')}
    </div>
  )
}
