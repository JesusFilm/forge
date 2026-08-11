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
    @StateObject private var settings = AppSettings()

    @State private var homePath = NavigationPath()
    @State private var searchPath = NavigationPath()

    var body: some View {
        TabView {
            // `.focusSection()` on each tab's content ROOT, not just inside
            // it: the stack becomes the container the engine must aim at, and
            // a plain container is not itself a directional target.
            Tab("Home", systemImage: "house.fill") {
                NavigationStack(path: $homePath) {
                    HomeView(viewModel: homeViewModel) { homePath.append($0) }
                        .navigationDestination(for: Route.self) { route in
                            destination(route) { homePath.append($0) }
                        }
                }
                .focusSection()
            }
            Tab("Search", systemImage: "magnifyingglass") {
                NavigationStack(path: $searchPath) {
                    SearchView(viewModel: searchViewModel)
                        .navigationDestination(for: Route.self) { route in
                            destination(route) { searchPath.append($0) }
                        }
                }
                .focusSection()
            }
            Tab("Profile", systemImage: "person.fill") {
                SignInView(model: signInViewModel)
                    .focusSection()
            }
            Tab("Settings", systemImage: "gearshape.fill") {
                SettingsView(settings: settings)
                    .focusSection()
            }
        }
        .background(Theme.background.ignoresSafeArea())
    }

    /// One destination table shared by every stack, so a route means the same
    /// thing wherever it is pushed from. `push` is THREADED IN rather than
    /// captured, because the table cannot know which stack it is rendering
    /// inside — and a screen pushing onto the wrong stack strands the viewer
    /// in a tab they never navigated from.
    @ViewBuilder
    private func destination(
        _ route: Route,
        push: @escaping (Route) -> Void
    ) -> some View {
        switch route {
        case .video(let slug):
            WatchView(slug: slug, navigate: push)
        case .series(let slug):
            SeriesView(slug: slug, navigate: push)
        case .experience(let slug):
            ExperienceView(slug: slug, navigate: push)
        }
    }
}
