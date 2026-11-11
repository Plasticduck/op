/* eslint-disable react-refresh/only-export-components -- a registry of drawings, not a component module */
import type { ReactNode } from 'react'
import type { TunnelSide } from '@/lib/queries/miTunnel'

// How each kind of equipment is drawn, top-down, in feet around its own center (w along
// the tunnel, h across it). Color comes from the group it's drawn in (fill and stroke
// inherit), so the same drawing works for status, use and sticker views, in light and
// dark. Shapes are kept simple: recognisable at 6 pixels a foot on a phone.

type Draw = (w: number, h: number, props: Record<string, unknown>, side: TunnelSide) => ReactNode

export type ShapeDef = {
  label: string
  group: 'Tunnel' | 'Brushes' | 'Arches and applicators' | 'Beside the tunnel' | 'Other'
  // Size a new one starts at.
  w: number
  h: number
  side: TunnelSide
  // Where its name goes: along the wall outside the tunnel, inside it, or not at all.
  label_at: 'callout' | 'inside' | 'room' | 'none'
  // Rooms and labels are scenery: not linked to a machine, not clickable.
  scenery?: boolean
  draw: Draw
}

const SW = 0.18 // stroke width in feet

// n evenly spaced centers along a length, centered on 0.
const along = (n: number, len: number) => Array.from({ length: n }, (_, k) => -len / 2 + (len / n) * (k + 0.5))

const rect = (w: number, h: number, r = 0.4, dash?: string) => (
  <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={r} strokeWidth={SW} strokeDasharray={dash} />
)

export const SHAPES: Record<string, ShapeDef> = {
  conveyor: {
    label: 'Conveyor', group: 'Tunnel', w: 140, h: 1.6, side: 'ds', label_at: 'none',
    draw: (w, h) => (
      <>
        {rect(w, h, 0.3)}
        <line x1={-w / 2 + 0.6} x2={w / 2 - 0.6} y1={0} y2={0} strokeWidth={SW} strokeDasharray="0.5 0.5" fill="none" />
      </>
    ),
  },
  roller_up: {
    label: 'Roller up (entrance)', group: 'Tunnel', w: 6, h: 3, side: 'ds', label_at: 'callout',
    draw: (w, h) => (
      <>
        {rect(w, h)}
        {[-1, 0, 1].map((k) => <circle key={k} cx={k * w * 0.28} cy={0} r={Math.min(h, w) * 0.18} strokeWidth={SW} />)}
        <path d={`M ${-w * 0.42} ${h * 0.3} L ${w * 0.42} ${-h * 0.3}`} strokeWidth={SW} fill="none" />
      </>
    ),
  },
  roller_down: {
    label: 'Roller down (exit)', group: 'Tunnel', w: 6, h: 3, side: 'ds', label_at: 'callout',
    draw: (w, h) => (
      <>
        {rect(w, h)}
        {[-1, 0, 1].map((k) => <circle key={k} cx={k * w * 0.28} cy={0} r={Math.min(h, w) * 0.18} strokeWidth={SW} />)}
        <path d={`M ${-w * 0.42} ${-h * 0.3} L ${w * 0.42} ${h * 0.3}`} strokeWidth={SW} fill="none" />
      </>
    ),
  },
  photo_eye: {
    label: 'Photo eyes', group: 'Tunnel', w: 1, h: 16, side: 'both', label_at: 'callout',
    draw: (w, h) => (
      <>
        <rect x={-w / 2} y={-h / 2} width={w} height={1} strokeWidth={SW} />
        <rect x={-w / 2} y={h / 2 - 1} width={w} height={1} strokeWidth={SW} />
        <line x1={0} x2={0} y1={-h / 2 + 1} y2={h / 2 - 1} strokeWidth={SW} strokeDasharray="0.6 0.4" fill="none" />
      </>
    ),
  },
  sensor: {
    label: 'Sensor', group: 'Tunnel', w: 1, h: 16, side: 'both', label_at: 'callout',
    draw: (w, h) => (
      <>
        <circle cx={0} cy={-h / 2 + 0.6} r={Math.max(0.45, w / 2)} strokeWidth={SW} />
        <circle cx={0} cy={h / 2 - 0.6} r={Math.max(0.45, w / 2)} strokeWidth={SW} />
        <line x1={0} x2={0} y1={-h / 2 + 1.1} y2={h / 2 - 1.1} strokeWidth={SW} strokeDasharray="0.2 0.5" fill="none" />
      </>
    ),
  },
  prep_unit: {
    label: 'Prep station', group: 'Beside the tunnel', w: 5, h: 3.5, side: 'outside', label_at: 'inside',
    draw: (w, h) => rect(w, h, 0.6),
  },
  arch: {
    label: 'Arch (spray)', group: 'Arches and applicators', w: 1.5, h: 16, side: 'both', label_at: 'callout',
    draw: (w, h) => (
      <>
        {rect(w, h, 0.3)}
        {along(Math.max(2, Math.floor(h / 1.6)), h).map((y, k) => (
          <circle key={k} cx={0} cy={y} r={Math.min(0.25, w / 4)} strokeWidth={SW} />
        ))}
      </>
    ),
  },
  blaster: {
    label: 'High pressure blaster', group: 'Arches and applicators', w: 3, h: 16, side: 'both', label_at: 'callout',
    draw: (w, h) => (
      <>
        {rect(w, h, 0.3)}
        {along(Math.max(2, Math.floor(h / 2.2)), h).map((y, k) => {
          return <path key={k} d={`M ${-w * 0.3} ${y - 0.5} L ${w * 0.3} ${y} L ${-w * 0.3} ${y + 0.5} Z`} strokeWidth={SW} />
        })}
      </>
    ),
  },
  wheel_brush: {
    label: 'Wheel brush', group: 'Brushes', w: 4, h: 2.2, side: 'ds', label_at: 'callout',
    draw: (w, h) => (
      <>
        {rect(w, h, h / 2)}
        {[-0.25, 0, 0.25].map((k) => <line key={k} x1={k * w} x2={k * w} y1={-h * 0.35} y2={h * 0.35} strokeWidth={SW} fill="none" />)}
      </>
    ),
  },
  wrap: {
    label: 'Wrap', group: 'Brushes', w: 5, h: 5, side: 'ds', label_at: 'callout',
    draw: (w, h, _p, side) => {
      const r = Math.min(w, h) / 2 - 0.2
      const dir = side === 'ps' ? 1 : -1
      return (
        <>
          <line x1={0} y1={0} x2={-r * 0.6} y2={dir * (r + 1.6)} strokeWidth={SW * 2} fill="none" />
          <circle cx={-r * 0.6} cy={dir * (r + 1.6)} r={0.45} strokeWidth={SW} />
          <circle cx={0} cy={0} r={r} strokeWidth={SW} />
          <circle cx={0} cy={0} r={r * 0.55} strokeWidth={SW} fill="none" strokeDasharray="0.4 0.35" />
        </>
      )
    },
  },
  top_brush: {
    label: 'Top brush', group: 'Brushes', w: 3.5, h: 13, side: 'center', label_at: 'callout',
    draw: (w, h) => (
      <>
        {rect(w, h, 0.6)}
        {along(Math.max(3, Math.floor(h / 1.2)), h).map((y, k) => (
          <line key={k} x1={-w / 2 + 0.3} x2={w / 2 - 0.3} y1={y - 0.35} y2={y + 0.35} strokeWidth={SW * 0.8} fill="none" />
        ))}
      </>
    ),
  },
  side_brush: {
    label: 'Side brush', group: 'Brushes', w: 4, h: 4, side: 'ds', label_at: 'callout',
    draw: (w, h, props) => {
      const r = Math.min(w, h) / 2 - 0.1
      return (
        <>
          <circle cx={0} cy={0} r={r} strokeWidth={SW} />
          {Array.from({ length: 8 }, (_, k) => {
            const a = (k / 8) * Math.PI * 2
            return <line key={k} x1={Math.cos(a) * r * 0.25} y1={Math.sin(a) * r * 0.25} x2={Math.cos(a) * r * 0.9} y2={Math.sin(a) * r * 0.9} strokeWidth={SW * 0.8} fill="none" />
          })}
          {props.tall ? <circle cx={0} cy={0} r={r * 0.25} strokeWidth={SW} /> : null}
        </>
      )
    },
  },
  short_brush: {
    label: 'Short brush', group: 'Brushes', w: 2.5, h: 9, side: 'center', label_at: 'callout',
    draw: (w, h) => (
      <>
        {rect(w, h, 0.5)}
        {along(Math.max(3, Math.floor(h / 1.1)), h).map((y, k) => (
          <line key={k} x1={-w / 2 + 0.3} x2={w / 2 - 0.3} y1={y} y2={y} strokeWidth={SW * 0.8} fill="none" />
        ))}
      </>
    ),
  },
  tire_shine: {
    label: 'Tire shine', group: 'Arches and applicators', w: 3, h: 1.6, side: 'ds', label_at: 'callout',
    draw: (w, h) => (
      <>
        {rect(w, h, 0.3)}
        <circle cx={0} cy={0} r={Math.min(w, h) * 0.28} strokeWidth={SW} />
      </>
    ),
  },
  blower: {
    label: 'Dryers', group: 'Arches and applicators', w: 25, h: 16, side: 'both', label_at: 'callout',
    draw: (w, h) => {
      const n = Math.max(2, Math.round(w / 4))
      return (
        <>
          {rect(w, h, 0.6, '0.8 0.5')}
          {Array.from({ length: n }, (_, k) => {
            const x = -w / 2 + (w / n) * (k + 0.5)
            const y = k % 3 === 0 ? -h / 2 + 2.2 : k % 3 === 1 ? h / 2 - 2.2 : 0
            return (
              <g key={k}>
                <circle cx={x} cy={y} r={1.5} strokeWidth={SW} />
                <path d={`M ${x - 1.1} ${y} L ${x + 1.1} ${y} M ${x} ${y - 1.1} L ${x} ${y + 1.1}`} strokeWidth={SW * 0.8} fill="none" />
              </g>
            )
          })}
        </>
      )
    },
  },
  equipment: {
    label: 'Equipment', group: 'Beside the tunnel', w: 8, h: 6, side: 'outside', label_at: 'inside',
    draw: (w, h) => rect(w, h, 0.6),
  },
  vacuum: {
    label: 'Vacuum', group: 'Beside the tunnel', w: 7, h: 6, side: 'outside', label_at: 'inside',
    draw: (w, h) => (
      <>
        {rect(w, h, 0.6)}
        <circle cx={0} cy={-h * 0.18} r={Math.min(w, h) * 0.2} strokeWidth={SW} fill="none" />
      </>
    ),
  },
  room: {
    label: 'Room or area', group: 'Other', w: 30, h: 16, side: 'outside', label_at: 'room', scenery: true,
    draw: (w, h) => rect(w, h, 1, '1 0.6'),
  },
  label: {
    label: 'Text', group: 'Other', w: 10, h: 2, side: 'outside', label_at: 'inside', scenery: true,
    draw: () => null,
  },
}

export const shapeFor = (kind: string): ShapeDef => SHAPES[kind] ?? SHAPES.equipment
