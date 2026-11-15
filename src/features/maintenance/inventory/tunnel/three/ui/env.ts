import { useSyncExternalStore } from 'react'
import type { CameraPose, CameraPreset, ThemeName } from '../types'

// What the 3D view reads from the page around it: the theme, the motion preference, and
// the few things it remembers between visits.

// The app's theme is the `dark` class on <html> (src/lib/theme.ts).
function watchTheme(changed: () => void) {
  const mo = new MutationObserver(changed)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => mo.disconnect()
}
const readTheme = (): ThemeName => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')
export const useThemeName = (): ThemeName => useSyncExternalStore(watchTheme, readTheme)

const REDUCED = '(prefers-reduced-motion: reduce)'
function watchMotion(changed: () => void) {
  const m = window.matchMedia(REDUCED)
  m.addEventListener('change', changed)
  return () => m.removeEventListener('change', changed)
}
export const prefersReducedMotion = (): boolean => window.matchMedia(REDUCED).matches
export const useReducedMotion = (): boolean => useSyncExternalStore(watchMotion, prefersReducedMotion)

// Storage can be missing or full (private windows): remembering is a nicety, never a need.
export function readStore(where: 'local' | 'session', key: string): string | null {
  try {
    return (where === 'local' ? localStorage : sessionStorage).getItem(key)
  } catch {
    return null
  }
}
export function writeStore(where: 'local' | 'session', key: string, value: string) {
  try {
    (where === 'local' ? localStorage : sessionStorage).setItem(key, value)
  } catch {
    // Nothing to do: the view works without it.
  }
}

// Where the camera was, per drawing, for this browser tab: coming back from a machine's
// page puts the person where they were. A preset is remembered by name, because the
// scene refits it to whatever size the canvas is then. `framed` is the preset last
// picked, also once the camera has left it (Tunnel3D frames the top view clear of the
// legend), so a pose comes back framed as it was left.
export type CameraMemory = { pose: CameraPose | null; preset: CameraPreset | null; framed: CameraPreset | null }
const CAM_KEY = 'mi.tunnel.cam:'

const triple = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
const presetOf = (v: unknown): CameraPreset | null => (v === 'overview' || v === 'entrance' || v === 'top' ? v : null)

export function readCamera(memoryKey: string): CameraMemory | null {
  const raw = readStore('session', CAM_KEY + memoryKey)
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as { pose?: { position?: unknown; target?: unknown }; preset?: unknown; framed?: unknown }
    const preset = presetOf(v.preset)
    const pose = v.pose && triple(v.pose.position) && triple(v.pose.target) ? { position: v.pose.position, target: v.pose.target } : null
    return pose || preset ? { pose, preset, framed: presetOf(v.framed) ?? preset } : null
  } catch {
    return null
  }
}
export function writeCamera(memoryKey: string, pose: CameraPose, preset: CameraPreset | null, framed: CameraPreset) {
  writeStore('session', CAM_KEY + memoryKey, JSON.stringify({ pose, preset, framed }))
}
