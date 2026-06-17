//
//  ContentView.swift
//  WashLyfe Operator
//
//  Hosts operator.washlyfe.com in a WKWebView with the niceties expected of a
//  native iOS shell:
//    - Pull-to-refresh
//    - Edge-swipe back gesture (browser-style history)
//    - mailto:/tel:/sms: + cross-host links open in Safari instead of in-app
//    - Offline retry screen instead of a blank white WebView
//    - Dark navy background fills behind the safe areas so the status bar and
//      home-indicator regions look like part of the app, not a system flash
//

import SwiftUI
import WebKit

// Start at /login — the public landing/pricing/demo pages aren't useful inside
// the native shell (users sign up on desktop, then sign in here). Supabase's
// own session detection bounces already-authed users to /app/dashboard
// immediately, so a logged-in user never sees the login screen on relaunch.
private let SITE_URL = URL(string: "https://operator.washlyfe.com/login")!

// `#0B0F14` — same shade as the web app's bg-shell token (Tailwind theme).
private let appShellColor = Color(red: 11 / 255, green: 15 / 255, blue: 20 / 255)
private let appShellUIColor = UIColor(red: 11 / 255, green: 15 / 255, blue: 20 / 255, alpha: 1)

struct ContentView: View {
    @StateObject private var store = WebStore()
    @State private var isLoading = true
    @State private var loadFailed = false

    var body: some View {
        ZStack {
            // Fills the entire screen (including under the notch + home
            // indicator) so the WebView never reveals a white system surface.
            appShellColor.ignoresSafeArea()

            // Edge-to-edge: the WebView extends under the status bar and home
            // indicator. The web app's CSS uses env(safe-area-inset-*) so its
            // header/bottom-nav padding land correctly under the notch.
            WebContainer(
                url: SITE_URL,
                store: store,
                isLoading: $isLoading,
                loadFailed: $loadFailed
            )
            .ignoresSafeArea()

            if loadFailed {
                offlineRetry
            } else if isLoading {
                ProgressView()
                    .progressViewStyle(.circular)
                    .tint(.white)
            }
        }
    }

    private var offlineRetry: some View {
        VStack(spacing: 12) {
            Text("Can't reach WashLyfe Operator")
                .font(.headline)
                .foregroundStyle(.white)
            Text("Check your connection, then try again.")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.7))
            Button {
                loadFailed = false
                isLoading = true
                store.webView.load(URLRequest(url: SITE_URL))
            } label: {
                Text("Retry").padding(.horizontal, 8)
            }
            .buttonStyle(.borderedProminent)
            .tint(.white)
            .foregroundStyle(appShellColor)
            .padding(.top, 4)
        }
        .padding(24)
    }
}

/// Holds the WKWebView across SwiftUI re-renders so navigation history and the
/// in-memory session aren't blown away on every state change.
final class WebStore: ObservableObject {
    let webView: WKWebView

    // Strong reference held by the store so it lives as long as the WebView.
    private let notificationBridge = NotificationBridge()
    private var tokenObserver: NSObjectProtocol?

    init() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let prefs = WKWebpagePreferences()
        prefs.allowsContentJavaScript = true
        config.defaultWebpagePreferences = prefs

        // Persistent data store — keeps the Supabase auth session (cookies +
        // localStorage + IndexedDB) across app launches.
        config.websiteDataStore = .default()

        // Inject a flag at document-start so the web app's nativeBridge shim
        // knows it's running inside the native shell before any JS runs, plus
        // wire up the JS → native message handler that schedules local
        // notifications when the web posts to it. Also stash the bundle id so
        // the page knows which APNs topic to register against.
        let bundleId = Bundle.main.bundleIdentifier ?? ""
        let controller = WKUserContentController()
        let nativeFlag = WKUserScript(
            source: "window.__washlyfeNative = true; window.__washlyfeBundleId = \"\(bundleId)\";",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        controller.addUserScript(nativeFlag)
        controller.add(notificationBridge, name: NotificationBridge.messageHandlerName)
        config.userContentController = controller

        let wv = WKWebView(frame: .zero, configuration: config)
        wv.allowsBackForwardNavigationGestures = true
        // Edge-to-edge: don't let iOS push the WebView content down past the
        // safe areas. The web app's CSS handles env(safe-area-inset-*) itself,
        // so the page header/bottom-nav already pad themselves correctly.
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        wv.scrollView.bounces = true
        wv.isOpaque = false
        wv.backgroundColor = appShellUIColor
        wv.scrollView.backgroundColor = .clear
        self.webView = wv

        // Push the APNs token into the page as soon as it's captured. The
        // page might not have loaded the JS handler yet — that's fine, the
        // call is a no-op until window.__washlyfeAPNsToken is defined, and
        // we send the token again on every WebView reload from the
        // navigationDelegate side too (see ContentView's coordinator).
        tokenObserver = NotificationCenter.default.addObserver(
            forName: APNsTokenStore.didUpdateNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let self, let token = note.object as? String else { return }
            self.forwardAPNsTokenToWeb(token)
        }
    }

    deinit {
        if let tokenObserver { NotificationCenter.default.removeObserver(tokenObserver) }
    }

    /// Push the latest APNs token (if any) into the WebView. Safe to call
    /// repeatedly. Called both on token-arrival and after every successful
    /// page load so a deep-link / reload still receives the token.
    func forwardAPNsTokenToWeb(_ token: String? = nil) {
        let t = token ?? APNsTokenStore.shared.token
        guard let t else { return }
        let js = "window.__washlyfeAPNsToken && window.__washlyfeAPNsToken(\"\(t)\");"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }
}

private struct WebContainer: UIViewRepresentable {
    let url: URL
    let store: WebStore
    @Binding var isLoading: Bool
    @Binding var loadFailed: Bool

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let wv = store.webView
        wv.navigationDelegate = context.coordinator
        wv.uiDelegate = context.coordinator

        // Pull-to-refresh, native iOS spinner.
        let refresh = UIRefreshControl()
        refresh.tintColor = .white
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.refresh(_:)), for: .valueChanged)
        wv.scrollView.refreshControl = refresh

        if wv.url == nil {
            wv.load(URLRequest(url: url))
        }
        return wv
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        private let parent: WebContainer
        init(_ parent: WebContainer) { self.parent = parent }

        // MARK: navigation lifecycle

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            DispatchQueue.main.async { self.parent.isLoading = true }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.async {
                self.parent.isLoading = false
                self.parent.loadFailed = false
            }
            webView.scrollView.refreshControl?.endRefreshing()
            // Re-push the APNs token after each finished navigation so the page
            // can register it server-side even on a hard refresh or deep link.
            self.parent.store.forwardAPNsTokenToWeb()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            handleFail(error, refreshing: webView.scrollView.refreshControl)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            handleFail(error, refreshing: webView.scrollView.refreshControl)
        }

        private func handleFail(_ error: Error, refreshing: UIRefreshControl?) {
            refreshing?.endRefreshing()
            // -999 is "operation cancelled" (e.g. user tapped another link
            // before the previous load finished); that's not a real failure.
            if (error as NSError).code == NSURLErrorCancelled { return }
            DispatchQueue.main.async {
                self.parent.isLoading = false
                self.parent.loadFailed = true
            }
        }

        @objc func refresh(_ sender: UIRefreshControl) {
            parent.store.webView.reload()
        }

        // MARK: link routing

        /// Keep our own pages in-app; hand off everything else to Safari /
        /// Mail / Phone / Messages. Stripe checkout and Supabase auth verify
        /// URLs are allow-listed so billing and magic-link flows complete
        /// without bouncing the user out of the app.
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let target = navigationAction.request.url else {
                decisionHandler(.allow); return
            }

            let scheme = (target.scheme ?? "").lowercased()
            let inAppSchemes: Set<String> = ["http", "https", "about", "blob", "data"]
            if !inAppSchemes.contains(scheme) {
                UIApplication.shared.open(target)
                decisionHandler(.cancel)
                return
            }

            let host = (target.host ?? "").lowercased()
            let inAppHosts: Set<String> = [
                "operator.washlyfe.com",
                "checkout.stripe.com",
                "billing.stripe.com",
            ]
            let isSupabaseAuth = host.hasSuffix(".supabase.co")

            if inAppHosts.contains(host) || isSupabaseAuth {
                decisionHandler(.allow)
            } else if navigationAction.navigationType == .linkActivated {
                UIApplication.shared.open(target)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
        }

        /// `target=_blank` links normally request a new WKWebView; we don't
        /// have one to give them, so hand off to Safari instead of silently
        /// dropping the navigation.
        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if let target = navigationAction.request.url {
                UIApplication.shared.open(target)
            }
            return nil
        }
    }
}

#Preview {
    ContentView()
}
