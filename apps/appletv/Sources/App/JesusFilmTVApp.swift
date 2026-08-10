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

struct RootView: View {
    var body: some View {
        TabView {
            HomeView()
                .tabItem { Label("Home", systemImage: "house.fill") }
            SearchView()
                .tabItem { Label("Search", systemImage: "magnifyingglass") }
            SignInView()
                .tabItem { Label("Profile", systemImage: "person.fill") }
        }
    }
}
