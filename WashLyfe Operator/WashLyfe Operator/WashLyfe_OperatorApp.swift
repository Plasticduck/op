//
//  WashLyfe_OperatorApp.swift
//  WashLyfe Operator
//
//  Native shell that hosts the WashLyfe Operator web app (operator.washlyfe.com)
//  in a WKWebView. On first launch we show a brief onboarding wizard that asks
//  for notification + location permission, then drop straight into the login
//  page (the public landing site is intentionally skipped — mobile users won't
//  sign up here).
//

import SwiftUI
import UserNotifications

@main
struct WashLyfe_OperatorApp: App {
    @AppStorage("washlyfe.onboarded") private var onboarded = false

    // Strong reference so notifications fire while the app is foregrounded.
    // Holding it on the App keeps it alive for the app's lifetime.
    private let notificationPresentationDelegate = NotificationPresentationDelegate()

    // Wires the AppDelegate up so iOS calls
    // didRegisterForRemoteNotificationsWithDeviceToken on us. Without this the
    // SwiftUI app would never see the APNs device token and remote pushes
    // could not reach the device.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        UNUserNotificationCenter.current().delegate = notificationPresentationDelegate
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if onboarded {
                    ContentView()
                } else {
                    OnboardingView()
                }
            }
            // Light-content status bar (white icons) against the dark navy
            // backdrop; the web content's own light/dark surfaces are unaffected.
            .preferredColorScheme(.dark)
        }
    }
}
