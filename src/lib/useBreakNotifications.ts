import { useEffect } from 'react'
import { format } from 'date-fns'
import type { Break } from '@/lib/queries/people'
import { ensureNotificationPermission, isNativeShell, notify } from '@/lib/nativeBridge'

// Per-device, per-employee preference. Opt-in: reminders are off until the
// employee turns them on themselves, so nobody gets a manager-imposed countdown
// they didn't ask for.
const prefKey = (userId: string) => `washlyfe.breakReminders.${userId}`

export function getBreakRemindersPref(userId: string): boolean {
  return localStorage.getItem(prefKey(userId)) === 'on'
}
export function setBreakRemindersPref(userId: string, on: boolean) {
  localStorage.setItem(prefKey(userId), on ? 'on' : 'off')
}

// Re-export so the dashboard's "request permission" affordance only imports
// from one place.
export { ensureNotificationPermission }

// Schedules break reminders.
//   Native iOS shell: every reminder is posted up-front to the WKWebView
//   message handler, which schedules a real UNNotificationRequest. iOS owns the
//   timing so reminders fire even when the app is backgrounded.
//   Browser: per-tab setTimeout, foreground only (same behavior as before).
export function useBreakNotifications(breaks: Break[], enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    if (!isNativeShell() && (!('Notification' in window) || Notification.permission !== 'granted')) return

    const now = Date.now()
    const timers: number[] = []
    const t = (iso: string) => format(new Date(iso), 'h:mm a')

    const at = (when: number, title: string, body: string, id: string) => {
      if (when <= now) return
      if (isNativeShell()) {
        void notify({ title, body, when, id })
      } else {
        timers.push(window.setTimeout(() => void notify({ title, body, id }), when - now))
      }
    }

    for (const b of breaks) {
      if (!b.started_at) {
        const start = new Date(b.scheduled_start).getTime()
        at(start - 5 * 60_000, 'Break starting soon', `Your break starts at ${t(b.scheduled_start)}.`, `break-start-warn-${b.id}`)
        at(start, 'Break time', 'Your scheduled break is starting now.', `break-start-${b.id}`)
      } else if (!b.ended_at) {
        const end = new Date(b.scheduled_end).getTime()
        at(end - 2 * 60_000, 'Break ending soon', 'Your break ends in about 2 minutes.', `break-end-warn-${b.id}`)
        at(end, 'Break over', 'Your break time is up. Head back when ready.', `break-end-${b.id}`)
      }
    }
    return () => timers.forEach((id) => clearTimeout(id))
  }, [breaks, enabled])
}
