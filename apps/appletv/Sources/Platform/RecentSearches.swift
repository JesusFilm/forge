import Foundation

/// Recent search queries, persisted on device.
///
/// The POLICY (dedupe case-insensitively, most recent first, capped) is ported
/// from `apps/tv/src/lib/searchHistoryMerge.ts` and must not drift between the
/// two apps — a viewer moving between them should see the same list behave the
/// same way. The STORAGE mechanics deliberately differ; see
/// `RecentSearchesStore` for why RN's hydration dance has no counterpart here.
enum RecentSearches {
    /// Maximum recent queries retained. RN's `SEARCH_HISTORY_MAX`. Small on
    /// purpose: on a TV these are a focus row, and a row you have to scroll
    /// through is slower than retyping.
    static let maxEntries = 5

    /// Maximum per-entry length, matching RN's `sanitizeQuery` cap so a long
    /// dictation transcript can never reach storage intact.
    static let maxEntryLength = 256

    /// Versioned so a future schema change (timestamps, locale, source tags)
    /// is a migration rather than a breaking read.
    static let storageKey = "tv.native.searchHistory.v1"

    /// Fold, strip, trim, cap. Returns nil for anything that reduces to empty —
    /// a blank query is not a search worth offering back to anyone.
    ///
    /// The on-screen keyboard cannot produce the stripped codepoints, but
    /// dictation and any future paste path can, and they render as nothing (or
    /// as a bidi layout attack) inside a chip.
    ///
    /// The stripped SET matches RN's `sanitizeQuery`, but not its position: RN
    /// runs that function on every keystroke into the search box, so the query
    /// it SENDS is folded, stripped and 256-capped too. This app applies it
    /// only on the way into history, and `SearchViewModel` sends the raw
    /// trimmed text. That gap is deliberate for now (the outbound query is not
    /// this unit's surface) but it is a gap, not parity — closing it belongs
    /// with whoever next owns the view model.
    static func normalize(_ query: String) -> String? {
        // NFKC first, matching RN's sanitizeQuery: it folds compatibility
        // forms so a ligature-typed query and its plain spelling occupy one
        // slot instead of two near-identical ones.
        let folded = query.precomposedStringWithCompatibilityMapping
        let stripped = String(String.UnicodeScalarView(folded.unicodeScalars.filter { !isStripped($0) }))
        let trimmed = stripped.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(maxEntryLength))
    }

    /// C0/C1 controls, zero-width spaces/joiners, directional marks, and RTL
    /// overrides — the exact set RN's `sanitizeQuery` removes.
    private static func isStripped(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x0000...0x001F, 0x007F...0x009F: return true // C0 / C1 controls
        case 0x200B...0x200F: return true                  // zero-width + LRM/RLM
        case 0x202A...0x202E: return true                  // directional overrides
        default: return false
        }
    }

    /// Dedupe-to-front merge: `query` at index 0, any prior case-insensitive
    /// occurrence removed, capped at `maxEntries`.
    ///
    /// Case-insensitive because "Jesus" and "jesus" are one search to a viewer,
    /// and with only five slots a near-duplicate costs a real one. The NEW
    /// casing wins so the list reflects what was most recently typed.
    static func merge(_ previous: [String], adding query: String) -> [String] {
        guard let normalized = normalize(query) else { return previous }
        let lowered = normalized.lowercased()
        let kept = previous.filter { $0.lowercased() != lowered }
        return Array(([normalized] + kept).prefix(maxEntries))
    }

    /// Defensive read of whatever is on disk: an older build's cap, a partial
    /// write, or a value some other code path parked under this key. Never
    /// throws — an unreadable history degrades to no history, which costs the
    /// viewer nothing they can't recreate by searching again.
    static func sanitize(_ stored: [String]?) -> [String] {
        guard let stored else { return [] }
        var result: [String] = []
        var seen: Set<String> = []
        for entry in stored {
            guard let normalized = normalize(entry) else { continue }
            guard seen.insert(normalized.lowercased()).inserted else { continue }
            result.append(normalized)
            if result.count == maxEntries { break }
        }
        return result
    }
}

/// The persisted list, as the `ObservableObject` the Search screen renders from.
///
/// No `hydrated` gate and no pending-write merge, unlike RN's
/// `useSearchHistory`. Both of those exist purely because AsyncStorage resolves
/// asynchronously, so an early write can land before the read and clobber it.
/// `UserDefaults` reads synchronously in `init`, so the first render already
/// shows the stored list and that whole class of race cannot occur here.
@MainActor
final class RecentSearchesStore: ObservableObject {
    @Published private(set) var queries: [String]

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        // `stringArray(forKey:)` already returns nil for a non-string-array
        // value, so a foreign write degrades to "no history" before sanitize
        // even sees it.
        queries = RecentSearches.sanitize(defaults.stringArray(forKey: RecentSearches.storageKey))
    }

    /// Record a query the viewer actually saw results for.
    ///
    /// Callers re-record freely (a chip re-run resolves to the same query it
    /// came from); an unchanged list short-circuits before the write, so
    /// repetition costs nothing.
    func record(_ query: String) {
        let next = RecentSearches.merge(queries, adding: query)
        guard next != queries else { return }
        queries = next
        defaults.set(next, forKey: RecentSearches.storageKey)
    }

    /// Clear all entries. Removes the key rather than writing an empty array so
    /// a cleared history is indistinguishable from one that was never written.
    func clear() {
        guard !queries.isEmpty else { return }
        queries = []
        defaults.removeObject(forKey: RecentSearches.storageKey)
    }
}
