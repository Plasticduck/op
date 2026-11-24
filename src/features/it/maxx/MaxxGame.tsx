import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Gamepad2, Maximize, Minimize, Pause, Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Action, SceneId, SceneParams } from './game/contract'
import { createGame } from './game/engine/game'
import type { GameHandle, GameStatus } from './game/engine/game'

// Hosts the game: a dark stage that fills its parent, the canvas letterboxed in the
// middle, a slim header, the controls legend, and touch buttons on touch screens.
// It takes nothing from the app but styling, so the dev page can mount it as is.

export interface MaxxGameProps {
  /** Whose progress to load and save. */
  userId: string
  /** Dev page only: debug overlays and window.__maxx. */
  debug?: boolean
  startScene?: SceneId
  /** Read once, when the game starts. */
  startParams?: SceneParams
  /** Dev page only: time moves only when a script steps it. */
  manual?: boolean
  className?: string
}

type SetTouch = (action: Action, down: boolean) => void

const XBOX_KEYS: Array<[string, string]> = [
  ['Stick or D-pad', 'Move'],
  ['A', 'Jump'],
  ['X, B, RB or RT', 'Spray'],
  ['Up', 'Aim up'],
  ['Down + Spray in the air', 'Hover'],
  ['Menu', 'Pause'],
]
const KEYBOARD_KEYS: Array<[string, string]> = [
  ['Arrows or A D', 'Move'],
  ['Z or Space', 'Jump'],
  ['X or Shift', 'Spray'],
  ['Up or W', 'Aim up'],
  ['Down + X in the air', 'Hover'],
  ['Enter', 'Pause'],
  ['F', 'Fullscreen'],
  ['M', 'Mute'],
]

// Like the controller: A also confirms, B also backs out, Pause is the Menu button.
const JUMP: Action[] = ['jump', 'confirm']
const SPRAY: Action[] = ['spray', 'cancel']
const PAUSE: Action[] = ['pause']

const DIRECTIONS: Action[] = ['left', 'right', 'up', 'down']
const NO_DIRECTION: Record<string, boolean> = { left: false, right: false, up: false, down: false }

const touchRound = 'pointer-events-auto flex touch-none items-center justify-center rounded-full border border-white/25 font-bold text-white/90 transition-colors'
const touchSmall = cn(touchRound, 'size-10 bg-white/10 text-xs active:bg-white/30')
const headerButton =
  'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-invert-muted transition ' +
  'hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

export function MaxxGame({ userId, debug = false, startScene, startParams, manual = false, className }: MaxxGameProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<GameHandle | null>(null)
  const paramsRef = useRef(startParams)
  const [status, setStatus] = useState<GameStatus | null>(null)
  const [failed, setFailed] = useState(false)
  // Until the game reports in: the same guess it starts from.
  const [coarse] = useState(() => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let game: GameHandle
    try {
      game = createGame(canvas, {
        userId,
        debug,
        startScene,
        startParams: paramsRef.current,
        manual,
        fullscreenTarget: rootRef.current,
        onStatus: setStatus,
      })
    } catch (err) {
      console.error('[maxx] could not start', err)
      setFailed(true)
      return
    }
    gameRef.current = game
    setFailed(false)
    setStatus(game.status)
    canvas.focus({ preventScroll: true })
    return () => {
      gameRef.current = null
      game.destroy()
    }
  }, [userId, debug, startScene, manual])

  const focusCanvas = useCallback(() => canvasRef.current?.focus({ preventScroll: true }), [])
  const setTouch = useCallback<SetTouch>((action, down) => gameRef.current?.ctx.input.setTouch(action, down), [])

  const onPointerDown = (e: ReactPointerEvent) => {
    const game = gameRef.current
    game?.unlockAudio()
    if (e.pointerType === 'touch') game?.ctx.input.touchUsed()
  }
  // A finger only counts as a gesture when it lifts, after onPointerDown has tried.
  const onPointerUp = () => gameRef.current?.unlockAudio()
  // Whether the browser was still holding sound back when the sound button went down. Read
  // there, before the stage's onPointerDown unlocks it: by the click it is always unlocked.
  const lockedAtPress = useRef(false)
  // The header buttons hand the keyboard straight back: Space is the jump key.
  const toggleSound = useCallback(
    (e: ReactMouseEvent) => {
      const game = gameRef.current
      if (game) {
        // A click from the keyboard (detail 0) has no press before it; nothing has unlocked yet.
        const asked = e.detail === 0 ? game.ctx.audio.locked : lockedAtPress.current
        lockedAtPress.current = false
        game.unlockAudio()
        // A click while sound was held back asks for sound: it must never be the click that mutes.
        game.setMuted(asked ? false : !game.ctx.muted)
      }
      focusCanvas()
    },
    [focusCanvas],
  )
  const toggleFullscreen = useCallback(() => {
    gameRef.current?.ctx.toggleFullscreen()
    focusCanvas()
  }, [focusCanvas])

  const fullscreen = status?.fullscreen ?? false
  const muted = status?.muted ?? false
  const soundHeld = !muted && (status?.audioLocked ?? false)
  const connected = status?.gamepadConnected ?? false
  const device = status?.device ?? (coarse ? 'touch' : 'keyboard')
  // The on-screen buttons follow the device in use: a key or a controller button puts them
  // away, a finger on the game brings them back.
  const touchUi = device === 'touch'

  return (
    <div
      ref={rootRef}
      // touch-none: a thumb that slips off a button must not scroll, zoom or pull the page down to reload it.
      className={cn('flex h-full min-h-0 w-full touch-none select-none flex-col overflow-hidden text-ink-invert', fullscreen ? 'bg-black' : 'bg-shell', className)}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      // A held thumb must not bring up the browser's long-press menu.
      onContextMenu={touchUi ? (e) => e.preventDefault() : undefined}
      style={touchUi ? { WebkitTouchCallout: 'none' } : undefined}
    >
      {!fullscreen && (
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-white/10 px-3">
          <h1 className="min-w-0 truncate text-sm font-semibold tracking-wide text-white">Super Mighty Maxx</h1>
          <span
            role="status"
            title={connected ? status?.padName || undefined : 'Press any button on the controller to wake it up'}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
              connected ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/10 text-ink-invert-muted',
            )}
          >
            <Gamepad2 className="size-3.5 shrink-0" aria-hidden />
            {/* Narrow screens keep the icon; its colour says the same thing. So do touch screens
                with no controller: telling a phone to press a button on one would only puzzle. */}
            <span className={touchUi && !connected ? 'sr-only' : 'sr-only sm:not-sr-only'}>
              {connected ? 'Controller connected' : 'No controller. Press any button on it.'}
            </span>
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              className={headerButton}
              title={soundHeld ? 'The browser holds sound back until you click or press a key' : 'Sound (M)'}
              onMouseDown={(e) => e.preventDefault()}
              onPointerDown={() => {
                lockedAtPress.current = !!gameRef.current?.ctx.audio.locked
              }}
              onClick={toggleSound}
            >
              {muted || soundHeld ? <VolumeX className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
              <span className="sr-only sm:not-sr-only">{muted ? 'Sound off' : soundHeld ? (touchUi ? 'Tap for sound' : 'Click for sound') : 'Sound on'}</span>
            </button>
            {status?.canFullscreen && (
              <button type="button" className={headerButton} title="Fullscreen (F)" onMouseDown={(e) => e.preventDefault()} onClick={toggleFullscreen}>
                <Maximize className="size-4" aria-hidden />
                <span className="sr-only sm:not-sr-only">Fullscreen</span>
              </button>
            )}
          </div>
        </header>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* An upright phone: the picture on top at its own height, the buttons get the rest. */}
        <div
          className={cn('relative min-h-0 flex-1 overflow-hidden', touchUi && 'portrait:aspect-video portrait:flex-none', device === 'gamepad' && 'cursor-none')}
          onPointerDown={focusCanvas}
        >
          <canvas
            ref={canvasRef}
            tabIndex={0}
            role="application"
            aria-label="Super Mighty Maxx, a platform game. Play with an Xbox controller, or on the keyboard: arrow keys to move, Z to jump, X to spray, Enter to pause. Shift+Tab leaves the game."
            className="absolute block bg-black outline-none"
            style={{ touchAction: 'none' }}
          />
          {failed && <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-ink-invert-muted">This browser cannot run the game.</p>}
        </div>
        {touchUi && !failed && (
          <TouchControls
            setTouch={setTouch}
            corner={
              fullscreen ? (
                <button type="button" aria-label="Leave fullscreen" className={touchSmall} onClick={toggleFullscreen}>
                  <Minimize className="size-4" aria-hidden />
                </button>
              ) : null
            }
          />
        )}
      </div>

      {!fullscreen && !touchUi && (
        <footer className="flex shrink-0 flex-wrap items-center justify-center gap-x-6 gap-y-1 border-t border-white/10 px-3 py-1.5 text-[11px] leading-5 text-ink-invert-muted">
          <Legend title="Xbox controller" keys={XBOX_KEYS} active={device === 'gamepad'} />
          <Legend title="Keyboard" keys={KEYBOARD_KEYS} active={device === 'keyboard'} />
        </footer>
      )}
    </div>
  )
}

function Legend({ title, keys, active }: { title: string; keys: Array<[string, string]>; active: boolean }) {
  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 transition-opacity', active ? 'opacity-100' : 'opacity-60')}>
      <span className={cn('font-semibold uppercase tracking-wider', active ? 'text-white' : 'text-ink-invert-muted')}>{title}</span>
      {keys.map(([key, what]) => (
        <span key={what} className="whitespace-nowrap">
          <kbd className="rounded border border-white/15 bg-white/10 px-1.5 py-px font-sans text-[11px] font-medium text-ink-invert">{key}</kbd> {what}
        </span>
      ))}
    </div>
  )
}

/** On-screen buttons. Upright phones get them under the picture; sideways they float over its bottom corners. */
function TouchControls({ setTouch, corner }: { setTouch: SetTouch; corner: ReactNode }) {
  return (
    <div className="pointer-events-none z-10 flex items-end justify-between gap-4 pb-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-2 portrait:min-h-0 portrait:flex-1 portrait:items-center landscape:absolute landscape:inset-x-0 landscape:bottom-0">
      <DPad setTouch={setTouch} />
      <div className="flex flex-col items-end gap-3">
        <div className="flex gap-2">
          {corner}
          <HoldButton label="Pause" actions={PAUSE} setTouch={setTouch} className={touchSmall}>
            <Pause className="size-4" aria-hidden />
          </HoldButton>
        </div>
        <div className="flex items-end gap-3">
          <HoldButton label="Spray" actions={SPRAY} setTouch={setTouch} className={cn(touchRound, 'mb-0 size-16 text-lg')} tone="bg-sky-500/40" toneDown="bg-sky-400/80">
            B
          </HoldButton>
          <HoldButton label="Jump" actions={JUMP} setTouch={setTouch} className={cn(touchRound, 'mb-6 size-[4.5rem] text-xl')} tone="bg-red-500/40" toneDown="bg-red-400/80">
            A
          </HoldButton>
        </div>
      </div>
    </div>
  )
}

function HoldButton({
  label,
  actions,
  setTouch,
  className,
  tone = 'bg-white/10',
  toneDown = 'bg-white/30',
  children,
}: {
  label: string
  actions: Action[]
  setTouch: SetTouch
  className: string
  tone?: string
  toneDown?: string
  children: ReactNode
}) {
  const [down, setDown] = useState(false)
  const set = (on: boolean) => {
    setDown(on)
    for (const a of actions) setTouch(a, on)
  }
  // Taken off the screen with a finger still on it (a key was pressed): let go, or it stays held.
  useEffect(() => () => actions.forEach((a) => setTouch(a, false)), [actions, setTouch])
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      className={cn(className, down ? toneDown : tone)}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        set(true)
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onLostPointerCapture={() => set(false)}
    >
      {children}
    </button>
  )
}

/** One pad the thumb can slide around on, eight ways. */
function DPad({ setTouch }: { setTouch: SetTouch }) {
  const [held, setHeld] = useState(NO_DIRECTION)
  const heldRef = useRef(NO_DIRECTION)
  useEffect(() => () => DIRECTIONS.forEach((a) => setTouch(a, false)), [setTouch])

  const apply = (next: Record<string, boolean>) => {
    for (const a of DIRECTIONS) if (next[a] !== heldRef.current[a]) setTouch(a, next[a])
    heldRef.current = next
    setHeld(next)
  }
  const track = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const dx = (e.clientX - r.left - r.width / 2) / (r.width / 2)
    const dy = (e.clientY - r.top - r.height / 2) / (r.height / 2)
    // Up and down need a clearer push than left and right, as on the stick.
    apply({
      left: dx < -0.2 && Math.abs(dx) > Math.abs(dy) * 0.4,
      right: dx > 0.2 && Math.abs(dx) > Math.abs(dy) * 0.4,
      up: dy < -0.3 && Math.abs(dy) > Math.abs(dx) * 0.7,
      down: dy > 0.3 && Math.abs(dy) > Math.abs(dx) * 0.7,
    })
  }
  const arm = (on: boolean, place: string, icon: ReactNode) => (
    <span className={cn('absolute flex items-center justify-center rounded-md border border-white/20', place, on ? 'bg-white/60 text-shell' : 'bg-white/15 text-white/80')}>{icon}</span>
  )

  return (
    <div
      role="group"
      aria-label="Move"
      className="pointer-events-auto relative size-36 shrink-0 touch-none rounded-full bg-white/5"
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        track(e)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) track(e)
      }}
      onPointerUp={() => apply(NO_DIRECTION)}
      onPointerCancel={() => apply(NO_DIRECTION)}
      onLostPointerCapture={() => apply(NO_DIRECTION)}
    >
      {arm(held.left, 'left-1 top-1/2 h-11 w-12 -translate-y-1/2', <ChevronLeft className="size-5" aria-hidden />)}
      {arm(held.right, 'right-1 top-1/2 h-11 w-12 -translate-y-1/2', <ChevronRight className="size-5" aria-hidden />)}
      {arm(held.up, 'left-1/2 top-1 h-12 w-11 -translate-x-1/2', <ChevronUp className="size-5" aria-hidden />)}
      {arm(held.down, 'bottom-1 left-1/2 h-12 w-11 -translate-x-1/2', <ChevronDown className="size-5" aria-hidden />)}
    </div>
  )
}
