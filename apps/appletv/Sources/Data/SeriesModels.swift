import Foundation

// UI projections for the series screen, narrowed from the wire shapes so views
// never thread optionals. Same philosophy as `WatchProjection`: drop what
// cannot be rendered rather than render something broken — with one deliberate
// exception, recorded on `Episode.slug` below, because tvOS focus punishes
// silently dropped rows.

/// One child of a series. A series calls these episodes; a feature film calls
/// the same shape chapters.
struct Episode: Equatable, Identifiable {
    let id: String
    /// The record's own `VideoLabel` — load-bearing, not decoration. A series'
    /// child can itself be a series, and this is the only thing that says so.
    let label: String?
    /// Canonical Watch/Series slug. Optional for the same reason `VideoCard`'s
    /// is: a child with no slug cannot open a detail screen, and the card must
    /// then stay FOCUSABLE but inert rather than vanish. Skipping holes makes
    /// D-pad browsing feel broken, and focus targets are what tvOS navigates
    /// by — a dropped row is a dead swipe.
    let slug: String?
    let title: String
    let posterURL: URL?
    /// The server-resolved representative playback id, or nil when nothing
    /// under this child is playable. Non-nil is what makes the card say "Play"
    /// rather than "Explore".
    let playbackID: String?
    let durationSeconds: Int?
    /// The relation's `order`, surfaced as the episode number. Nil when admin
    /// left the relation unordered.
    let episodeNumber: Int?

    /// Playable = a playback id that survives Mux host/shape validation. A
    /// COLLECTION child is legitimately NOT playable and is still openable.
    var isPlayable: Bool {
        MuxURL.hlsURL(playbackID: playbackID) != nil
    }

    /// Where selecting this card goes, or nil when it cannot be opened.
    /// Shape-based, never playability-based: an unplayable COLLECTION opens
    /// its own series screen, which is where its media actually lives.
    var route: Route? {
        guard let slug, !slug.isEmpty else { return nil }
        return SeriesShape.route(label: label, slug: slug)
    }
}

struct SeriesDetail: Equatable {
    let id: String
    let slug: String
    let label: String?
    let title: String
    let description: String?
    let posterURL: URL?
    let episodes: [Episode]

    /// What the hero's primary action opens: the first episode that can be
    /// opened at all. The hero CTA renders unconditionally (Finding 1 — a
    /// screen whose only button disappears has no focusable descendant at
    /// first layout), so this is allowed to be nil and the CTA goes inert.
    var leadEpisode: Episode? {
        episodes.first { $0.route != nil }
    }

    /// Combined runtime of the episodes that report one. Nil when NONE do —
    /// a series of collections carries no durations at all, and "0m" would be
    /// a lie rather than a missing value. Episodes that individually report
    /// nothing are simply not counted, so the total is a floor.
    var totalDurationSeconds: Int? {
        let known = episodes.compactMap(\.durationSeconds)
        return known.isEmpty ? nil : known.reduce(0, +)
    }
}

enum SeriesProjection {
    static func project(_ data: SeriesBySlugData) -> SeriesDetail? {
        guard let video = data.videoBySlug, let id = video.id, let slug = video.slug else {
            return nil
        }
        let locale = video.locales?.first
        return SeriesDetail(
            id: id,
            slug: slug,
            label: video.label,
            title: locale?.title ?? slug,
            description: locale?.description ?? locale?.snippet,
            posterURL: posterURL(from: video.images),
            episodes: episodes(from: video.children, parentID: id)
        )
    }

    /// Children -> episode cards. Ported from the React Native `buildChildren`,
    /// whose three defences all exist because admin's inverted relation really
    /// does return these shapes:
    ///
    ///  - a relation whose `child` is null (visibility-filtered row),
    ///  - a self-reference (the parent appearing among its own children),
    ///  - duplicate children.
    ///
    /// Ordering is `relationPrecedes` — by the relation's `order`, ties broken
    /// by the original wire index.
    static func episodes(
        from relations: [WireChildRelation]?,
        parentID: String?
    ) -> [Episode] {
        let ordered = (relations ?? [])
            .enumerated()
            .sorted { relationPrecedes(($0.offset, $0.element.order), ($1.offset, $1.element.order)) }

        var seen = Set<String>()
        var episodes: [Episode] = []
        for (_, relation) in ordered {
            guard let child = relation.child else { continue }
            // Identity: the stable id, falling back to the slug. Neither means
            // there is nothing to key a card on.
            guard let id = child.id ?? child.slug, !id.isEmpty else { continue }
            // A parent listed among its own children would render a card that
            // navigates back to the screen you are already on.
            if let parentID, id == parentID { continue }
            guard seen.insert(id).inserted else { continue }

            let locale = child.locales?.first
            episodes.append(
                Episode(
                    id: id,
                    label: child.label,
                    slug: child.slug,
                    // Falling back to the slug keeps a titleless child on
                    // screen as something readable rather than a blank card.
                    title: locale?.title ?? child.slug ?? id,
                    posterURL: posterURL(from: child.images),
                    playbackID: child.muxPlaybackId,
                    durationSeconds: child.durationSeconds,
                    episodeNumber: relation.order
                )
            )
        }
        return episodes
    }

    /// The episode ordering rule: `order` ascending, ties broken by the
    /// relation's original position on the wire.
    ///
    /// The tie-break is not decoration — `Sequence.sorted(by:)` is documented
    /// as NOT guaranteed stable, and an unordered series (every `order` null)
    /// is entirely ties, so without it the rail could reshuffle between two
    /// decodes of the same response, under a focused card.
    ///
    /// Extracted as its own function ON PURPOSE, because a test that goes
    /// through `episodes(from:)` cannot tell a present tie-break from a missing
    /// one: today's stdlib sort happens to be stable, so deleting the tie-break
    /// leaves the end-to-end assertion green. Falsified by hand on
    /// 2026-08-12 — removing it from `episodes(from:)` alone kept the whole
    /// suite passing; removing it here turns `relationPrecedes` red. Assert on
    /// THIS function, not on the sorted output.
    static func relationPrecedes(
        _ left: (offset: Int, order: Int?),
        _ right: (offset: Int, order: Int?)
    ) -> Bool {
        let leftOrder = left.order ?? 0
        let rightOrder = right.order ?? 0
        if leftOrder != rightOrder { return leftOrder < rightOrder }
        return left.offset < right.offset
    }

    /// Card artwork precedence, ported from `apps/tv/src/lib/cardImage.ts`
    /// ("poster" intent). Two properties matter and both are easy to get wrong:
    ///
    ///  - the scan is FIELD-major, image-minor. For each field in priority
    ///    order it scans every image, so an entry that carries only a
    ///    `videoStill`/`thumbnail` falls through to a SIBLING entry's cinematic
    ///    art instead of settling for its own weaker field.
    ///  - the bare `url` ranks LAST. It is the variant-less Cloudflare Images
    ///    delivery base and it 400s — verified 2026-08-12 against
    ///    `imagedelivery.net/…/GOMattCollection.mobileCinematicHigh.jpg`
    ///    (400) versus the same URL with `/f=jpg,w=1280,h=600,q=95` (200).
    ///    Ranking it above `thumbnail` renders a broken image, not a smaller one.
    ///
    /// `mobileCinematicLow` sits between `mobileCinematicHigh` and `thumbnail`
    /// in the RN chain; `WireImage` does not carry it yet, so this port is that
    /// one rung short. Adding the field to `WireImage` and to both selections
    /// completes it.
    static func posterURL(from images: [WireImage]?) -> URL? {
        guard let images, !images.isEmpty else { return nil }
        let fields: [(WireImage) -> String?] = [
            { $0.mobileCinematicHigh },
            { $0.thumbnail },
            { $0.url },
        ]
        for field in fields {
            for image in images {
                if let candidate = field(image), !candidate.isEmpty {
                    return URL(string: candidate)
                }
            }
        }
        return nil
    }
}
