//
//  AppDelegate.swift
//  WashLyfe Operator
//
//  Registers the app for Apple Push Notification service (APNs) and captures
//  the device token. The token is stashed on the shared APNsTokenStore so the
//  WebView's JS bridge can read it back during the SwiftUI lifecycle (see
//  ContentView.swift -> WebStore which forwards it into the page via
//  `window.__washlyfeAPNsToken(...)`).
//
//  Notes:
//  - aps-environment must be set in WashLyfe_Operator.entitlements (we ship
//    "production"; Xcode automatically downgrades to development when running
//    a debug build via APS environment substitution).
//  - The bundle id WashLyfe-Media.WashLyfe-Operator must have Push
//    Notifications capability enabled in the Apple Developer portal, and a
//    matching APNs Auth Key (.p8) must exist for the team.
//  - We never crash on failure to register: APNs just stops working for that
//    install, the bridge-based foreground notifications still fire, and the
//    user can re-launch later to retry.
//

import UIKit
import UserNotifications

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Kick off remote-notification registration immediately. The OS will
        // call back into didRegisterForRemoteNotificationsWithDeviceToken once
        // the user has granted notification permission AND the network is up.
        // Calling this before permission is granted is fine — iOS queues it.
        DispatchQueue.main.async {
            UIApplication.shared.registerForRemoteNotifications()
        }
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        APNsTokenStore.shared.set(token: hex)
        NSLog("[AppDelegate] APNs device token captured (\(hex.count / 2) bytes)")
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Simulator builds always fail here (no APNs in the simulator). On
        // device, common causes are: no Push capability for the bundle id,
        // expired provisioning profile, or no network. Log only.
        NSLog("[AppDelegate] APNs registration failed: \(error.localizedDescription)")
    }
}

/// Shared store that holds the most recently captured APNs device token so the
/// WebView can pull it after JS finishes booting. Observers (NotificationCenter
/// posts) let the WebView push the token into the page as soon as it arrives,
/// even if registration completes after the page has already loaded.
final class APNsTokenStore {
    static let shared = APNsTokenStore()
    static let didUpdateNotification = Notification.Name("APNsTokenStoreDidUpdate")

    private(set) var token: String?

    func set(token: String) {
        self.token = token
        NotificationCenter.default.post(name: APNsTokenStore.didUpdateNotification, object: token)
    }
}
