import { useEffect, useRef, useState } from 'react'

// Reveals a growing string a word at a time so streamed text reads at a human
// pace instead of dumping tokens the instant they arrive.
//
// The interval is deliberately not keyed to `target`: deltas land faster than
// the reveal cadence, so restarting the timer on every change would clear the
// pending tick before it ever fired and nothing would type. Instead one timer
// runs and reads the latest target through a ref.
export function useTypewriter(target: string, msPerWord = 90): string {
  const [shown, setShown] = useState('')
  const targetRef = useRef(target)
  const cursor = useRef(0)

  useEffect(() => {
    targetRef.current = target
    // A target shorter than what we have already revealed means a new answer
    // started (or a preamble was cleared), so rewind.
    if (target.length < cursor.current) {
      cursor.current = 0
      setShown('')
    }
  }, [target])

  useEffect(() => {
    const id = setInterval(() => {
      const full = targetRef.current
      if (cursor.current >= full.length) return
      // Catch up when the model runs far ahead, so the reveal trails the
      // stream by a beat rather than falling minutes behind on a long answer.
      const backlog = full.length - cursor.current
      const words = backlog > 1500 ? 6 : backlog > 700 ? 3 : backlog > 280 ? 2 : 1
      let next = cursor.current
      for (let w = 0; w < words && next < full.length; w++) next = wordEnd(full, next)
      cursor.current = next
      setShown(full.slice(0, next))
    }, msPerWord)
    return () => clearInterval(id)
  }, [msPerWord])

  return shown
}

// End of the next word after `from`, keeping the whitespace that precedes it so
// the revealed slice never loses its line breaks.
function wordEnd(s: string, from: number): number {
  let i = from
  while (i < s.length && /\s/.test(s[i])) i++
  while (i < s.length && !/\s/.test(s[i])) i++
  return i
}
