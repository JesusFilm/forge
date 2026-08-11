import SwiftUI

/// Settings — ported from `apps/tv/src/components/settings/SettingsScreen.tsx`.
///
/// RN's v1 content is Showcase Mode only: a start action and the launch-only
/// auto-start toggle, both persisted on device. This is that screen in system
/// components. The RN original hand-rolls its rows because React Native has no
/// list primitive worth the name; here `List` + `Toggle` already own the focus
/// visuals, the switch semantics, and the accessibility roles that file spends
/// ~100 lines re-implementing.
///
/// Two RN mechanisms have no counterpart and should not be re-added:
/// `focusMemory` (a react-native-tvos #852 workaround for focus lost on a stack
/// pop — the system navigation stack restores focus itself) and the `hydrated`
/// disable gate (see `AppSettings`, whose read is synchronous).
struct SettingsView: View {
    @ObservedObject var settings: AppSettings

    /// Local rather than a `Route` case: the showcase reel is a later unit, so
    /// this destination is a stated gap, not a navigation contract other
    /// screens should start pushing.
    @State private var showingShowcase = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button {
                        showingShowcase = true
                    } label: {
                        Label("Start Showcase", systemImage: "play.circle")
                    }

                    Toggle(isOn: $settings.showcaseAutoStart) {
                        Label("Auto-start when the app opens", systemImage: "power")
                    }
                } header: {
                    Text("Showcase Mode")
                } footer: {
                    Text(
                        """
                        Plays films back to back, unattended. Any button on the \
                        remote stops the reel and brings you back here. \
                        Auto-start only runs when the app opens — stopping the \
                        reel never turns it off.
                        """
                    )
                }
            }
            .navigationTitle("Settings")
            .navigationDestination(isPresented: $showingShowcase) {
                showcasePlaceholder
            }
        }
    }

    /// The one wiring point for the showcase unit: replace this body with the
    /// reel's own view and the row is live — the row, its persistence, and the
    /// auto-start contract need no change.
    ///
    /// Until then it states the gap rather than disabling the row. A disabled
    /// row is not focusable on tvOS, and a hole in the only focusable region on
    /// a screen is how directional descent from the tab bar dies.
    private var showcasePlaceholder: some View {
        ContentUnavailableView {
            Label("Showcase coming soon", systemImage: "film.stack")
        } description: {
            Text("The unattended reel isn't part of this build yet.")
        }
    }
}
