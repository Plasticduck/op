import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { createTunnelScene } from './three/TunnelScene'
import type { CameraPreset, SceneEvents, TunnelSceneApi } from './three/types'
import { useCameraFollow } from './three/ui/camera'
import { sendInset, useDragFlag, useFlash, useInset, useSheetHeight, useWheelHint } from './three/ui/cues'
import { prefersReducedMotion, readCamera, readStore, useReducedMotion, useThemeName, writeCamera, writeStore } from './three/ui/env'
import { FRAME } from './three/ui/frame'
import { useFullScreen } from './three/ui/fullScreen'
import { HoverChip } from './three/ui/HoverChip'
import { useViewKeys } from './three/ui/keys'
import { FoldedLegend, Legend } from './three/ui/Legend'
import { LoadingVeil } from './three/ui/Loading'
import { MachineCard } from './three/ui/MachineCard'
import { MachineList } from './three/ui/MachineList'
import { alongText, isMovable, noRideText, nudgeAlong, spokenLabel, tunnelOrder, type Machine, type NudgeSize } from './three/ui/machines'
import { MoveReadout } from './three/ui/MoveReadout'
import { Pinned } from './three/ui/Pinned'
import { RideCaption } from './three/ui/RideCaption'
import { Toolbar } from './three/ui/Toolbar'
import { canWebGL2, type Tunnel3DProps } from './view3d'

// The 3D tunnel as the page sees it: the scene (three/TunnelScene.ts) in a box, and the
// plain HTML that floats over it: the toolbar, the name chip that follows the pointer,
// the selected machine's card, the legend. This file is the only place React and the
// scene meet. The scene is told things through TunnelSceneApi and answers through
// SceneEvents; it moves the pinned chips itself, so nothing here runs per frame. The
// overlays and the smaller behaviors live in three/ui/.
//
// Loaded lazily by Tunnel3DHost: everything that needs three.js stays in this chunk.

const PLAY_KEY = 'mi.tunnel.play'

type Ride = { active: boolean; nearId: string | null }
const NO_RIDE: Ride = { active: false, nearId: null }

// A machine in someone's hand: where it is now and where it is saved.
type Drag = { id: string; x: number; y: number; overlaps: string[]; from: { x_ft: number; y_ft: number } }

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((v, k) => v === b[k])

// The ride's progress bar is written straight to the page: it changes several times a
// second and nothing else depends on it.
function showProgress(bar: HTMLElement | null, progress: number) {
  if (!bar) return
  bar.style.transform = `scaleX(${progress.toFixed(3)})`
  bar.parentElement?.setAttribute('aria-valuenow', String(Math.round(progress * 100)))
}

export default function Tunnel3D(props: Tunnel3DProps) {
  const { layout, items, assets, saved, mode, memoryKey, colorBy, selectedId, onSelect, onOpen, onDetails, canMove, moveMode, onMoveMode, onMove, footer, onFail, className } = props
  const preview = mode === 'preview'
  const arranging = !preview && canMove && moveMode
  const theme = useThemeName()
  const reducedMotion = useReducedMotion()
  const skipId = useId()

  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const skipRef = useRef<HTMLSpanElement>(null)
  const sceneRef = useRef<TunnelSceneApi | null>(null)
  // The same scene as state, for the parts that pin elements to it.
  const [scene, setScene] = useState<TunnelSceneApi | null>(null)
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const [veil, setVeil] = useState(true)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  // Whether the pointer or the keyboard spoke last: the name chip follows that one.
  const [lead, setLead] = useState<'pointer' | 'keys'>('pointer')
  const [playing, setPlaying] = useState(() => !prefersReducedMotion() && readStore('local', PLAY_KEY) !== '0')
  const [expanded, setExpanded] = useState(false)
  // Where the camera will open: camera.ts puts it back there before the first frame, and
  // that frame is fitted to the controls as they are then (sendInset below), the legend
  // of a remembered top view among them.
  const [opening] = useState(() => readCamera(memoryKey))
  const [preset, setPreset] = useState<CameraPreset | null>(opening ? opening.preset : 'overview')
  // The preset the camera was last put on, kept while the person moves it away: the top
  // view frames its rooms clear of the legend (useInset), and a camera nudged off it
  // shouldn't then slide over by itself.
  const [framed, setFramed] = useState<CameraPreset>(opening?.framed ?? 'overview')
  if (preset && preset !== framed) setFramed(preset)
  const [ride, setRide] = useState<Ride>(NO_RIDE)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [legendOpen, setLegendOpen] = useState(false)
  const [say, setSay] = useState('')
  const toast = useFlash(2500)
  const showToast = toast.flash

  const machines = useMemo(() => tunnelOrder(items, assets), [items, assets])
  const byId = useMemo(() => new Map(machines.map((m) => [m.item.id, m])), [machines])
  const selected = !preview && selectedId ? byId.get(selectedId) ?? null : null
  const sceneSelected = selected ? selected.item.id : null
  const anyUnlinked = !preview && machines.some((m) => !m.asset)
  const anyRetired = !preview && machines.some((m) => m.asset?.status === 'retired')

  // The same sentence twice in a row still has to be read out twice.
  const announce = useCallback((text: string) => setSay((was) => (was === text ? text + String.fromCharCode(160) : text)), [])
  // A passing message over the canvas is also read out, through the live region that is
  // there from the start: a status box put on the page together with its text is often
  // not read at all.
  const flash = useCallback((text: string) => {
    showToast(text)
    announce(text)
  }, [showToast, announce])

  // ---- What the person can do ----
  const togglePlay = () => {
    const next = !playing
    setPlaying(next)
    writeStore('local', PLAY_KEY, next ? '1' : '0')
  }
  const toPreset = (p: CameraPreset) => {
    setPreset(p)
    sceneRef.current?.setPreset(p)
  }
  // The scene answers through onRide, also when there is nothing to ride.
  const rideAsked = useRef(false)
  const toggleRide = () => {
    rideAsked.current = !ride.active
    sceneRef.current?.ride(!ride.active)
  }
  const toggleMove = () => {
    if (!preview && canMove) onMoveMode(!moveMode)
  }
  const nudge = (m: Machine, dir: -1 | 1, size: NudgeSize = 'step') => {
    if (!arranging || !isMovable(m.item)) return
    const x = nudgeAlong(m.item, layout, dir, size)
    if (Math.abs(x - Number(m.item.x_ft)) < 0.005) return
    onMove(m.item.id, x, Number(m.item.y_ft))
    announce(`${m.name} moved to ${alongText(x, 'feet')}`)
  }
  // Left / Right outside the machine list: the machine the keyboard is on, else the selected one.
  const nudgeKey = (dir: -1 | 1, size: NudgeSize) => {
    const m = byId.get(focusId ?? sceneSelected ?? '')
    if (!arranging || !m || !isMovable(m.item)) return false
    nudge(m, dir, size)
    return true
  }
  // Enter or a click on a machine's button: select it, or open it if it already is.
  const activate = (m: Machine) => {
    if (preview) return
    if (selectedId !== m.item.id) onSelect(m.item.id)
    else if (m.asset) onOpen(m.item)
  }
  const walk = (dir: -1 | 1) => {
    if (!selected) return
    const to = machines[(machines.indexOf(selected) + dir + machines.length) % machines.length]
    if (to) onSelect(to.item.id)
  }
  // The page's side panel opens under a full-screen canvas: step out of it first.
  const details = (id: string) => {
    setExpanded(false)
    onDetails?.(id)
  }
  // The card can go while it holds keyboard focus: Escape, its Close button, a ride
  // starting. Focus would fall to the page, where the view's keys stop and the next Tab
  // leaves the view, so it goes on to the machine's own button. Whether it was in the card
  // is asked as React lets go of the card's box, which is still on the page then; the
  // button is focused once React is done, because React doesn't hear focus events while
  // it changes the page (the list's onFocus lights the machine). Focus from a mouse is
  // left alone, or a click on Close would light up the machine just closed.
  const holdSheet = useCallback((el: HTMLDivElement | null) => {
    sheetRef.current = el
    if (!el) return
    return () => {
      sheetRef.current = null
      const a = document.activeElement
      if (!(a instanceof HTMLElement) || !el.contains(a) || !a.matches(':focus-visible')) return
      const id = el.dataset.machine ?? ''
      queueMicrotask(() => {
        // Unless something else has taken it in the meantime.
        if (document.activeElement && document.activeElement !== document.body) return
        rootRef.current?.querySelector<HTMLElement>(`[data-t3d-machine="${CSS.escape(id)}"]`)?.focus()
      })
    }
  }, [])
  // Escape backs out one step at a time: the ride, then full screen, then the selection.
  // False when there was nothing to back out of.
  const escape = (): boolean => {
    if (ride.active) sceneRef.current?.ride(false)
    else if (expanded) setExpanded(false)
    else if (selected) onSelect(null)
    else return false
    return true
  }

  // What the scene's callbacks and the key listener read: they are set up once and must
  // always see the latest props.
  const dragRef = useRef<Drag | null>(null)
  const dragEndedAt = useRef(0)
  const now = {
    saved, mode, memoryKey, colorBy, theme, reducedMotion, playing, expanded, arranging, byId, framed,
    selectedId: sceneSelected, noRide: () => noRideText(items, assets, preview),
    onSelect, onOpen, onMove, onFail,
    togglePlay, toPreset, toggleRide, toggleMove, nudgeKey, escape,
    // The scene takes Escape while a machine is in hand (it puts it back): that press is
    // spent, also for a moment after.
    dragging: () => !!dragRef.current || performance.now() - dragEndedAt.current < 150,
  }
  const live = useRef<typeof now | null>(null)
  useLayoutEffect(() => { live.current = now })

  // ---- The scene ----
  const rideNow = useRef<Ride>(NO_RIDE)
  const rideProgress = useRef(0)
  const rideBar = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = stageRef.current
    const o = live.current
    if (!el || !o) return
    const events: SceneEvents = {
      onReady: () => setReady(true),
      onHover: (id) => {
        setHoverId(id)
        if (id) setLead('pointer')
      },
      onSelect: (id) => {
        const c = live.current
        if (c && c.mode === 'site') c.onSelect(id)
      },
      onOpen: (id) => {
        const c = live.current
        const m = c?.byId.get(id)
        // Only a shape with a machine behind it has a page to open.
        if (c && c.mode === 'site' && m?.asset) c.onOpen(m.item)
      },
      onMove: (e) => {
        const c = live.current
        if (!c) return
        const m = c.byId.get(e.id)
        const was = dragRef.current
        if (e.phase === 'start' || e.phase === 'move') {
          if (was && was.id === e.id && was.x === e.x_ft && was.y === e.y_ft && sameIds(was.overlaps, e.overlaps)) return
          // Measured from where it's saved (where the scene leaves its outline), or from
          // where it stood if it hasn't been moved yet.
          const from = was && was.id === e.id ? was.from
            : c.saved?.[e.id] ?? (m ? { x_ft: Number(m.item.x_ft), y_ft: Number(m.item.y_ft) } : { x_ft: e.x_ft, y_ft: e.y_ft })
          const next: Drag = { id: e.id, x: e.x_ft, y: e.y_ft, overlaps: [...e.overlaps], from }
          dragRef.current = next
          setDrag(next)
          return
        }
        dragRef.current = null
        dragEndedAt.current = performance.now()
        setDrag(null)
        if (e.phase !== 'end' || !m || c.mode !== 'site') return
        // Put down where it was picked up: nothing to save.
        if (Math.abs(Number(m.item.x_ft) - e.x_ft) < 0.005 && Math.abs(Number(m.item.y_ft) - e.y_ft) < 0.005) return
        c.onMove(e.id, e.x_ft, e.y_ft)
        announce(`${m.name} moved to ${alongText(e.x_ft, 'feet')}`)
      },
      onCameraRest: (pose, p) => {
        const c = live.current
        if (!c) return
        writeCamera(c.memoryKey, pose, p, p ?? c.framed)
        setPreset(p)
      },
      onRide: (e) => {
        rideProgress.current = e.progress
        showProgress(rideBar.current, e.progress)
        const was = rideNow.current
        if (!e.active && !was.active) {
          // Asked for and refused: the scene has nothing to ride.
          const c = live.current
          if (rideAsked.current && c) flash(c.noRide())
          rideAsked.current = false
          return
        }
        rideAsked.current = false
        if (was.active === e.active && was.nearId === e.nearId) return
        const next = { active: e.active, nearId: e.active ? e.nearId : null }
        rideNow.current = next
        setRide(next)
        if (was.active !== e.active) announce(e.active ? 'Riding through the tunnel.' : 'The ride is over.')
      },
      onLost: () => live.current?.onFail('lost'),
    }
    let made: TunnelSceneApi
    try {
      made = createTunnelScene(el, events, {
        theme: o.theme, colorBy: o.colorBy, mode: o.mode, selectedId: o.selectedId, moveMode: o.arranging,
        playing: o.playing, reducedMotion: o.reducedMotion, expanded: o.expanded,
      })
    } catch (err) {
      // The host's probe passed, so this is rare: the GPU went away in between, or the
      // scene itself broke. Either way the page falls back to the diagram.
      console.error('The 3D tunnel could not start', err)
      setFailed(true)
      o.onFail(canWebGL2() ? 'error' : 'unsupported')
      return
    }
    // What the controls cover, before the first frame: an inset that comes later is eased
    // in, and the opening picture would be seen settling. Every marked control that will
    // show once the view is ready is on the page by now, unseen (the toolbar, the card,
    // the bottom stack), and a phone's sheet has its height (useSheetHeight).
    if (rootRef.current) sendInset(made, rootRef.current, el)
    sceneRef.current = made
    setScene(made)
    return () => {
      sceneRef.current = null
      dragRef.current = null
      rideNow.current = NO_RIDE
      made.dispose()
      setScene(null)
      setReady(false)
      setVeil(true)
      setHoverId(null)
      setDrag(null)
      setRide(NO_RIDE)
    }
  }, [announce, flash])

  // These run after the scene is made (effects run in the order written), and again for
  // the second scene React StrictMode makes in development.
  useEffect(() => {
    sceneRef.current?.setData({ layout, items, assets, saved })
  }, [layout, items, assets, saved])

  useEffect(() => {
    sceneRef.current?.setOptions({ theme, colorBy, mode, selectedId: sceneSelected, moveMode: arranging, playing, reducedMotion, expanded })
  }, [theme, colorBy, mode, sceneSelected, arranging, playing, reducedMotion, expanded])

  useCameraFollow(sceneRef, {
    memoryKey, selectedId: sceneSelected, onPreset: setPreset,
    onSelected: (id) => {
      const m = byId.get(id)
      if (m) announce(`${spokenLabel(m)}. Selected.`)
    },
  })

  useEffect(() => {
    if (reducedMotion) setPlaying(false)
  }, [reducedMotion])

  const riding = ride.active
  const showCard = !!selected && !riding
  const showLegend = !preview && !riding
  useFullScreen(expanded, rootRef, setExpanded)
  useViewKeys(rootRef, live)
  useWheelHint(rootRef, flash, toast.busy)
  useDragFlag(rootRef, stageRef)
  useSheetHeight(rootRef, sheetRef, showCard)
  // What can add or take away a control the scene frames around (data-t3d-inset).
  useInset(rootRef, stageRef, scene, [ready, showCard && sceneSelected, !!footer, preview && !riding, showLegend && framed === 'top'].join())

  if (failed) return null

  const near = riding && ride.nearId ? byId.get(ride.nearId) ?? null : null
  // The chip names what the pointer is on, or what the keyboard is on.
  const chip = !drag && !riding ? byId.get((lead === 'keys' ? focusId ?? hoverId : hoverId ?? focusId) ?? '') ?? null : null
  const focused = focusId && !riding ? byId.get(focusId) ?? null : null
  const dragged = drag ? byId.get(drag.id) ?? null : null
  const hint = arranging && !riding && !(legendOpen && showLegend)
  // The controls the chips keep out from under (the card, the page's bar and the legend
  // are some): when one appears or opens they're measured again, and Pinned watches their
  // sizes.
  const controls = [legendOpen && showLegend, hint, riding, showCard && sceneSelected, arranging, !!footer].join()

  const onListFocus = (id: string | null) => {
    setFocusId(id)
    if (id) setLead('keys')
    sceneRef.current?.focus(id)
  }
  const skip = (e: { preventDefault(): void }) => {
    // Move focus without touching the address bar (the app's router owns it).
    e.preventDefault()
    skipRef.current?.focus()
  }

  return (
    <div className={cn(FRAME, className)}>
      <a href={`#${skipId}`} onClick={skip}
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[70] focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-3 focus:py-1.5 focus:text-sm focus:font-medium focus:text-accent focus:shadow-md">
        Skip the 3D view
      </a>

      {/* Inline it is its own stacking context (a container), so nothing in it rises over
          the app's top bar; full screen it covers the app (sidebar, top and bottom bars). */}
      <div ref={rootRef} role={expanded ? 'dialog' : 'group'} aria-modal={expanded || undefined}
        aria-label={preview ? 'A sample tunnel in 3D' : 'The tunnel in 3D'} data-t3d="root" data-ready={ready} data-mode={mode}
        className={cn('group/t3d @container overflow-hidden bg-content',
          // Full screen, the controls keep clear of a phone's notch and home bar.
          expanded ? 'fixed inset-0 z-[60] overscroll-contain [--t3d-bottom:env(safe-area-inset-bottom)] [--t3d-top:env(safe-area-inset-top)]' : 'absolute inset-0 rounded-xl [--t3d-bottom:0px] [--t3d-top:0px]')}
        // Focusing something inside a clipped box can scroll the box itself: put it back.
        onScroll={(e) => { e.currentTarget.scrollTop = 0; e.currentTarget.scrollLeft = 0 }}>

        {!preview && <MachineList machines={machines} selectedId={sceneSelected} arranging={arranging} onFocus={onListFocus} onActivate={activate} onNudge={nudge} />}

        {/* The scene's box. Narrow layout: it ends under the top edge of the card's sheet. */}
        <div className="absolute inset-x-0 top-0 bottom-0 @max-[640px]:bottom-[max(0px,calc(var(--t3d-sheet,0px)-0.75rem))]">
          {/* The scene puts its canvas in here. Nothing else may: React must find it empty. */}
          <div ref={stageRef} className="absolute inset-0" />

          {/* Things the scene keeps on a machine. Covers the canvas exactly. */}
          {ready && (
            <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
              {focused && (
                <Pinned scene={scene} id={focused.item.id} at="base" place="center" contain={false}
                  onPlaced={(off) => { if (off) sceneRef.current?.flyTo(focused.item.id) }}>
                  <div data-t3d="ring" className="size-12 rounded-full border-2 border-accent shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-accent)_30%,transparent)]" />
                </Pinned>
              )}
              {chip && (
                <Pinned scene={scene} id={chip.item.id} at="top" place="above" gap={8} controls={controls}
                  className="transition-opacity duration-150 group-data-[dragging]/t3d:opacity-0">
                  {/* Not while arranging: a click on the selected machine is then a drag
                      that didn't travel, and it doesn't open (interaction.ts). */}
                  <HoverChip m={chip} preview={preview} ring={focused === chip} opens={!preview && !arranging && selected === chip && !!chip.asset} />
                </Pinned>
              )}
              {drag && dragged && (
                <Pinned scene={scene} id={drag.id} at="base" place="below" gap={16} controls={controls}>
                  <MoveReadout name={dragged.name} x={drag.x} y={drag.y} from={drag.from} across={dragged.item.side === 'outside'}
                    overlaps={drag.overlaps.map((id) => byId.get(id)?.name ?? 'another machine')} />
                </Pinned>
              )}
            </div>
          )}
        </div>

        {veil && (
          <LoadingVeil className={cn('z-[5] transition-opacity duration-300', ready && 'pointer-events-none opacity-0')}
            onFaded={() => { if (ready) setVeil(false) }} />
        )}

        {/* On the page, unseen, before the scene's first frame, so that frame is already
            fitted below the toolbar (sendInset above). */}
        <Toolbar veiled={!ready} preview={preview} preset={preset} riding={riding} playing={playing} expanded={expanded} canMove={canMove} moveMode={arranging}
          onPreset={toPreset} onRide={toggleRide} onZoom={(f) => sceneRef.current?.zoomBy(f)} onPlay={togglePlay} onMoveMode={toggleMove}
          onExpand={() => setExpanded((v) => !v)} />

        {ready && (
          <>
            {showLegend && (
              <FoldedLegend open={legendOpen} onToggle={() => setLegendOpen((v) => !v)} colorBy={colorBy} unlinked={anyUnlinked} retired={anyRetired} />
            )}
            {/* Under the toolbar on a phone (beside its column on the left); from 640 px
                beside it in the top left corner (wrapping when the toolbar leaves it little
                room), clear of the bottom row. */}
            {hint && (
              <p data-t3d="hint" data-t3d-keepout className="pointer-events-none absolute left-16 right-2 top-[calc(3.75rem+var(--t3d-top))] z-20 @min-[520px]:left-2 @min-[520px]:top-[calc(3.5rem+var(--t3d-top))] @min-[640px]:left-3 @min-[640px]:right-[24.5rem] @min-[640px]:top-[calc(0.75rem+var(--t3d-top))]">
                <span className="inline-block rounded-lg border border-accent/30 bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent shadow-sm">
                  Drag a machine along the tunnel.<span className="pointer-coarse:hidden"> Alt for fine steps.</span>
                </span>
              </p>
            )}
          </>
        )}

        {/* Along the bottom. Narrow: one stack below the toolbar's column, the page's bar
            above the card, and the card scrolls inside itself if it has to. Wider: the card
            in the left corner, the legend in the right, and the page's bar on the left too,
            on the card or in its place beside the legend, so it stays out of the middle of
            the canvas, where the scene frames the drawing (useInset). Once there is room for
            all three in a row the bar is centered on the canvas between them (the two
            corners share what the middle leaves, so it stays centered while it can). The
            ride's caption and the showroom's note are centered at any width: nothing else is
            there then. On the page, unseen, before the scene's first frame, like the toolbar:
            that frame is already fitted around the card, the note, the bar and the top
            view's legend. */}
        <div className={cn('pointer-events-none absolute inset-x-0 bottom-0 top-[calc(13rem+var(--t3d-top))] z-20 flex flex-col justify-end gap-2 @min-[520px]:top-[calc(3.75rem+var(--t3d-top))]',
          '@min-[640px]:inset-x-3 @min-[640px]:bottom-[calc(0.75rem+var(--t3d-bottom))] @min-[640px]:top-auto @min-[640px]:grid @min-[640px]:grid-cols-[minmax(0,1fr)_auto] @min-[640px]:items-end @min-[640px]:justify-normal @min-[1000px]:grid-cols-[1fr_auto_1fr]',
          !ready && 'invisible')}>
          <div className={cn('col-span-full flex min-w-0 shrink-0 flex-col items-center gap-2 px-2 empty:hidden @min-[640px]:px-0 @min-[1000px]:col-span-1 @min-[1000px]:col-start-2 @min-[1000px]:row-start-1 @min-[1000px]:items-center',
            !showCard && '@max-[640px]:pb-2',
            !!footer && !riding && !preview && cn('@min-[640px]:col-span-1 @min-[640px]:col-start-1 @min-[640px]:items-start', showCard ? '@min-[640px]:row-start-1' : '@min-[640px]:row-start-2'))}>
            {riding && (
              <RideCaption near={near} preview={preview} onStop={toggleRide}
                barRef={(el) => { rideBar.current = el; showProgress(el, rideProgress.current) }} />
            )}
            {preview && !riding && (
              <p data-t3d="note" data-t3d-keepout data-t3d-inset="bottom" className="max-w-full rounded-full border border-border bg-card/90 px-3 py-1.5 text-center text-xs text-ink-muted shadow-sm backdrop-blur-sm @max-[640px]:rounded-lg">
                Preview: this is what a site's tunnel looks like once it is set up.
              </p>
            )}
            {footer && <div data-t3d="footer" data-t3d-keepout data-t3d-inset="bottom" className="pointer-events-auto max-w-full @min-[1000px]:max-w-[34rem]">{footer}</div>}
          </div>
          {showCard && selected && (
            <div ref={holdSheet} data-machine={selected.item.id} className="flex min-h-0 flex-col @min-[640px]:col-start-1 @min-[640px]:row-start-2 @min-[640px]:block @min-[1000px]:row-start-1">
              <MachineCard machine={selected} canMove={canMove} stepper={arranging && isMovable(selected.item)} clearCorner={!expanded} oneLine={!!footer && !expanded}
                onOpen={() => onOpen(selected.item)} onDetails={onDetails ? () => details(selected.item.id) : undefined}
                onPrev={() => walk(-1)} onNext={() => walk(1)} onClose={() => onSelect(null)} onNudge={(dir) => nudge(selected, dir)} />
            </div>
          )}
          {showLegend && (
            <div data-t3d-keepout data-t3d-inset={framed === 'top' ? 'corner' : undefined} className="hidden justify-self-end @min-[640px]:col-start-2 @min-[640px]:row-span-2 @min-[640px]:row-start-1 @min-[640px]:block @min-[640px]:self-end @min-[1000px]:col-start-3 @min-[1000px]:row-span-1 @min-[1000px]:row-start-1">
              {/* At its own width: a long note in the page's bar wraps instead. */}
              <Legend colorBy={colorBy} unlinked={anyUnlinked} retired={anyRetired} className="w-max" />
            </div>
          )}
        </div>

        {/* Read out through the live region below, so not a status box itself. */}
        {ready && toast.text && (
          <div data-t3d="toast" aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-40 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-shell/85 px-4 py-2 text-center text-sm font-medium text-ink-invert shadow-lg">
            {toast.text}
          </div>
        )}

        <div className="sr-only" aria-live="polite">{say}</div>
      </div>

      <span ref={skipRef} id={skipId} tabIndex={-1} className="sr-only">End of the 3D view.</span>
    </div>
  )
}
