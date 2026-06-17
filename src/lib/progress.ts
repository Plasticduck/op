// Tiny global "is something loading" signal for the top progress bar. Ref-counted
// so overlapping loads (e.g. a route chunk + a data fetch) keep the bar visible
// until the last one finishes. Module-level so any code can drive it:
//   progress.start(); ... ; progress.done()
type Listener = (active: boolean) => void

let count = 0
const listeners = new Set<Listener>()

function emit() {
  const active = count > 0
  for (const l of listeners) l(active)
}

export const progress = {
  start() {
    count += 1
    emit()
  },
  done() {
    count = Math.max(0, count - 1)
    emit()
  },
  subscribe(listener: Listener) {
    listeners.add(listener)
    listener(count > 0)
    return () => {
      listeners.delete(listener)
    }
  },
}
