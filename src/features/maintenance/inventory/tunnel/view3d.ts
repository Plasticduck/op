import type { ReactNode } from 'react'
import type { TunnelAsset, TunnelItem, TunnelLayout } from '@/lib/queries/miTunnel'
import type { ColorBy } from './TunnelDiagram'

// What the Tunnel page and its 3D view agree on. The page owns everything that must
// survive a 3D failure (the site, the selection, color-by, unsaved moves); the 3D view
// draws it and reports what the person did. This file is types and one small probe, so
// the page can import it without pulling three.js in: the 3D view itself is a lazy chunk
// (Tunnel3DHost loads Tunnel3D).

export type Tunnel3DFail = 'unsupported' | 'lost' | 'error'

export type Tunnel3DProps = {
  // The drawing. Unsaved moves are already applied to items; saved says where each moved
  // shape is saved, so the view can leave an outline there.
  layout: Pick<TunnelLayout, 'length_ft' | 'width_ft' | 'zones'>
  items: TunnelItem[]
  assets: Record<string, TunnelAsset>
  saved?: Record<string, { x_ft: number; y_ft: number }>
  // 'site': a real site's tunnel. 'preview': a template shown as a showroom before the
  // site has a drawing (everything runs, names on hover, nothing to select or move).
  mode: 'site' | 'preview'
  // What the camera is remembered under (the layout's id, or 'preview'): coming back
  // from a machine's page puts the person where they were.
  memoryKey: string
  colorBy: ColorBy
  selectedId: string | null
  onSelect: (id: string | null) => void
  // Open the machine's own page. Only ever called for a shape linked to a machine.
  onOpen: (item: TunnelItem) => void
  // "Details" or "Link a machine" on the machine card: the page shows its side panel
  // for this shape. Left out, the card has no such button.
  onDetails?: (id: string) => void
  // The person may arrange machines (false hides the Move toggle; always false in preview).
  canMove: boolean
  moveMode: boolean
  onMoveMode: (on: boolean) => void
  // A finished move (a drop, a keyboard nudge, a typed distance), already snapped and
  // clamped, in layout feet. The page adds it to its unsaved changes.
  onMove: (id: string, x_ft: number, y_ft: number) => void
  // Something of the page's to float along the bottom of the canvas (the unsaved moves
  // bar), so it stays in view when the canvas fills the screen.
  footer?: ReactNode
  // WebGL2 is missing, the context was lost for good, or the view threw: the page shows
  // the 2D diagram instead.
  onFail: (reason: Tunnel3DFail) => void
  className?: string
}

// Whether this browser can draw the 3D view at all (three.js needs WebGL2). Asked before
// the chunk is fetched, so a phone that can't run it never downloads it.
export function canWebGL2(): boolean {
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2')
    // Give the probe's context back right away: browsers cap how many a page may hold.
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return !!gl
  } catch {
    return false
  }
}
