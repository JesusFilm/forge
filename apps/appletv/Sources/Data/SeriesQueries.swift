import Foundation

/// The series-screen GraphQL document.
///
/// A series (`SERIES` / `COLLECTION`) is a Video whose `children` are the
/// episodes. Its OWN media is metadata only — verified against production on
/// 2026-08-12: `lumo-the-gospel-of-matthew` publishes 56 dubs and NOT ONE has a
/// playback id, because the playable bytes live on the 25 child segments. That
/// is why this screen exists and why the watch screen redirects here
/// (`SeriesShape.watchRedirect`).
///
/// THE CHILD SELECTION IS NARROW ON PURPOSE — same law as `VideoQueries`.
/// Each child gets `muxPlaybackId`, the server-resolved single representative
/// playback id, INSTEAD of `dubs { … muxVideo { playbackId } }`. Projecting a
/// child's dub list would multiply the 9.5MB/13s trap by the number of
/// children: 61 chapters x ~2,200 dubs is the payload admin's own schema
/// documentation calls out as ~45MB. Never add `dubs` to a child here.
///
/// Measured against production (2026-08-12, `jesus`, the worst case at 61
/// children): 46.5 KB / ~1.6s. The same query minus every per-child resolver
/// (`muxPlaybackId`, `durationSeconds`, `images`) is 9.7 KB / ~0.34s, and
/// `muxPlaybackId` ALONE already costs ~1.7s — so playability is what this
/// screen pays for, and images plus duration ride along for free once that
/// DataLoader batch has run. Dropping duration or images would not buy back
/// time; dropping `muxPlaybackId` would, at the cost of not knowing which
/// cards can play.
enum SeriesQueries {
    static let seriesBySlug = """
    query TvNativeSeriesBySlug($slug: String!, $locale: String!) {
      videoBySlug(slug: $slug) {
        id
        slug
        label
        images { url thumbnail mobileCinematicHigh }
        locales(locale: $locale) { title description snippet }
        children {
          order
          child {
            id
            slug
            # Routing depends on this: a series' child can itself be a series.
            # Verified in production — `lumo` has six children, four of them
            # COLLECTION and one SERIES. Routing those to the watch screen
            # would reproduce exactly the dead end this screen fixes.
            label
            # ONE representative playback id, resolved server-side. This is the
            # whole reason no child projects its own audio list — see the law
            # in the Swift doc comment above, which a contract test enforces.
            muxPlaybackId
            durationSeconds
            images { url thumbnail mobileCinematicHigh }
            locales(locale: $locale) { title }
          }
        }
      }
    }
    """
}

// MARK: - Wire shapes

// `WireImage` and `WireLocale` are shared with `VideoQueries` deliberately —
// one Codable per admin type, so a selection change cannot drift between the
// watch and series screens.

struct SeriesBySlugData: Decodable {
    let videoBySlug: WireSeriesVideo?
}

struct WireSeriesVideo: Decodable {
    let id: String?
    let slug: String?
    let label: String?
    let images: [WireImage]?
    let locales: [WireLocale]?
    let children: [WireChildRelation]?
}

/// A row of the Video-Video join. `child` is nullable on the wire and really
/// does arrive null — admin's inverted relation surfaces rows the viewer may
/// not see — so the projection drops those rather than trusting the shape.
struct WireChildRelation: Decodable {
    let order: Int?
    let child: WireChildVideo?
}

struct WireChildVideo: Decodable {
    let id: String?
    let slug: String?
    let label: String?
    let muxPlaybackId: String?
    let durationSeconds: Int?
    let images: [WireImage]?
    let locales: [WireLocale]?
}
