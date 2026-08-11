import Foundation

/// Value-based navigation targets, mirroring the React Native app's routes
/// (`/watch/[slug]`, `/series/[slug]`, `/experience/[slug]`).
///
/// Slug-based rather than model-based on purpose: a card can push a
/// destination before the full record has loaded, which is what makes the
/// detail screen paint immediately instead of after a round trip.
enum Route: Hashable {
    case video(slug: String)
    case series(slug: String)
    case experience(slug: String)
}
