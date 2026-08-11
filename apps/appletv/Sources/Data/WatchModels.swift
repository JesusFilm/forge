import Foundation

// UI projections for the watch experience, narrowed from the wire shapes so
// views never thread optionals. Mirrors the RN normalizer's philosophy: drop
// what cannot be rendered rather than rendering something broken.

struct Dub: Equatable, Identifiable {
    let id: String
    /// Stable language identity. Preference matching is EXACT on this and
    /// never on a bcp47 prefix — prefixes collide (ko vs ko-kmr, en vs
    /// en-nai), so a prefix match can silently select the wrong language.
    let languageSlug: String?
    let bcp47: String?
    /// English display name resolved from the JSONB locale map.
    let displayName: String
    let hls: String?
    let playbackID: String?
    let durationSeconds: Int?

    /// A dub is playable only if its stream passes the Mux host check. An
    /// unplayable dub is still LISTED (disabled) rather than hidden, so the
    /// list matches what other surfaces show.
    var isPlayable: Bool {
        MuxURL.hlsURL(playbackID: playbackID) != nil || isTrustedHLS
    }

    private var isTrustedHLS: Bool {
        guard let hls, let url = URL(string: hls) else { return false }
        return url.host == "stream.mux.com"
    }
}

struct WatchVideo: Equatable {
    let id: String
    let slug: String
    let label: String?
    let title: String
    let description: String?
    let posterURL: URL?
    let primaryBcp47: String?
    let dubs: [Dub]
}

struct Subtitle: Equatable, Identifiable {
    let id: String
    let languageSlug: String?
    let bcp47: String?
    let displayName: String
    let vttURL: URL
    let isPrimary: Bool
}

enum WatchProjection {
    /// Poster precedence, mirroring RN's `cardImage.ts`: cinematic high, then
    /// cinematic low, then thumbnail, then the bare url as a last resort.
    /// Field-major so a single image lacking the best field cannot force the
    /// whole chain down to a broken URL.
    static func posterURL(from images: [WireImage]?) -> String? {
        guard let images, !images.isEmpty else { return nil }
        return images.compactMap(\.mobileCinematicHigh).first
            ?? images.compactMap(\.mobileCinematicLow).first
            ?? images.compactMap(\.thumbnail).first
            ?? images.compactMap(\.url).first
    }

    /// Resolve a JSONB locale map to a display string, preferring English.
    static func displayName(_ map: [String: String]?, fallback: String?) -> String {
        map?["en"] ?? map?.values.sorted().first ?? fallback ?? "Unknown"
    }

    static func project(_ data: VideoBySlugData) -> WatchVideo? {
        guard let v = data.videoBySlug, let id = v.id, let slug = v.slug else {
            return nil
        }
        let locale = v.locales?.first
        // FIELD-major, not image-major, and `url` is LAST.
        //
        // The bare `url` is Cloudflare's variant-less delivery base and
        // returns HTTP 400 — confirmed against production 2026-08-12. Ranking
        // it above `thumbnail` (as the first cut did) means a record whose
        // cinematic art is absent shows nothing at all, while a perfectly
        // good thumbnail sits unused one rung below.
        let poster = WatchProjection.posterURL(from: v.images)

        // Only published dubs, matching RN. Server order is preserved here;
        // display sorting happens at the view layer so the underlying
        // identity stays stable.
        let dubs = (v.variants ?? [])
            .filter { $0.published == true }
            .compactMap { d -> Dub? in
                guard let dubID = d.id else { return nil }
                return Dub(
                    id: dubID,
                    languageSlug: d.language?.slug,
                    bcp47: d.language?.bcp47,
                    displayName: displayName(d.language?.name, fallback: d.language?.slug),
                    hls: d.hls,
                    playbackID: d.muxVideo?.playbackId,
                    durationSeconds: d.duration
                )
            }

        return WatchVideo(
            id: id,
            slug: slug,
            label: v.label,
            title: locale?.title ?? slug,
            description: locale?.description ?? locale?.snippet,
            posterURL: poster.flatMap(URL.init(string:)),
            primaryBcp47: v.primaryLanguage?.bcp47,
            dubs: dubs
        )
    }

    static func projectSubtitles(_ data: VideoDubData) -> [Subtitle] {
        (data.videoDub?.videoEdition?.subtitles ?? []).compactMap { s in
            // A subtitle with no source is unrenderable; RN drops these too.
            guard let id = s.id, let src = s.vttSrc, let url = URL(string: src) else {
                return nil
            }
            return Subtitle(
                id: id,
                languageSlug: s.language?.slug,
                bcp47: s.language?.bcp47,
                displayName: displayName(s.language?.name, fallback: s.language?.slug),
                vttURL: url,
                isPrimary: s.primary ?? false
            )
        }
    }
}

// MARK: - Default dub selection

enum DefaultDub {
    /// The priority chain, ported from `apps/tv/src/lib/resolveDefaultLanguage.ts`.
    /// Every rung is soft: a miss falls through to the next.
    ///
    ///   1. persisted preference  — EXACT languageSlug match, never a prefix
    ///   2. device locale         — bcp47 primary-subtag match
    ///   3. video primary language — bcp47 primary-subtag match
    ///   4. English
    ///   5. first dub
    static func resolve(
        dubs: [Dub],
        preferredLanguageSlug: String?,
        deviceBcp47: String?,
        videoPrimaryBcp47: String?
    ) -> Dub? {
        guard !dubs.isEmpty else { return nil }

        if let preferred = preferredLanguageSlug,
           let match = dubs.first(where: { $0.languageSlug == preferred }) {
            return match
        }
        if let device = deviceBcp47, let match = matchPrefix(dubs, device) {
            return match
        }
        if let primary = videoPrimaryBcp47, let match = matchPrefix(dubs, primary) {
            return match
        }
        if let english = matchPrefix(dubs, "en") {
            return english
        }
        return dubs.first
    }

    private static func matchPrefix(_ dubs: [Dub], _ tag: String) -> Dub? {
        let target = tag.split(separator: "-").first.map(String.init)?.lowercased()
        guard let target else { return nil }
        return dubs.first { dub in
            guard let bcp47 = dub.bcp47 else { return false }
            return bcp47.split(separator: "-").first?.lowercased() == target
        }
    }

    /// Display ordering: alphabetical by name. Kept separate from selection so
    /// sorting can never change which dub an index refers to.
    static func sortedForDisplay(_ dubs: [Dub]) -> [Dub] {
        dubs.sorted { $0.displayName.localizedCompare($1.displayName) == .orderedAscending }
    }
}
