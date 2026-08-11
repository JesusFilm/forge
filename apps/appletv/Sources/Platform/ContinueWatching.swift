import Foundation

// Continue Watching (plan R10) — the device-local resume shelf.
//
// PORT OF `apps/tv/src/lib/watchEvents/continueWatching.ts`. One entry per
// video: the LATEST playback position plus the display fields the Home rail
// needs to render a card without a network fetch.
//
// THIS STORE IS NOT SHARED WITH THE REACT NATIVE TV APP. The two apps ship
// under different bundle ids (`org.jesusfilm.forgetv.native` here vs
// `org.jesusfilm.forgewatch`), and iOS/tvOS gives each bundle id its own
// container — so `UserDefaults.standard` is a different database in each. A
// viewer who watches half a film in one app will NOT find it on the shelf in
// the other. That is a property of the platform, not a gap to be closed with a
// shared App Group: the two apps are candidates to REPLACE one another, not to
// coexist on one device, so roaming progress between them is not a goal. If
// that ever changes, the crossing needs a real decision (App Group + a shared
// suite name, or server-side watch history), not a quiet suite rename.
//
// Local-only and keyed per install, not per account — the same posture RN has.
// The pure decision layer is separated from storage exactly as RN separates it,
// so every threshold is testable without a device.

// MARK: - Contract

enum ContinueWatching {
    static let storageKey = "forge.watch.continue_watching"

    /// Netflix-ish: a modest shelf, most recent first. The cap also suits the
    /// platform — tvOS gives apps a deliberately small persistent-storage budget
    /// and expects them to rebuild anything they keep locally, so an unbounded
    /// shelf would be storing more than the OS promises to hold.
    static let maxEntries = 10

    /// Below this a card is noise (accidental plays): 30s watched OR 25%.
    static let resumeMinSeconds: Double = 30
    static let resumeMinProgress: Double = 0.25

    /// At or after this fraction the video counts as finished and the entry drops.
    static let resumeFinishedProgress: Double = 0.95
}

/// One shelved video.
struct ContinueWatchingEntry: Codable, Equatable, Identifiable {
    /// Admin Video documentId — the upsert key.
    let videoId: String
    /// Public slug, for routing to the watch screen.
    let slug: String
    let title: String?
    /// 16:9 cinematic for the rail card, stored as the raw admin string.
    let imageURL: String?
    let positionSeconds: Int
    let durationSeconds: Int?
    /// 0..1 when the duration is known.
    let progress: Double?
    let updatedAt: String

    var id: String { videoId }

    /// The JSON keys are RN's, not Swift's. Nothing reads across the two apps
    /// (see the file header) — this is documentation of a shared shape, and it
    /// keeps a future App Group migration from being a data rewrite.
    enum CodingKeys: String, CodingKey {
        case videoId, slug, title
        case imageURL = "imageUrl"
        case positionSeconds, durationSeconds, progress, updatedAt
    }
}

/// The display half of an entry — everything except the playback snapshot.
struct ContinueWatchingSeed: Equatable {
    let videoId: String
    let slug: String
    let title: String?
    let imageURL: String?
    let updatedAt: String
}

/// One playback observation. Seconds are `Double` because that is what the
/// player reports; the stored entry floors them.
struct ResumeSnapshot: Equatable {
    let positionSeconds: Double
    let durationSeconds: Double?
}

// MARK: - Pure decision layer

extension ContinueWatching {
    /// Watched enough to shelve, and not effectively finished.
    static func isResumeWorthy(_ snapshot: ResumeSnapshot) -> Bool {
        guard snapshot.positionSeconds.isFinite, snapshot.positionSeconds > 0 else { return false }
        let progress = fraction(snapshot)
        if let progress, progress >= resumeFinishedProgress { return false }
        if snapshot.positionSeconds >= resumeMinSeconds { return true }
        return progress.map { $0 >= resumeMinProgress } ?? false
    }

    /// True when the snapshot means "watched to the end" — drop the entry.
    static func isFinished(_ snapshot: ResumeSnapshot) -> Bool {
        guard let progress = fraction(snapshot) else { return false }
        return progress >= resumeFinishedProgress
    }

    /// nil when the duration is unknown, zero, negative, or NaN. A NaN duration
    /// fails `> 0` in Swift exactly as it does in JavaScript, so an unseekable
    /// live stream degrades to the seconds-only rule instead of crashing.
    private static func fraction(_ snapshot: ResumeSnapshot) -> Double? {
        guard let duration = snapshot.durationSeconds, duration > 0 else { return nil }
        return snapshot.positionSeconds / duration
    }

    /// `Int(Double)` TRAPS on a value outside `Int`'s range, so a player
    /// reporting a nonsense duration would take the app down mid-playback.
    /// nil means "not representable" and the caller treats the snapshot as a
    /// no-op, which is the same outcome as a sub-threshold observation.
    private static func flooredSeconds(_ value: Double) -> Int? {
        Int(exactly: value.rounded(.down))
    }

    /// Apply one playback snapshot to the shelf: upsert (most recent first,
    /// capped) when resume-worthy, REMOVE when finished, and NO-OP below the
    /// noise floor.
    ///
    /// The no-op branch returns the list UNTOUCHED rather than the
    /// others-only list on purpose: backing out of a film at 5 seconds must not
    /// erase yesterday's 40-minute position for that same film.
    static func apply(
        entries: [ContinueWatchingEntry],
        seed: ContinueWatchingSeed,
        snapshot: ResumeSnapshot
    ) -> [ContinueWatchingEntry] {
        let others = entries.filter { $0.videoId != seed.videoId }
        if isFinished(snapshot) { return others }
        guard isResumeWorthy(snapshot) else { return entries }
        guard let position = flooredSeconds(snapshot.positionSeconds) else { return entries }

        let duration: Int? = {
            guard let seconds = snapshot.durationSeconds, seconds > 0 else { return nil }
            return flooredSeconds(seconds)
        }()
        let next = ContinueWatchingEntry(
            videoId: seed.videoId,
            slug: seed.slug,
            title: seed.title,
            imageURL: seed.imageURL,
            positionSeconds: position,
            durationSeconds: duration,
            // Deliberately the RAW snapshot ratio, not `position / duration` of
            // the floored pair: the stored seconds are for resuming, this
            // fraction is for the progress bar, and on a short clip a
            // whole-second quantization is visible in the bar. Matches RN.
            progress: duration != nil ? fraction(snapshot) : nil,
            updatedAt: seed.updatedAt
        )
        return Array(([next] + others).prefix(maxEntries))
    }

    /// Defensive parse: a malformed payload yields an empty shelf, and a single
    /// malformed entry is dropped without taking its neighbours with it.
    static func parse(_ raw: String?) -> [ContinueWatchingEntry] {
        guard let raw, let data = raw.data(using: .utf8) else { return [] }
        guard let rows = try? JSONDecoder().decode([LenientEntry].self, from: data) else { return [] }
        return Array(rows.compactMap(\.entry).prefix(maxEntries))
    }

    static func serialize(_ entries: [ContinueWatchingEntry]) -> String? {
        guard let data = try? JSONEncoder().encode(entries) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Decodes an entry, or nothing, without failing its siblings.
    private struct LenientEntry: Decodable {
        let entry: ContinueWatchingEntry?
        init(from decoder: Decoder) throws {
            entry = try? ContinueWatchingEntry(from: decoder)
        }
    }
}

// MARK: - Home rail projection

extension ContinueWatchingEntry {
    /// The shelf card. `playbackID` is nil by design — the shelf routes to the
    /// watch screen, which resolves the viewer's dub; it does not carry a stream
    /// of its own.
    var card: VideoCard {
        VideoCard(
            id: videoId,
            title: title ?? slug,
            posterURL: imageURL.flatMap(URL.init(string:)),
            playbackID: nil,
            slug: slug
        )
    }
}

extension ContinueWatching {
    static let railID = "continue-watching"
    static let railTitle = "Continue Watching"

    /// nil for an empty shelf. An empty rail is worse than no rail on tvOS: it
    /// occupies vertical space with zero focusable descendants, which is exactly
    /// the geometry that dead-ends a swipe (plan Finding 1).
    static func rail(_ entries: [ContinueWatchingEntry]) -> Rail? {
        guard !entries.isEmpty else { return nil }
        return Rail(
            id: railID,
            title: railTitle,
            eyebrow: nil,
            description: nil,
            items: entries.map(\.card)
        )
    }
}

// MARK: - Storage

/// Serialized read-modify-write over `UserDefaults`.
///
/// An actor rather than a struct because the shelf is written from the player's
/// periodic time observer and read by Home: two unsynchronized read-modify-write
/// pairs would let a Home read land between a save's read and its write and
/// resurrect a stale shelf. RN solves the same race with a promise-chain lock.
actor ContinueWatchingStore {
    static let shared = ContinueWatchingStore()

    private let defaults: UserDefaults
    private let timestampFormatter: ISO8601DateFormatter

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        timestampFormatter = formatter
    }

    /// The shelf, most recent first.
    func entries() -> [ContinueWatchingEntry] {
        ContinueWatching.parse(defaults.string(forKey: ContinueWatching.storageKey))
    }

    func rail() -> Rail? {
        ContinueWatching.rail(entries())
    }

    /// The saved resume position for one video, or nil.
    func resumePosition(videoId: String) -> Int? {
        entries().first { $0.videoId == videoId }?.positionSeconds
    }

    /// Record a playback snapshot. Best-effort: a storage failure loses a resume
    /// point, and must never interrupt playback.
    @discardableResult
    func record(
        videoId: String,
        slug: String,
        title: String?,
        imageURL: String?,
        snapshot: ResumeSnapshot,
        now: Date
    ) -> [ContinueWatchingEntry] {
        let next = ContinueWatching.apply(
            entries: entries(),
            seed: ContinueWatchingSeed(
                videoId: videoId,
                slug: slug,
                title: title,
                imageURL: imageURL,
                updatedAt: timestampFormatter.string(from: now)
            ),
            snapshot: snapshot
        )
        if next.isEmpty {
            defaults.removeObject(forKey: ContinueWatching.storageKey)
        } else if let serialized = ContinueWatching.serialize(next) {
            defaults.set(serialized, forKey: ContinueWatching.storageKey)
        }
        return next
    }

    /// Wipe the shelf. Not wired to sign-out — this store is anonymous and
    /// per-install, so signing out does not make it someone else's history — but
    /// a shared living-room Apple TV needs an explicit "clear watch history"
    /// affordance in Settings, and this is it.
    func removeAll() {
        defaults.removeObject(forKey: ContinueWatching.storageKey)
    }
}
