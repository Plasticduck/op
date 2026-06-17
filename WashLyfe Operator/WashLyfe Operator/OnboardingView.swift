//
//  OnboardingView.swift
//  WashLyfe Operator
//
//  First-launch wizard. Three slides: welcome, notifications, location. Each
//  permission prompt is optional — the user can skip and grant later from iOS
//  Settings. On finish, sets the `washlyfe.onboarded` UserDefaults flag so the
//  wizard never reappears (until the app is reinstalled).
//

import SwiftUI
import UserNotifications
import CoreLocation

private let appShellColor = Color(red: 11 / 255, green: 15 / 255, blue: 20 / 255)
private let washlyfeAccent = Color(red: 37 / 255, green: 99 / 255, blue: 235 / 255)

struct OnboardingView: View {
    @AppStorage("washlyfe.onboarded") private var onboarded = false
    @State private var step = 0
    @State private var working = false

    // Held for the duration of the wizard so the iOS permission dialog has an
    // owning manager. We don't need to read its location yet.
    private let locationManager = CLLocationManager()

    var body: some View {
        ZStack {
            appShellColor.ignoresSafeArea()
            VStack(spacing: 0) {
                pageIndicator
                    .padding(.top, 24)
                content
                    .transition(.asymmetric(
                        insertion: .move(edge: .trailing).combined(with: .opacity),
                        removal: .move(edge: .leading).combined(with: .opacity)
                    ))
                    .id(step) // forces transition between steps
            }
        }
        .foregroundStyle(.white)
        .preferredColorScheme(.dark)
    }

    @ViewBuilder
    private var content: some View {
        switch step {
        case 0: welcomeStep
        case 1: notificationsStep
        case 2: locationStep
        default: EmptyView()
        }
    }

    // MARK: indicator

    private var pageIndicator: some View {
        HStack(spacing: 6) {
            ForEach(0..<3, id: \.self) { i in
                Capsule()
                    .fill(i == step ? washlyfeAccent : Color.white.opacity(0.15))
                    .frame(width: i == step ? 24 : 8, height: 4)
                    .animation(.easeInOut(duration: 0.2), value: step)
            }
        }
    }

    // MARK: steps

    private var welcomeStep: some View {
        slide(
            symbol: "sparkles",
            title: "Welcome to WashLyfe Operator",
            blurb: "The operations app for car wash teams. Real-time schedules, breaks, work orders, and site insights, all in one place.",
            primary: ("Get Started", { advance() }),
            secondary: nil
        )
    }

    private var notificationsStep: some View {
        slide(
            symbol: "bell.badge",
            title: "Stay on top of breaks and shifts",
            blurb: "Allow notifications so we can remind you when your break is starting, when a shift is up next, or when a work order is assigned.",
            primary: ("Allow Notifications", { requestNotifications() }),
            secondary: ("Not now", { advance() })
        )
    }

    private var locationStep: some View {
        slide(
            symbol: "location.fill",
            title: "Surface your nearest site",
            blurb: "Allow location so the app can default to the site you're at and show accurate local weather. You can still pick any site you have access to.",
            primary: ("Allow Location", { requestLocation() }),
            secondary: ("Not now", { finish() })
        )
    }

    private func slide(
        symbol: String,
        title: String,
        blurb: String,
        primary: (String, () -> Void),
        secondary: (String, () -> Void)?
    ) -> some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: symbol)
                .font(.system(size: 56, weight: .semibold))
                .foregroundStyle(washlyfeAccent)
                .padding(28)
                .background(
                    Circle()
                        .fill(washlyfeAccent.opacity(0.12))
                )
            VStack(spacing: 12) {
                Text(title)
                    .font(.title2)
                    .fontWeight(.semibold)
                    .multilineTextAlignment(.center)
                Text(blurb)
                    .font(.body)
                    .foregroundStyle(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 24)
            Spacer()
            VStack(spacing: 12) {
                Button {
                    primary.1()
                } label: {
                    Text(primary.0)
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
                .background(washlyfeAccent)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .disabled(working)

                if let secondary {
                    Button(secondary.0) { secondary.1() }
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.6))
                        .padding(.vertical, 4)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
    }

    // MARK: permission actions

    private func requestNotifications() {
        working = true
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { _, _ in
            DispatchQueue.main.async {
                working = false
                advance()
            }
        }
    }

    private func requestLocation() {
        working = true
        // `requestWhenInUseAuthorization` doesn't have a completion handler; the
        // system dialog yields whether the user allowed or denied via the
        // delegate. We don't need the answer to proceed — either way we move on.
        locationManager.requestWhenInUseAuthorization()
        // Tiny delay so the iOS sheet animates out before we transition to the
        // WebView underneath.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            working = false
            finish()
        }
    }

    // MARK: navigation

    private func advance() {
        withAnimation(.easeInOut(duration: 0.25)) {
            step += 1
        }
    }

    private func finish() {
        withAnimation(.easeInOut(duration: 0.25)) {
            onboarded = true
        }
    }
}

#Preview {
    OnboardingView()
}
