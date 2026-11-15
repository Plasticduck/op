import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { CameraPreset, TunnelSceneApi } from '../types'
import { readCamera } from './env'

// Where the camera goes on its own: back to where it was left when the view opens (or the
// drawing changes), and to a machine when it is newly selected. Both effects read the
// scene from a ref, so on the first mount they run before the scene's first frame and the
// view opens where it should, with no glide from somewhere else.
//
// Call it after the effect that makes the scene: effects run in the order written, and
// again, in that order, for the second scene React StrictMode makes in development.

type Follow = {
  memoryKey: string
  selectedId: string | null
  // The preset the camera is on now (null: the person's own pose).
  onPreset: (p: CameraPreset | null) => void
  // A new selection, after the camera has set off toward it.
  onSelected: (id: string) => void
}

export function useCameraFollow(scene: RefObject<TunnelSceneApi | null>, follow: Follow) {
  const { memoryKey, selectedId } = follow
  // The latest selection and handlers, for effects that must not re-run when they change.
  const latest = useRef(follow)
  useLayoutEffect(() => { latest.current = follow })

  const restoredFor = useRef<TunnelSceneApi | null>(null)
  useEffect(() => {
    const s = scene.current
    if (!s) return
    const first = restoredFor.current !== s
    restoredFor.current = s
    const { onPreset, selectedId: id } = latest.current
    const mem = readCamera(memoryKey)
    if (mem?.preset) {
      // A preset by name: the scene refits it to the canvas as it is now.
      s.setPreset(mem.preset, { instant: true })
      onPreset(mem.preset)
    } else if (mem?.pose) {
      s.setPose(mem.pose)
      onPreset(null)
    } else {
      // Nothing remembered. Another drawing in the same scene starts from the overview;
      // a link straight to a machine opens on that machine.
      if (!first) s.setPreset('overview', { instant: true })
      onPreset('overview')
      if (first && id) s.flyTo(id, { instant: true })
    }
  }, [scene, memoryKey])

  // Not the selection the view was mounted with: that one got the camera above.
  const selectedFor = useRef<TunnelSceneApi | null>(null)
  useEffect(() => {
    const s = scene.current
    if (!s) return
    const first = selectedFor.current !== s
    selectedFor.current = s
    if (first || !selectedId) return
    s.flyTo(selectedId)
    latest.current.onSelected(selectedId)
  }, [scene, selectedId])
}
