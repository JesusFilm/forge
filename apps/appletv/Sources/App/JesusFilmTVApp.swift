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

/// Custom chrome instead of TabView: the RN app's floating pill bar over
/// full-bleed content IS the product's look, and the system tab bar reads as
/// a different app. Sections stay mounted (ZStack + opacity) so switching
/// tabs never drops screen state — matching how the RN navigator behaves.
struct RootView: View {
    @State private var section: TopBarSection = .home

    var body: some View {
        ZStack(alignment: .top) {
            Theme.background.ignoresSafeArea()

            // `.disabled` on the hidden sections is load-bearing, not polish:
            // an opacity-0 view is still focusable on tvOS, and invisible
            // focus targets make the D-pad feel haunted.
            ZStack {
                HomeView()
                    .opacity(section == .home ? 1 : 0)
                    .disabled(section != .home)
                SearchView()
                    .opacity(section == .search ? 1 : 0)
                    .disabled(section != .search)
                SignInView()
                    .opacity(section == .profile ? 1 : 0)
                    .disabled(section != .profile)
            }

            TopBar(section: $section)
                .padding(.top, 24)
        }
    }
}
