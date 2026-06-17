//
//  NotificationBridge.swift
//  WashLyfe Operator
//
//  Bridges PWA-style notification calls in the web app over to native iOS local
//  notifications (UNUserNotificationCenter). The web code wraps its existing
//  `Notification` usage in `src/lib/nativeBridge.ts`; when the bridge detects
//  the native shell it posts a JSON payload to `window.webkit.messageHandlers
//  .washlyfeBridge.postMessage(...)`, which lands in this class.
//
//  Payload shape (see nativeBridge.ts for the source of truth):
//    { "type": "notify",
//      "title": "Break starting soon",
//      "body":  "Your break starts at 3:15 PM.",
//      "when":  1717612200000,   // optional unix ms — schedules for that time
//      "id":    "break-<uuid>" } // optional; used to deduplicate
//
//  Notifications are local-only (no APNs cert / server-side push needed). They
//  fire when the app is foregrounded *or* backgrounded, so the existing
//  foreground-only web reminders effectively become real background reminders
//  once the user has the iOS app installed.
//

import Foundation
import UserNotifications
import WebKit

final class NotificationBridge: NSObject, WKScriptMessageHandler {
    static let messageHandlerName = "washlyfeBridge"

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let payload = message.body as? [String: Any],
              let type = payload["type"] as? String else { return }

        switch type {
        case "notify":
            scheduleNotify(payload: payload)
        default:
            break
        }
    }

    private func scheduleNotify(payload: [String: Any]) {
        let title = (payload["title"] as? String) ?? ""
        let body = (payload["body"] as? String) ?? ""
        guard !title.isEmpty || !body.isEmpty else { return }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default

        var trigger: UNNotificationTrigger?
        // `when` is milliseconds since epoch. If it's in the future schedule for
        // that moment; otherwise fire ~immediately. Local notifications can't
        // schedule below ~1s reliably, so clamp.
        if let whenMs = payload["when"] as? Double {
            let interval = max(1, (whenMs / 1000) - Date().timeIntervalSince1970)
            trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
        }

        // Identifier de-dupes: re-scheduling with the same id replaces the
        // pending request, so a re-render of useBreakNotifications doesn't
        // produce stacked alerts.
        let id = (payload["id"] as? String) ?? UUID().uuidString
        let request = UNNotificationRequest(identifier: id, content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request) { error in
            if let error {
                // Fail soft — there's no useful action to take if scheduling
                // failed (perms revoked, etc.); just log for diagnostics.
                NSLog("[NotificationBridge] add failed: \(error.localizedDescription)")
            }
        }
    }
}

// MARK: - Foreground presentation

/// Allows notifications to display banner + sound while the app is foregrounded
/// (default iOS behavior is to suppress them).
final class NotificationPresentationDelegate: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .list])
    }
}
