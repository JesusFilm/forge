import Foundation

/// The ONE predicate that decides whether a Video record is series-shaped, and
/// the routing built on it.
///
/// Ported verbatim from `apps/tv/src/lib/isSeriesRecord.ts`, including the two
/// rules its comment records the hard way:
///
///  1. **Children do NOT make a video series-shaped.** Feature films carry
///     their own chapter clips (JESUS has 61), so counting children billed ten
///     films as series. The label is the whole predicate — `childCount`, or a
///     non-empty `children`, is never a proxy.
///  2. **Matching is STRICT UPPERCASE**, not case-folded. Case folding lets a
///     lowercase fixture pass and hides the fact that nothing on the wire is
///     ever lowercase — `VideoLabel` is a GraphQL enum, so `SERIES` and
///     `COLLECTION` are the only spellings production can emit.
///
/// One predicate, not two: a second copy is what split the series and watch
/// redirect seams in the React Native app and let a record bounce between them.
enum SeriesShape {
    /// `VideoLabel` values that mean "this record's media lives on its
    /// children". The other six (`FEATURE_FILM`, `EPISODE`, `SEGMENT`,
    /// `SHORT_FILM`, `BEHIND_THE_SCENES`, `TRAILER`) are leaves.
    private static let seriesLabels: Set<String> = ["SERIES", "COLLECTION"]

    static func isSeriesLabel(_ label: String?) -> Bool {
        guard let label else { return false }
        return seriesLabels.contains(label)
    }

    /// Where a card carrying this label should go. Used by the episode rail —
    /// a series' child can itself be a series (`lumo` has four COLLECTION
    /// children and one SERIES child in production), so an episode card that
    /// always pushed `.video` would land the viewer on the same dead end this
    /// screen exists to remove.
    static func route(label: String?, slug: String) -> Route {
        isSeriesLabel(label) ? .series(slug: slug) : .video(slug: slug)
    }

    /// The Finding 4 contract, from the WATCH screen's side.
    ///
    /// `videoBySlug.label` is already on the loaded record (the watch screen
    /// renders it as the eyebrow), so a series-shaped record can be detected
    /// and redirected the moment it loads — no extra query, no label plumbing
    /// through the home rails. Returns the destination to REPLACE the current
    /// screen with, or nil when the record is a genuine leaf and the watch
    /// screen should render it.
    ///
    /// Call this only once the record has actually loaded: a nil label during
    /// loading is indistinguishable from a leaf, and redirecting on a
    /// half-loaded record would bounce the viewer off a screen that was about
    /// to render correctly.
    static func watchRedirect(label: String?, slug: String) -> Route? {
        isSeriesLabel(label) ? .series(slug: slug) : nil
    }
}
