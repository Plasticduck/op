// The beep and buzz when a scanner reads a code. iOS only lets a page make
// sound after a tap, so call primeScanSound() from the tap that opens the
// scanner. Phones without vibration (iPhone in Safari) just beep.

type AudioCtor = typeof AudioContext
let ctx: AudioContext | null = null

export function primeScanSound() {
  try {
    const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext) as AudioCtor | undefined
    if (!ctx && Ctor) ctx = new Ctor()
    void ctx?.resume()
  } catch {
    // no audio: scanning still works
  }
}

export function scanFeedback() {
  try {
    navigator.vibrate?.(35)
  } catch {
    // not supported
  }
  if (!ctx) return
  try {
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 1760
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.2, t + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.13)
  } catch {
    // ignore
  }
}
