import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { alongText, isMovable, spokenLabel, type Machine, type NudgeSize } from './machines'

// The canvas is a picture to a keyboard and a screen reader, so the machines are also
// here as real buttons, entrance to exit: out of sight, but focusable. Focus lights the
// machine in the scene, Enter selects it, Enter again opens its page. One tab stop: the
// arrow keys step between them. While machines are being arranged, Left and Right move
// the focused one instead (Up and Down still step).

type Props = {
  machines: Machine[]
  selectedId: string | null
  // Machines are being arranged: Left / Right nudge.
  arranging: boolean
  onFocus: (id: string | null) => void
  onActivate: (m: Machine) => void
  onNudge: (m: Machine, dir: -1 | 1, size: NudgeSize) => void
}

export function MachineList({ machines, selectedId, arranging, onFocus, onActivate, onNudge }: Props) {
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  // The button the keyboard last stood on: the one Tab comes back to when nothing is selected.
  const [last, setLast] = useState<string | null>(null)
  // A nudge can carry a machine past its neighbor, which reorders the list and may drop
  // the browser's focus: this is the button to put it back on.
  const keep = useRef<string | null>(null)

  useEffect(() => {
    const id = keep.current
    keep.current = null
    if (!id) return
    const el = buttons.current.get(id)
    if (el && document.activeElement !== el) el.focus()
  }, [machines])

  const has = (id: string | null) => !!id && machines.some((m) => m.item.id === id)
  const stop = has(selectedId) ? selectedId : has(last) ? last : machines[0]?.item.id ?? null

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, m: Machine, k: number) => {
    if (e.ctrlKey || e.metaKey) return
    const along = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (along && arranging && isMovable(m.item)) {
      e.preventDefault()
      keep.current = m.item.id
      onNudge(m, along, e.altKey ? 'fine' : e.shiftKey ? 'big' : 'step')
      return
    }
    if (e.altKey || e.shiftKey) return
    const step = along || (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0)
    const to = step ? machines[(k + step + machines.length) % machines.length]
      : e.key === 'Home' ? machines[0]
      : e.key === 'End' ? machines[machines.length - 1]
      : null
    if (!to) return
    e.preventDefault()
    buttons.current.get(to.item.id)?.focus()
  }

  return (
    <ul className="sr-only" aria-label="Machines in the tunnel, entrance to exit. Arrow keys move between them. Enter selects a machine, Enter again opens its page.">
      {machines.map((m, k) => (
        <li key={m.item.id}>
          <button type="button" data-t3d-machine={m.item.id}
            ref={(el) => { if (el) buttons.current.set(m.item.id, el); else buttons.current.delete(m.item.id) }}
            tabIndex={stop === m.item.id ? 0 : -1}
            aria-pressed={selectedId === m.item.id}
            aria-label={spokenLabel(m, arranging && isMovable(m.item) ? alongText(Number(m.item.x_ft), 'feet') : undefined)}
            onFocus={() => { setLast(m.item.id); onFocus(m.item.id) }}
            onBlur={() => onFocus(null)}
            onClick={() => onActivate(m)}
            onKeyDown={(e) => onKey(e, m, k)} />
        </li>
      ))}
    </ul>
  )
}
