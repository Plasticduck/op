import type { ReactNode } from 'react'
import { Box, CarFront, DoorOpen, Map as MapIcon, Maximize2, Minus, Move, Pause, Play, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CameraPreset } from '../types'

// The controls in the canvas's top right corner. One row when there is room. On a phone
// the camera buttons keep the top right corner and the rest stack down the left edge,
// under the legend button: on an upright canvas the overview runs from the bottom left
// to the top right (the exit end and the Vacuums room), and a column on the right hid
// the end of the drawing. No zoom buttons on a phone-sized canvas or a touch screen: two
// fingers do that. The camera row's band is what the scene frames the drawing below
// (data-t3d-inset, see cues.ts insetOf).

type Props = {
  // On the page but not shown yet (the scene's first frame is still coming): measured, so
  // that frame is already fitted below the band.
  veiled?: boolean
  // The showroom: presets, ride, play and expand only.
  preview: boolean
  // The preset the camera is on, if it's still on one.
  preset: CameraPreset | null
  riding: boolean
  playing: boolean
  expanded: boolean
  canMove: boolean
  moveMode: boolean
  onPreset: (p: CameraPreset) => void
  onRide: () => void
  onZoom: (factor: number) => void
  onPlay: () => void
  onMoveMode: () => void
  onExpand: () => void
}

const GROUP = 'pointer-events-auto flex select-none rounded-lg border border-border bg-card/90 p-0.5 shadow-sm backdrop-blur-sm'
const TOOL = 'grid size-9 shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-content hover:text-ink ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40 ' +
  'aria-pressed:bg-accent-soft aria-pressed:text-accent @max-[520px]:size-11 pointer-coarse:size-11'

function Tool({ label, keys, pressed, disabled, onClick, className, children }: {
  label: string; keys?: string; pressed?: boolean; disabled?: boolean; onClick: () => void; className?: string; children: ReactNode
}) {
  return (
    <button type="button" title={keys ? `${label} (${keys})` : label} aria-label={label} aria-keyshortcuts={keys} aria-pressed={pressed}
      disabled={disabled} onClick={onClick} className={cn(TOOL, className)}>
      {children}
    </button>
  )
}

const ZOOM = '@max-[520px]:hidden pointer-coarse:hidden'

const Rule = ({ className }: { className?: string }) => <span aria-hidden className={cn('m-1 shrink-0 self-stretch bg-border', className)} />

export function Toolbar({ veiled, preview, preset, riding, playing, expanded, canMove, moveMode, onPreset, onRide, onZoom, onPlay, onMoveMode, onExpand }: Props) {
  const on = (p: CameraPreset) => !riding && preset === p
  return (
    <div data-t3d="toolbar" className={cn('pointer-events-none absolute inset-x-2 top-[calc(0.5rem+var(--t3d-top))] z-30 flex flex-col items-end gap-1.5 @min-[520px]:left-auto @min-[520px]:flex-row @min-[520px]:items-start @min-[640px]:right-3 @min-[640px]:top-[calc(0.75rem+var(--t3d-top))]',
      veiled && 'invisible')}>
      <div role="group" aria-label="Camera" data-t3d-keepout data-t3d-inset="top" className={GROUP}>
        <Tool label="Overview" keys="1" pressed={on('overview')} onClick={() => onPreset('overview')}><Box className="size-[18px]" /></Tool>
        <Tool label="From the entrance" keys="2" pressed={on('entrance')} onClick={() => onPreset('entrance')}><DoorOpen className="size-[18px]" /></Tool>
        <Tool label="From above" keys="3" pressed={on('top')} onClick={() => onPreset('top')}><MapIcon className="size-[18px]" /></Tool>
        <Rule className="w-px" />
        <Tool label={riding ? 'Stop the ride' : 'Ride through the tunnel'} keys="R" pressed={riding} onClick={onRide}><CarFront className="size-[18px]" /></Tool>
      </div>
      {/* On a phone: down the left edge, below the legend button. The showroom has none,
          so the column starts at the top, unless the canvas is too narrow for it beside
          the camera row: the two need 272 px and a gap (a small phone inside the app's
          page padding). */}
      <div role="group" aria-label="View" data-t3d-keepout
        className={cn(GROUP, 'flex-col @max-[520px]:absolute @max-[520px]:left-0 @min-[520px]:flex-row', preview ? '@max-[520px]:top-0 @max-[280px]:top-[3.375rem]' : '@max-[520px]:top-[3.375rem]')}>
        {!preview && (
          <>
            <Tool label="Zoom out" disabled={riding} onClick={() => onZoom(1.3)} className={ZOOM}><Minus className="size-[18px]" /></Tool>
            <Tool label="Zoom in" disabled={riding} onClick={() => onZoom(1 / 1.3)} className={ZOOM}><Plus className="size-[18px]" /></Tool>
            <Rule className={cn('w-px', ZOOM)} />
          </>
        )}
        <Tool label={playing ? 'Pause the car wash' : 'Play the car wash'} keys="Space" onClick={onPlay}>
          {playing ? <Pause className="size-[18px]" /> : <Play className="size-[18px]" />}
        </Tool>
        {!preview && canMove && (
          <Tool label="Move machines" keys="M" pressed={moveMode} onClick={onMoveMode}><Move className="size-[18px]" /></Tool>
        )}
        <Tool label={expanded ? 'Close full screen' : 'Fill the screen'} keys={expanded ? 'Escape' : undefined} onClick={onExpand}>
          {expanded ? <X className="size-[18px]" /> : <Maximize2 className="size-[18px]" />}
        </Tool>
      </div>
    </div>
  )
}
