import Foundation

// Home hero parity (plan R9) — the deterministic, day-seeded hero queue.
//
// PORT OF `apps/tv/src/lib/watchHome/heroQueue.ts` (itself a port of mobile's
// carouselSequence.ts + web's pool builder). The point of the algorithm is that
// web, mobile and this app feature the SAME content on the SAME day without any
// server coordination: everything is derived from the ET calendar date plus the
// config below. A divergence here is not a cosmetic drift — it is three
// surfaces disagreeing about what today's programming is.
//
// Everything in this file is PURE and clock-injected. Nothing reads `Date()`,
// `TimeZone.current`, or `Locale.current`; `now` is always a parameter.
//
// Deliberate omissions from the React Native original, neither of which can
// change the picked set:
//   - `missingData` diagnostics. RN accumulates a structured "admin did not
//     return source X" list for logging. It is push-only — the algorithm never
//     reads it — and this app has no logging sink yet. Add it back with the
//     telemetry unit (plan R15) if the hero starts coming up short.
//   - `languageSlug`. In RN it appears ONLY inside those diagnostic strings.
//   - `parent` / `imageUrlOverride` on the card normalizer. The hero path never
//     passes either; both exist for RN's section/Experience paths.

// MARK: - Config (mirror of apps/tv/src/lib/watchHome/config.ts)

/// The client-owned home programming. LIVE half: this must be kept in sync with
/// web and mobile by hand until feat-160 moves curation into admin.
enum WatchHomeConfig {
    /// The hardcoded home locale pair — query locale + language identity, keyed
    /// on languageSlug and never on bcp47.
    static let locale = "en"
    static let englishLanguageSlug = "english"

    /// Web's initial hero queue size (mobile's `WATCH_HOME_HERO_QUEUE_TARGET`).
    static let heroQueueTarget = 7

    /// Each group becomes one hero pool, and its INDEX in this array is baked
    /// into the pool id that seeds the day-hash. Reordering these groups
    /// reshuffles the hero for every surface that shares the config — treat the
    /// order as part of the contract, not as a list you may tidy.
    static let playlistSequence: [[String]] = [
        ["1_jf-0-0"],
        ["JFP-Featured"],
        ["8_NBC"],
        ["GOJohnCollection", "GOLukeCollection", "GOMarkCollection", "GOMattCollection"],
        ["7_Origins", "Nua", "2_ElCamWaySJEN"],
        ["MAG1"],
        ["11_Sermon", "11_Shema", "11_ReadBible", "11_Advent"],
        ["2_GOJ-0-0"],
        ["CS1"],
        ["9_CreationtoChrist"],
        ["2_FileZero-0-0"],
        ["10_DarkroomFaith"],
    ]

    static let collectionBlacklist: Set<String> = ["7_Origins4Connect"]

    /// The empty-queue fallback set, not the live hero (RN's
    /// `WATCH_HOME_HERO_SOURCE_IDS`). Listed because it is the FIRST segment of
    /// the fetch id list, and that order is load-bearing — see `coreIds()`.
    static let heroSourceIds = [
        "1_jf-0-0",
        "2_GOJ-0-0",
        "GOMattCollection",
        "LUMOCollection",
    ]

    /// The section-source ids from RN's `WATCH_HOME_SECTIONS`, flattened in
    /// declaration order (`primaryCollectionId` then `sources`, section by
    /// section). Only the IDS are ported: this app renders its rails from the
    /// admin Experience, so RN's frozen section layout config is dead weight
    /// here — but the ids still matter, because they decide which records the
    /// bulk fetch returns, and therefore which SHORT_FILM records reach the
    /// synthetic `shortFilms` hero pool.
    static let sectionSourceIds = [
        // home-video-gospels + home-collection-showcase-grid
        "1_jf-0-0", "2_GOJ-0-0", "GOMattCollection", "GOMarkCollection",
        "GOLukeCollection", "GOJohnCollection",
        // home-collection-showcase-grid-christmas-advent
        "2_0-ConsideringChristmas", "2_0-SupremeChristmas", "2_0-Noelevator",
        "2_0-TimeForChange", "2_0-Stunned", "1_wl604412-0-0", "9_0-TheSavior5505",
        "1_cl1301-0-0", "3_0-40DWJ_02-0-0", "1_jf6102-0-0", "1_riv_11-0-0",
        "1_wl604410-0-0", "6_GOLuke2601", "6_GOLuke2602", "6_GOMatt2501",
        // home-collection-bibleproject-advent / nua / nua-origins-worth
        "11_Advent", "7_0-ncs", "7_Origins2Worth",
        // home-collection-new-believer-course
        "8_NBC",
        // home-collection-showcase-grid-vertical
        "LUMOCollection", "GOMarkCollection", "GOLukeCollection", "GOJohnCollection",
    ]

    /// The `watchHomeVideos` argument, in RN's `getWatchHomeCoreIds()` order:
    /// hero sources, then the playlist sequence flattened, then the section
    /// sources — blacklist-filtered, then deduped first-wins.
    ///
    /// THE ORDER IS PART OF THE PARITY CONTRACT. Admin returns
    /// `watchHomeVideos` in argument order (verified against production
    /// 2026-08-12), and that response order becomes the iteration order of the
    /// synthetic `shortFilms` pool, which decides which short film the day-hash
    /// lands on. Sorting or set-ifying this list would silently pick a
    /// different film than web shows.
    static func coreIds() -> [String] {
        var seen = Set<String>()
        var ordered: [String] = []
        for id in heroSourceIds + playlistSequence.flatMap({ $0 }) + sectionSourceIds {
            guard !collectionBlacklist.contains(id), seen.insert(id).inserted else { continue }
            ordered.append(id)
        }
        return ordered
    }
}

// MARK: - Wire shapes

/// The card-lean bulk query. NEVER add `dubs` here: that is the ~9.5MB / ~13s
/// payload incident the two-query split in `VideoQueries` exists to prevent.
/// Streams resolve lazily per slug on the watch screen.
enum HomeVideoQueries {
    static let watchHomeVideos = """
    query TvNativeWatchHomeVideos($coreIds: [String!]!, $locale: String!, $languageSlug: String) {
      watchHomeVideos(coreIds: $coreIds) {
        documentId: id
        coreId
        slug
        label
        durationSeconds
        images { url thumbnail mobileCinematicHigh mobileCinematicLow videoStill }
        locales(locale: $locale, languageSlug: $languageSlug) {
          title
          description
          snippet
          imageAlt
        }
        children {
          child {
            documentId: id
            coreId
            slug
            label
            durationSeconds
            images { url thumbnail mobileCinematicHigh mobileCinematicLow videoStill }
            locales(locale: $locale, languageSlug: $languageSlug) {
              title
              description
              snippet
              imageAlt
            }
          }
        }
      }
    }
    """
}

struct WatchHomeVideosData: Decodable {
    let watchHomeVideos: [HomeVideoInput]?
}

struct HomeVideoImage: Decodable, Equatable {
    let url: String?
    let thumbnail: String?
    let mobileCinematicHigh: String?
    let mobileCinematicLow: String?
    let videoStill: String?
}

struct HomeVideoLocale: Decodable, Equatable {
    let title: String?
    let description: String?
    let snippet: String?
    let imageAlt: String?
}

struct HomeVideoChildRelation: Decodable, Equatable {
    let child: HomeVideoInput?
}

/// One `watchHomeVideos` record. `children` is absent on child records, which
/// is what makes `childCount` naturally 0 for them — the same distinction RN
/// draws with its `"children" in video` check.
struct HomeVideoInput: Decodable, Equatable {
    let documentId: String?
    let coreId: String?
    let slug: String?
    let label: String?
    let durationSeconds: Int?
    let images: [HomeVideoImage]?
    let locales: [HomeVideoLocale]?
    let children: [HomeVideoChildRelation]?
}

// MARK: - Projection

/// One hero slide. Narrowed from `WatchHomeCard`: the fields this app's hero
/// actually renders or routes with.
struct HeroCard: Equatable, Identifiable {
    /// Admin Video documentId.
    let id: String
    /// The config id this card was hydrated for (`shortFilms` cards carry their
    /// own coreId here). Diagnostic only — never part of the day-hash.
    let sourceId: String
    /// Core/Arclight id — the queue's dedupe key.
    let coreId: String
    let slug: String?
    let title: String
    let description: String?
    /// Display text ("Feature film"), rendered as the eyebrow.
    let label: String
    /// The RAW wire enum ("SERIES", "COLLECTION", …). ROUTING READS THIS, never
    /// `label` — the series predicate matches uppercase wire literals only, and
    /// display text fails it silently.
    let rawLabel: String?
    /// "61 chapters" / "3:04" / the label, in that precedence.
    let metaLabel: String
    /// The raw admin image string. Eligibility is decided on THIS, not on the
    /// parsed URL, so a string Swift declines to parse can never shrink the
    /// queue relative to web's.
    let imageURLString: String?
    let imageAlt: String
    let durationSeconds: Int?
    let childCount: Int

    var imageURL: URL? { imageURLString.flatMap(URL.init(string:)) }

    /// Where selecting this slide goes. Finding 4 of the plan: a COLLECTION
    /// record's playable media lives on its CHILD episodes, so routing one to
    /// the watch screen is a dead end with a disabled Play button.
    var route: Route? {
        guard let slug, !slug.isEmpty else { return nil }
        return HeroQueue.isSeriesLabel(rawLabel) ? .series(slug: slug) : .video(slug: slug)
    }
}

/// One round-robin bucket. `id` seeds the day-hash, so its exact spelling is
/// part of the cross-surface contract.
struct HeroPool: Equatable {
    let id: String
    let collectionIds: [String]
    let cards: [HeroCard]
}

/// Insertion-ordered coreId → video map.
///
/// A plain `[String: HomeVideoInput]` would be WRONG here, not merely untidy:
/// RN builds a JavaScript `Map`, and the synthetic `shortFilms` pool iterates
/// its VALUES in insertion order. Swift dictionaries have no order at all, so a
/// dictionary port would pick a different short film per day than web does, and
/// would pick a different one on each launch.
struct HeroSourceMap: Equatable {
    private(set) var order: [String] = []
    private var byCoreId: [String: HomeVideoInput] = [:]

    /// Explicit because the synthesized memberwise initializer inherits
    /// `byCoreId`'s `private` access and would be unreachable outside this file.
    init() {}

    /// Matches `Map.set`: a repeat key overwrites the VALUE but keeps its
    /// original position.
    mutating func set(_ coreId: String, _ video: HomeVideoInput) {
        if byCoreId.updateValue(video, forKey: coreId) == nil {
            order.append(coreId)
        }
    }

    subscript(coreId: String) -> HomeVideoInput? { byCoreId[coreId] }

    var values: [HomeVideoInput] { order.compactMap { byCoreId[$0] } }
}

// MARK: - Hero queue

enum HeroQueue {
    // MARK: Business date

    static let easternTimeZoneIdentifier = "America/New_York"

    /// The ET calendar date as `YYYY-MM-DD` — the seed every surface shares.
    ///
    /// React Native hand-rolls the US Eastern DST rule because Hermes ships
    /// without Intl timezone data, and a silently-ignored `timeZone` there
    /// returns the DEVICE-local date and desyncs the rotation. Foundation does
    /// carry the tz database, so this uses it — but `TimeZone(identifier:)` is
    /// failable, and a nil there would drop us onto the device clock, which is
    /// exactly the failure RN wrote its rule to avoid. So the hand-rolled rule
    /// is kept as the fallback rather than as a comment, and the tests assert
    /// the two agree across DST transitions in both directions.
    static func businessDate(_ now: Date) -> String {
        guard let calendar = easternCalendar else { return businessDateFromUSEasternRule(now) }
        return isoDate(calendar.dateComponents([.year, .month, .day], from: now))
            ?? businessDateFromUSEasternRule(now)
    }

    /// The rule ported verbatim from RN: US Eastern is UTC-4 from the 2nd Sunday
    /// of March 07:00 UTC until the 1st Sunday of November 06:00 UTC, else
    /// UTC-5. Correct for the post-2007 US era only — it is a fallback for a
    /// missing tz database, not a historical calendar.
    static func businessDateFromUSEasternRule(_ now: Date) -> String {
        let shifted = now.addingTimeInterval(Double(usEasternOffsetHours(now)) * 3600)
        // `utcCalendar` always populates the components it is asked for, so the
        // fallback string is a totality guard, not a reachable branch.
        return isoDate(utcCalendar.dateComponents([.year, .month, .day], from: shifted))
            ?? "1970-01-01"
    }

    /// -4 during US Eastern Daylight Time, -5 otherwise. Exposed so the exact
    /// transition instant can be pinned by a test; the date string alone cannot
    /// discriminate it, because the transition (07:00 UTC) and the day boundary
    /// (04:00–05:00 UTC) fall at different times of day.
    static func usEasternOffsetHours(_ now: Date) -> Int {
        let year = utcCalendar.component(.year, from: now)
        guard
            let dstStart = utcDate(year: year, month: 3, day: nthSundayOfMonthUTC(year, 3, 2), hour: 7),
            let dstEnd = utcDate(year: year, month: 11, day: nthSundayOfMonthUTC(year, 11, 1), hour: 6)
        else { return -5 }
        return now >= dstStart && now < dstEnd ? -4 : -5
    }

    // MARK: Deterministic offset

    /// Java's `String.hashCode` shape, and JavaScript's exact int32 wrap-around
    /// semantics. `Int32` wrapping operators reproduce `hash &= hash`; taking
    /// `abs` in 64-bit reproduces `Math.abs(-2147483648) === 2147483648`, which
    /// a 32-bit `abs` would trap on instead.
    static func simpleHash(_ value: String) -> Int {
        var hash: Int32 = 0
        for unit in value.utf16 {
            hash = (hash &<< 5) &- hash &+ Int32(unit)
        }
        return abs(Int(hash))
    }

    /// `simpleHash(businessDate + poolId [+ cycle] [+ prog]) % videoCount`.
    /// The cycle/prog terms exist so that a long queue keeps moving through a
    /// pool instead of re-picking the same card at every visit.
    static func deterministicOffset(
        poolID: String,
        videoCount: Int,
        now: Date,
        poolIndex: Int? = nil,
        totalVideosLoaded: Int? = nil
    ) -> Int {
        guard videoCount > 0 else { return 0 }
        var seed = businessDate(now) + poolID
        if let poolIndex {
            seed += "-cycle\(poolIndex / 15)"
        }
        if let totalVideosLoaded {
            seed += "-prog\(totalVideosLoaded / 10)"
        }
        return simpleHash(seed) % videoCount
    }

    // MARK: Card normalization

    /// Children do NOT make a record series-shaped — feature films carry their
    /// own chapter clips (JESUS has 61). STRICT UPPERCASE, matching RN: case
    /// folding lets a lowercase fixture pass falsely.
    static func isSeriesLabel(_ label: String?) -> Bool {
        label == "SERIES" || label == "COLLECTION"
    }

    private static let labelText: [String: String] = [
        "BEHIND_THE_SCENES": "Behind the scenes",
        "COLLECTION": "Collection",
        "EPISODE": "Episode",
        "FEATURE_FILM": "Feature film",
        "SEGMENT": "Segment",
        "SERIES": "Series",
        "SHORT_FILM": "Short film",
        "TRAILER": "Trailer",
    ]

    /// `m:ss` sub-hour, `h:mm:ss` hour-plus, `""` when there is nothing to show.
    static func formatDuration(_ seconds: Int) -> String {
        guard seconds >= 0 else { return "" }
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        let secs = seconds % 60
        return hours > 0
            ? "\(hours):\(zeroPadded(minutes, 2)):\(zeroPadded(secs, 2))"
            : "\(minutes):\(zeroPadded(secs, 2))"
    }

    /// Child count wins over duration wins over the label. The noun is
    /// LABEL-AWARE exactly as routing is: a feature film's children are
    /// chapters, so JESUS reads "61 chapters" and a series reads "N episodes".
    static func metaLabel(
        label: String,
        rawLabel: String?,
        durationSeconds: Int?,
        childCount: Int
    ) -> String {
        if childCount > 0 {
            let noun = isSeriesLabel(rawLabel) ? "episode" : "chapter"
            return "\(childCount) \(noun)\(childCount == 1 ? "" : "s")"
        }
        if let durationSeconds {
            let duration = formatDuration(durationSeconds)
            if !duration.isEmpty { return duration }
        }
        return label
    }

    /// The one owner of "which image field wins" for hero art, ported from
    /// `cardImage.ts`'s `card` intent (the only intent the hero uses).
    ///
    /// Field-major, image-minor: for each field in priority order, scan ALL
    /// images. The bare `url` is the variant-less Cloudflare Images delivery
    /// base and 400s, so it ranks LAST — never above a real transform.
    static func pickCardImage(_ images: [HomeVideoImage]?) -> String? {
        guard let images, !images.isEmpty else { return nil }
        let fields: [KeyPath<HomeVideoImage, String?>] = [
            \.mobileCinematicHigh, \.mobileCinematicLow, \.videoStill, \.thumbnail, \.url,
        ]
        for field in fields {
            for image in images {
                if let candidate = image[keyPath: field], !candidate.isEmpty { return candidate }
            }
        }
        return nil
    }

    /// Admin's Video.parents/children relation can surface self-references and
    /// duplicates. Self-filter and dedupe BEFORE any limit, so the count is
    /// right the moment the relation is fixed upstream.
    static func resolvedChildren(_ parent: HomeVideoInput) -> [HomeVideoInput] {
        var seen = Set<String>()
        var children: [HomeVideoInput] = []
        for relation in parent.children ?? [] {
            guard
                let child = relation.child,
                let documentId = child.documentId,
                documentId != parent.documentId,
                seen.insert(documentId).inserted
            else { continue }
            children.append(child)
        }
        return children
    }

    static func card(sourceId: String, video: HomeVideoInput) -> HeroCard? {
        guard let documentId = video.documentId, let coreId = video.coreId else { return nil }
        let locale = video.locales?.first
        let label = video.label.flatMap { labelText[$0] } ?? "Video"
        let childCount = resolvedChildren(video).count
        let title = locale?.title ?? video.slug ?? coreId
        return HeroCard(
            id: documentId,
            sourceId: sourceId,
            coreId: coreId,
            slug: video.slug,
            title: title,
            description: locale?.snippet ?? locale?.description,
            label: label,
            rawLabel: video.label,
            metaLabel: metaLabel(
                label: label,
                rawLabel: video.label,
                durationSeconds: video.durationSeconds,
                childCount: childCount
            ),
            imageURLString: pickCardImage(video.images),
            imageAlt: locale?.imageAlt ?? title,
            durationSeconds: video.durationSeconds,
            childCount: childCount
        )
    }

    /// A usable hero slide needs art, a slug to route to, and a non-blacklisted
    /// coreId.
    static func isEligible(_ card: HeroCard) -> Bool {
        guard let image = card.imageURLString, !image.isEmpty else { return false }
        guard let slug = card.slug, !slug.isEmpty else { return false }
        return !WatchHomeConfig.collectionBlacklist.contains(card.coreId)
    }

    // MARK: Pools

    /// TOP-LEVEL ONLY, deliberately — not the child-inclusive index the section
    /// renderer uses. A playlist source that exists solely as another
    /// collection's child contributes no hero pool, which is how web behaves.
    static func sourceMap(_ videos: [HomeVideoInput]) -> HeroSourceMap {
        var map = HeroSourceMap()
        for video in videos {
            guard let coreId = video.coreId, !coreId.isEmpty else { continue }
            map.set(coreId, video)
        }
        return map
    }

    private static func eligibleCards(sourceId: String, in map: HeroSourceMap) -> [HeroCard] {
        guard !WatchHomeConfig.collectionBlacklist.contains(sourceId) else { return [] }
        guard let parent = map[sourceId] else { return [] }
        // Web-parity label gate: COLLECTION/SERIES containers carry no playable
        // stream of their own (verified — `lumo-the-gospel-of-matthew` returns
        // 56 published dubs, 0 with a playbackId), so they never hero. An
        // individually-playable film is kept even when it has chapter children.
        guard parent.label != "COLLECTION", parent.label != "SERIES" else { return [] }
        guard let parentCard = card(sourceId: sourceId, video: parent), isEligible(parentCard) else {
            return []
        }
        return [parentCard]
    }

    static func pools(_ map: HeroSourceMap) -> [HeroPool] {
        var pools: [HeroPool] = []
        for (index, group) in WatchHomeConfig.playlistSequence.enumerated() {
            let collectionIds = group.filter { !WatchHomeConfig.collectionBlacklist.contains($0) }
            let cards = collectionIds.flatMap { eligibleCards(sourceId: $0, in: map) }
            guard !cards.isEmpty else { continue }
            pools.append(
                HeroPool(
                    // The seed. `index` is the position in the UNFILTERED
                    // sequence, so dropping an empty pool never renumbers the
                    // survivors.
                    id: "playlist-\(index)-\(collectionIds.joined(separator: "|"))",
                    collectionIds: collectionIds,
                    cards: cards
                )
            )
        }

        // Synthetic shortFilms pool, always last: only TOP-LEVEL SHORT_FILM
        // records reach web's hero, so a short film that exists only as some
        // collection's child is dropped. Iterating `map.values` (not a Swift
        // dictionary) is what keeps this order equal to web's.
        var shortFilmCoreIds = Set<String>()
        var shortFilms: [HeroCard] = []
        for video in map.values {
            let sourceId = video.coreId ?? video.documentId ?? "unknown"
            guard
                let candidate = card(sourceId: sourceId, video: video),
                candidate.rawLabel == "SHORT_FILM",
                isEligible(candidate),
                shortFilmCoreIds.insert(candidate.coreId).inserted
            else { continue }
            shortFilms.append(candidate)
        }
        if !shortFilms.isEmpty {
            pools.append(HeroPool(id: "shortFilms", collectionIds: ["shortFilms"], cards: shortFilms))
        }

        return pools
    }

    // MARK: Queue

    /// Round-robin across the pools, taking one day-seeded pick from each, until
    /// the target is met or the attempt budget runs out. Deduped on `coreId`.
    static func queue(
        pools: [HeroPool],
        now: Date,
        startPoolIndex: Int = 0,
        targetVideoCount: Int = WatchHomeConfig.heroQueueTarget
    ) -> [HeroCard] {
        guard targetVideoCount > 0, !pools.isEmpty else { return [] }

        var cards: [HeroCard] = []
        var seen = Set<String>()
        var poolIndex = max(0, startPoolIndex)
        var attempts = 0
        // Bounded so a shelf of exhausted pools cannot spin: every pool gets a
        // few passes, and a short queue still gets its target's worth of tries.
        let maxAttempts = max(pools.count * 4, targetVideoCount * 6)

        while cards.count < targetVideoCount, attempts < maxAttempts {
            let pool = pools[poolIndex % pools.count]
            attempts += 1

            let candidates = pool.cards.filter { isEligible($0) && !seen.contains($0.coreId) }
            guard !candidates.isEmpty else {
                poolIndex += 1
                continue
            }

            let offset = deterministicOffset(
                poolID: pool.id,
                videoCount: candidates.count,
                now: now,
                poolIndex: poolIndex,
                totalVideosLoaded: cards.count
            )
            let candidate = candidates[offset]
            cards.append(candidate)
            seen.insert(candidate.coreId)

            poolIndex += 1
        }

        return cards
    }

    /// The empty-queue fallback: the curated hero source ids, normalized WITHOUT
    /// the pool path's label and eligibility gates — so unlike the queue, this
    /// can emit COLLECTION and SERIES cards (they route to the series screen)
    /// and cards with no art. Faithful to RN's `buildFeatured`, which keeps
    /// something on screen when a bad response would otherwise leave the hero
    /// blank.
    static func fallbackFeatured(_ map: HeroSourceMap) -> [HeroCard] {
        WatchHomeConfig.heroSourceIds.compactMap { sourceId in
            guard let video = map[sourceId] else { return nil }
            return card(sourceId: sourceId, video: video)
        }
    }

    /// The whole hero build: top-level source map → pools → day-seeded queue,
    /// with RN's hero-source fallback when the queue comes back empty.
    ///
    /// Still empty when nothing hydrates at all, which the caller must render as
    /// an empty state — never as a hero-shaped hole, which on tvOS is a region
    /// with no focusable descendant and therefore a dead end for every swipe
    /// that crosses it.
    static func featured(
        videos: [HomeVideoInput],
        now: Date,
        targetVideoCount: Int = WatchHomeConfig.heroQueueTarget
    ) -> [HeroCard] {
        let map = sourceMap(videos)
        let queued = queue(pools: pools(map), now: now, targetVideoCount: targetVideoCount)
        return queued.isEmpty ? fallbackFeatured(map) : queued
    }

    // MARK: Calendar plumbing

    private static let easternCalendar: Calendar? = {
        guard let zone = TimeZone(identifier: easternTimeZoneIdentifier) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar
    }()

    /// A FIXED zero offset, never a tz-database lookup — this calendar backs the
    /// branch that exists for the case where the database is unavailable.
    private static let utcCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        return calendar
    }()

    private static func utcDate(year: Int, month: Int, day: Int, hour: Int) -> Date? {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = hour
        components.minute = 0
        components.second = 0
        components.nanosecond = 0
        return utcCalendar.date(from: components)
    }

    private static func nthSundayOfMonthUTC(_ year: Int, _ month: Int, _ n: Int) -> Int {
        guard let first = utcDate(year: year, month: month, day: 1, hour: 0) else { return 1 }
        // Foundation's `.weekday` is 1-based from Sunday; JS `getUTCDay()` is
        // 0-based from Sunday.
        let firstWeekday = utcCalendar.component(.weekday, from: first) - 1
        let firstSunday = 1 + ((7 - firstWeekday) % 7)
        return firstSunday + (n - 1) * 7
    }

    private static func isoDate(_ components: DateComponents) -> String? {
        guard let year = components.year,
              let month = components.month,
              let day = components.day
        else { return nil }
        return "\(zeroPadded(year, 4))-\(zeroPadded(month, 2))-\(zeroPadded(day, 2))"
    }

    /// Interpolating `Int` is always ASCII digits. A `DateFormatter` or a
    /// locale-aware `String(format:)` is deliberately avoided: this string is a
    /// HASH SEED, and Eastern Arabic numerals on an Arabic-locale Apple TV
    /// would hash differently and desync that one device from the fleet.
    private static func zeroPadded(_ value: Int, _ width: Int) -> String {
        let digits = String(value)
        guard digits.count < width else { return digits }
        return String(repeating: "0", count: width - digits.count) + digits
    }
}
