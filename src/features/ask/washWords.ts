// Car wash flavored progress verbs for Operator AI. The status line cycles
// through these while an answer is being worked out, so a slow question still
// reads as something happening rather than a dead spinner. Each pool is tied
// to what the assistant is actually doing at that moment: prepping before it
// commits, agitating while a query runs, finishing while it writes the answer.

export type WashPhase = 'thinking' | 'tool' | 'writing'

const POOLS: Record<WashPhase, string[]> = {
  thinking: [
    'Pre-soaking',
    'Sudsing',
    'Foaming',
    'Lathering',
    'Bubbling',
    'Prepping',
    'Soaking',
    'Misting',
    'Triple-foaming',
  ],
  tool: [
    'Washing',
    'Scrubbing',
    'Rinsing',
    'Brushing',
    'Blasting',
    'Agitating',
    'Reclaiming',
    'Degreasing',
    'Power-rinsing',
    'Working',
  ],
  writing: [
    'Detailing',
    'Drying',
    'Buffing',
    'Polishing',
    'Waxing',
    'Shining',
    'Towel-drying',
    'Finishing',
  ],
}

// `tick` is a free-running counter, so the word keeps moving on a timer and
// also changes the moment the phase does.
export function washWord(phase: WashPhase, tick: number): string {
  const pool = POOLS[phase]
  return pool[Math.abs(tick) % pool.length]
}
