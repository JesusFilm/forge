import Foundation

/// On-device app preferences, persisted to `UserDefaults`.
///
/// Ported from `apps/tv/src/lib/showcaseMode/prefs.ts`. Two RN mechanisms are
/// deliberately absent: the `hydrated` gate and the pending-write merge. Both
/// exist because AsyncStorage resolves asynchronously — RN's toggle row can
/// otherwise claim "Off" over a stored "On", and a press would write that guess
/// back. `UserDefaults` reads synchronously in `init`, so the first render
/// already shows the stored value and there is no window to write a guess into.
@MainActor
final class AppSettings: ObservableObject {
    enum Key {
        /// Versioned so a future schema change (dwell time, curated source,
        /// language rotation) is a migration, not a breaking read.
        static let showcaseAutoStart = "tv.native.showcaseMode.v1.autoStart"
    }

    /// Start the showcase reel on cold start.
    ///
    /// Launch-only by contract, matching RN: exiting the reel returns the
    /// viewer here and must never clear this flag. A shared TV in a lobby is
    /// the whole point — someone stopping the reel to watch something is not
    /// asking to disable it for tomorrow.
    @Published var showcaseAutoStart: Bool {
        didSet {
            guard showcaseAutoStart != oldValue else { return }
            defaults.set(showcaseAutoStart, forKey: Key.showcaseAutoStart)
        }
    }

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        // `bool(forKey:)` answers false for an absent key, which is exactly the
        // RN default (`DEFAULT_SHOWCASE_PREFS.autoStart === false`).
        // Assignment in `init` does not fire `didSet`, so hydrating cannot
        // write back over what it just read.
        showcaseAutoStart = defaults.bool(forKey: Key.showcaseAutoStart)
    }
}
