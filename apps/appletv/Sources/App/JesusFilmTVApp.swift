import SwiftUI

/// Native tvOS app (feat: Apple TV in the Apple ecosystem).
///
/// A parallel client to the React Native TV app, speaking the same production
/// APIs: admin GraphQL for content, Mux HLS for playback, and the feat-322
/// device grant for sign-in. Same backends, native shell — the point is to
/// evaluate the platform, not fork the product.
@main
struct JesusFilmTVApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(.dark)
        }
    }
}

/// Native chrome, by decision: everything that CAN be a system component IS
/// one. The system TabView owns the bar, its focus routing, and its collapse
/// behavior; `.searchable` owns the keyboard (with the Siri remote's
/// dictation key); `.card` owns card focus; AVKit owns transport. The one
/// prior hardware test that failed ran a hand-built pill bar — the system
/// bar never ran on real hardware before this. The WATCH product identity
/// lives in the CONTENT (near-black ground, red eyebrows, hero composition),
/// not in re-implemented chrome.
struct RootView: View {
    // View models live at the root so tab switches never lose screen state.
    @StateObject private var homeViewModel = HomeViewModel()
    @StateObject private var searchViewModel = SearchViewModel()
    @StateObject private var signInViewModel = SignInViewModel()

    var body: some View {
        TabView {
            Tab("Home", systemImage: "house.fill") {
                NavigationStack {
                    HomeView(viewModel: homeViewModel)
                        .navigationDestination(for: Route.self, destination: destination)
                }
            }
            Tab("Search", systemImage: "magnifyingglass") {
                NavigationStack {
                    SearchView(viewModel: searchViewModel)
                        .navigationDestination(for: Route.self, destination: destination)
                }
            }
            Tab("Profile", systemImage: "person.fill") {
                SignInView(model: signInViewModel)
            }
        }
        .background(Theme.background.ignoresSafeArea())
    }

    /// One destination table shared by every stack, so a route means the same
    /// thing wherever it is pushed from.
    @ViewBuilder
    private func destination(for route: Route) -> some View {
        switch route {
        case .video(let slug):
            WatchView(slug: slug)
        case .series(let slug):
            // Series lands in PR3. Routing to the video detail is wrong for a
            // collection, so this states the gap rather than showing
            // something misleading.
            ContentUnavailableView {
                Label("Series coming soon", systemImage: "square.stack")
            } description: {
                Text(slug)
            }
        case .experience(let slug):
            ContentUnavailableView {
                Label("Experience coming soon", systemImage: "sparkles")
            } description: {
                Text(slug)
            }
        }
    }
}
