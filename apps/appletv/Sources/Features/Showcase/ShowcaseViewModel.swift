import Foundation

// Showcase Mode — the unattended kiosk reel.
//
// A curated Experience (`tv-showcase`) is a list of felt-need CHAPTERS. Each
// chapter plays a few bounded EXCERPTS back to back; a chapter the curator
// marks `showcase-languages` plays ONE video whose audio HOPS through its dubs
// mid-play; every few chapters a STAT interstitial states the catalog's
// breadth; nothing playable at all falls back to STILLS. It loops forever with
// no viewer input.
//
// Everything above the `ShowcaseViewModel` at the bottom of this file is PURE
// and clock-free: the sequencing machine, the language policy, the hop plan,
// the excerpt windows, and the interstitial copy all decide without a player,
// a network, or a timer. That is not tidiness — this behavior runs unattended
// in an office for hours, so the only way to know it loops correctly is to be
// able to run a thousand transitions in a test in milliseconds.
//
// Ported from `apps/tv/src/lib/showcaseMode/*` (reelState, hopSchedule,
// languageRotation, sourceResolution, statLines). Where a rule below looks
// arbitrary it is almost always load-bearing and the comment says why.

// MARK: - Models

struct ShowcaseExcerpt: Equatable, Identifiable {
    let id: String
    /// Required, not optional: the per-video stream fetch keys on slug, so an
    /// item without one can never be played and is dropped at projection.
    let slug: String
    let title: String
    let posterURL: URL?
}

struct ShowcaseChapter: Equatable, Identifiable {
    let id: String
    /// Felt-need name ("Loneliness"). Empty on the fallback reel, which shows
    /// no chapter card at all.
    let title: String
    let subtitle: String?
    let excerpts: [ShowcaseExcerpt]
    /// The curator's reserved `showcase-languages` marker. This chapter's
    /// FIRST excerpt is the centerpiece — the one item that dub-switches
    /// mid-play instead of playing a single language.
    let isLanguageChapter: Bool
}

enum ShowcaseQueueKind: Equatable {
    /// The authored `tv-showcase` Experience: felt-need chapters + stat lines.
    case curated
    /// Composed from the Home pool when the Experience is unusable. No
    /// chapter cards (there are no felt-need labels) and no interstitials.
    case fallback
}

struct ShowcaseQueue: Equatable {
    let kind: ShowcaseQueueKind
    let chapters: [ShowcaseChapter]
    /// Curator-authored global claims. Empty on the fallback path — one
    /// video's dub count must never stand in for the catalog's breadth.
    let statLines: [String]
}

/// The bounded portion of a video an excerpt plays.
struct ExcerptWindow: Equatable {
    let start: TimeInterval
    let end: TimeInterval

    var duration: TimeInterval { max(0, end - start) }
}

/// One dub playing its segment of the centerpiece, plus the continuous media
/// window it occupies. Every hop is the SAME footage in a different language.
struct ShowcaseHop: Equatable {
    let languageSlug: String
    let languageName: String
    let playbackID: String
    let window: ExcerptWindow
}

/// What the player is being asked to play right now.
struct ShowcaseStream: Equatable {
    let playbackID: String
    let window: ExcerptWindow
    let languageName: String
    /// True only for a hop. An ordinary excerpt announces no language — the
    /// lower third exists to make the language SWITCH legible, and a label on
    /// every excerpt would make the one moment that matters unremarkable.
    let claimsLanguage: Bool
    /// The reel token this stream answers.
    ///
    /// Load-bearing, not diagnostic: the view starts playback from an
    /// `onChange` on this value, and a reel that loops onto the same excerpt —
    /// or a hop plan whose every hop shares one playback id — would otherwise
    /// publish an EQUAL stream and the change would never fire.
    let token: Int
    let posterURL: URL?
}

// MARK: - Projection

enum ShowcaseProjection {
    /// The Experience the kiosk reel renders. Verified against production
    /// 2026-08-12: 19 MediaCollection blocks — 12 felt-need chapters of 3
    /// items, 6 `showcase-languages` chapters of 1, and the stats block.
    static let experienceSlug = "tv-showcase"

    /// Reserved block TITLE carrying the authored stat lines, one per line of
    /// the block's description. The discriminator is the title because admin
    /// auto-generates section keys with no UI to set them.
    static let statsSectionTitle = "showcase-stats"

    /// Reserved `categoryLabel` marking the language chapter.
    static let languagesCategoryLabel = "showcase-languages"

    /// Curator strings are compared case-folded and trimmed: a casing slip
    /// must not leak the stats block onto the screen as a chapter, and must
    /// not fail to designate the language chapter.
    private static func matches(_ value: String?, _ marker: String) -> Bool {
        value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == marker
    }

    /// `tv-showcase` → the curated queue, or nil when nothing is playable.
    ///
    /// Reuses the watch-home Experience document verbatim (`Queries.watchHomeExperience`
    /// is parameterized by slug and already selects every field needed here),
    /// so the kiosk introduces no new server contract.
    static func curated(_ data: WatchHomeData) -> ShowcaseQueue? {
        let blocks = data.experienceBySlug?.blocks ?? []
        var chapters: [ShowcaseChapter] = []
        var statLines: [String] = []

        for (index, block) in blocks.enumerated() {
            guard block.__typename == "MediaCollectionBlock" else { continue }

            if matches(block.mcTitle, statsSectionTitle) {
                statLines = parseStatLines(block.mcDescription)
                continue
            }

            let id = block.sectionKey ?? "showcase-chapter-\(index)"
            let excerpts = (block.items ?? []).enumerated().compactMap { item in
                excerpt(from: item.element, chapterID: id, position: item.offset)
            }
            // A chapter with nothing playable is dropped WHOLE, so its card
            // never shows over an empty run.
            guard !excerpts.isEmpty else { continue }

            chapters.append(
                ShowcaseChapter(
                    id: id,
                    title: block.mcTitle ?? "",
                    subtitle: block.mcSubtitle,
                    excerpts: excerpts,
                    isLanguageChapter: matches(block.categoryLabel, languagesCategoryLabel)
                )
            )
        }

        guard !chapters.isEmpty else { return nil }
        return ShowcaseQueue(kind: .curated, chapters: chapters, statLines: statLines)
    }

    /// The rung below the Experience: compose one unlabeled chapter from the
    /// Home rails already projected for the Home screen. Deduped by card id so
    /// a video appearing in three rails does not play three times in a row.
    static func fallback(_ home: HomeModel) -> ShowcaseQueue? {
        var seen = Set<String>()
        var excerpts: [ShowcaseExcerpt] = []
        for card in home.rails.flatMap(\.items) {
            guard let slug = card.slug, seen.insert(card.id).inserted else { continue }
            excerpts.append(
                ShowcaseExcerpt(
                    id: "showcase-fallback:\(card.id)",
                    slug: slug,
                    title: card.title,
                    posterURL: card.posterURL
                )
            )
        }
        guard !excerpts.isEmpty else { return nil }
        return ShowcaseQueue(
            kind: .fallback,
            chapters: [
                ShowcaseChapter(
                    id: "showcase-fallback",
                    title: "",
                    subtitle: nil,
                    excerpts: excerpts,
                    isLanguageChapter: false
                )
            ],
            // Authored stats describe the curated reel and must not ride here.
            statLines: []
        )
    }

    private static func excerpt(
        from item: WireCollectionItem,
        chapterID: String,
        position: Int
    ) -> ShowcaseExcerpt? {
        guard let slug = item.videoSlug, !slug.isEmpty else { return nil }
        let poster = item.imageAsset?.previewUrl ?? item.videoImage?.previewUrl
        // Production leaves `titleOverride` null on every showcase item; the
        // real title arrives with the per-video fetch and replaces this one in
        // the interstitial's live line. The slug is a placeholder, never shown.
        return ShowcaseExcerpt(
            id: "\(chapterID):\(item.videoId ?? slug)-\(position)",
            slug: slug,
            title: item.titleOverride ?? item.subtitleOverride ?? slug,
            posterURL: poster.flatMap(URL.init(string:))
        )
    }

    private static func parseStatLines(_ description: String?) -> [String] {
        (description ?? "")
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }
}

// MARK: - Excerpt windows

enum ShowcaseWindow {
    /// A reel excerpt is a bounded 20–40s taste, never a whole film.
    static let minSeconds: TimeInterval = 20
    static let maxSeconds: TimeInterval = 40
    /// End credits are dead air on a kiosk screen; no window reaches into them.
    static let creditsTailSeconds: TimeInterval = 5
    private static let longFormOffsetRatio = 0.15

    /// One deterministic window per item: short items from 0, longer ones
    /// ~15% in (past the title card, into the scene), unknown durations still
    /// capped so a missing `duration` cannot start a two-hour film with no end.
    static func resolve(durationSeconds: Int?) -> ExcerptWindow {
        guard let seconds = durationSeconds, seconds > 0 else {
            return ExcerptWindow(start: 0, end: maxSeconds)
        }
        let duration = TimeInterval(seconds)
        // Floored so a fractional duration cannot round the end back into the
        // credits tail it was computed to clear.
        let creditsFreeEnd = (duration - creditsTailSeconds).rounded(.down)

        if duration <= maxSeconds {
            // Below ~25s, clearing the tail would drop under MIN, so a short
            // item plays out rather than being cut to a stub.
            return ExcerptWindow(
                start: 0,
                end: creditsFreeEnd >= minSeconds ? creditsFreeEnd : duration.rounded()
            )
        }
        let start = (duration * longFormOffsetRatio).rounded()
        return ExcerptWindow(start: start, end: min(start + maxSeconds, creditsFreeEnd))
    }
}

// MARK: - Language policy

enum ShowcaseLanguage {
    /// A dub the reel can actually play. The playback id is what the player
    /// builds its Mux URL from, so a dub without a valid one is not playable
    /// here regardless of what `hls` says.
    static func playable(_ dubs: [Dub]) -> [Dub] {
        dubs.filter { MuxURL.hlsURL(playbackID: $0.playbackID) != nil }
    }

    /// An ORDINARY excerpt plays the viewer's chosen audio language, or the
    /// default chain when they have none or it has no playable dub here.
    /// Identity is the language SLUG and never bcp47 — bcp47 collides in this
    /// catalog (ko/ko-kmr, en/en-nai), so a prefix match hands over a language
    /// nobody chose.
    static func pick(
        dubs: [Dub],
        viewerLanguageSlug: String?,
        deviceBcp47: String?
    ) -> Dub? {
        let playable = playable(dubs)
        guard !playable.isEmpty else { return nil }
        if let viewerLanguageSlug,
           let exact = playable.first(where: { $0.languageSlug == viewerLanguageSlug }) {
            return exact
        }
        // The lean per-video record carries no primary-language rung here, so
        // the device-locale / English / first rungs stand in.
        return DefaultDub.resolve(
            dubs: playable,
            preferredLanguageSlug: nil,
            deviceBcp47: deviceBcp47,
            videoPrimaryBcp47: nil
        ) ?? playable.first
    }
}

// MARK: - Language hop plan

enum ShowcaseHopSchedule {
    /// English's exact slug. Exact identity, never a bcp47 prefix — `en-nai`
    /// collides.
    static let englishSlug = "english"
    /// One dub holds the screen this long before the audio switches.
    static let segmentSeconds: TimeInterval = 10
    /// At most 9 languages, so at most a ~90s span.
    static let maxHops = 9
    /// A truncated final slice below this reads as a glitch — too short to
    /// hear the switch or read the label — so it is dropped, not flashed.
    static let minFinalSliceSeconds: TimeInterval = 4
    private static let offsetRatio = 0.15

    /// Build the centerpiece's hop plan, or nil when this video cannot show a
    /// language switch (fewer than two playable languages, or a source too
    /// short / of unknown duration). Nil means the caller plays it as an
    /// ordinary excerpt instead — a degrade, never an error.
    ///
    /// Pure and deterministic: the caller injects `rng`, so a test pins the
    /// exact order and the reel never surprises itself.
    static func build(
        dubs: [Dub],
        deviceBcp47: String?,
        rng: () -> Double
    ) -> [ShowcaseHop]? {
        let candidates = dedupeBySlug(
            ShowcaseLanguage.playable(dubs).filter { $0.languageSlug != nil }
        )
        // Under two languages there is no switch to show.
        guard candidates.count >= 2 else { return nil }

        let opener = pickOpener(candidates, deviceBcp47: deviceBcp47)
        guard let openerDuration = opener.durationSeconds, openerDuration > 0 else {
            return nil
        }

        let rest = candidates.filter { $0.languageSlug != opener.languageSlug }
        let ordered = [opener] + shuffle(rest, rng: rng)
        let desiredCount = min(ordered.count, maxHops)

        // Plan against the SHORTEST known duration among the scheduled dubs.
        // Dub durations drift per language (this catalog's German cut of
        // `how-to-know-jesus-personally` runs 335s against Dutch's 150s), and
        // every hop seeks the same window into its OWN asset — a window sized
        // to the opener alone would seek a shorter sibling past its end.
        var planningDuration = TimeInterval(openerDuration)
        for dub in ordered.prefix(desiredCount) {
            if let seconds = dub.durationSeconds, seconds > 0 {
                planningDuration = min(planningDuration, TimeInterval(seconds))
            }
        }

        guard let timing = planTiming(planningDuration, desiredCount: desiredCount) else {
            return nil
        }

        var hops: [ShowcaseHop] = []
        var position = timing.windowStart
        for (index, length) in timing.hopLengths.enumerated() {
            let dub = ordered[index]
            guard let slug = dub.languageSlug, let playbackID = dub.playbackID else { continue }
            let start = position
            position += length
            hops.append(
                ShowcaseHop(
                    languageSlug: slug,
                    languageName: dub.displayName,
                    playbackID: playbackID,
                    window: ExcerptWindow(start: start, end: position)
                )
            )
        }
        return hops.count >= 2 ? hops : nil
    }

    /// The opener plays first. English wins outright — it is the language most
    /// of the room reads, so the switch away from it is what registers.
    private static func pickOpener(_ dubs: [Dub], deviceBcp47: String?) -> Dub {
        if let english = dubs.first(where: { $0.languageSlug == englishSlug }) {
            return english
        }
        return DefaultDub.resolve(
            dubs: dubs,
            preferredLanguageSlug: nil,
            deviceBcp47: deviceBcp47,
            videoPrimaryBcp47: nil
        ) ?? dubs[0]
    }

    /// First occurrence per slug wins, so a video carrying two rows for one
    /// language still hops through it once.
    private static func dedupeBySlug(_ dubs: [Dub]) -> [Dub] {
        var seen = Set<String>()
        return dubs.filter { dub in
            guard let slug = dub.languageSlug else { return false }
            return seen.insert(slug).inserted
        }
    }

    /// Fisher–Yates over the injected rng. `j` is clamped so a boundary value
    /// (an rng that returns exactly 1) cannot index past the array.
    private static func shuffle(_ items: [Dub], rng: () -> Double) -> [Dub] {
        var out = items
        guard out.count > 1 else { return out }
        for i in stride(from: out.count - 1, to: 0, by: -1) {
            let j = min(max(Int(rng() * Double(i + 1)), 0), i)
            out.swapAt(i, j)
        }
        return out
    }

    /// Contiguous slice lengths and where the run starts, or nil when the
    /// source cannot host at least two segments.
    private static func planTiming(
        _ planningDuration: TimeInterval,
        desiredCount: Int
    ) -> (windowStart: TimeInterval, hopLengths: [TimeInterval])? {
        let creditsFreeEnd = (planningDuration - ShowcaseWindow.creditsTailSeconds).rounded(.down)
        guard creditsFreeEnd >= minFinalSliceSeconds else { return nil }

        let desiredTotal = TimeInterval(desiredCount) * segmentSeconds
        if desiredTotal <= creditsFreeEnd {
            // Every segment fits: offset ~15% in, clamped so the last hop
            // still lands before the credits tail.
            let offset = (planningDuration * offsetRatio).rounded()
            let windowStart = max(0, min(offset, creditsFreeEnd - desiredTotal))
            return (windowStart, Array(repeating: segmentSeconds, count: desiredCount))
        }

        // Too short for the full plan: pack whole segments from 0, then a
        // shortened final slice only if it clears the readable floor.
        let fullSlices = Int((creditsFreeEnd / segmentSeconds).rounded(.down))
        let remainder = creditsFreeEnd - TimeInterval(fullSlices) * segmentSeconds
        var hopLengths = Array(repeating: segmentSeconds, count: fullSlices)
        if hopLengths.count < desiredCount, remainder >= minFinalSliceSeconds {
            hopLengths.append(remainder)
        }
        return hopLengths.count >= 2 ? (0, hopLengths) : nil
    }
}

// MARK: - Stat interstitial copy

struct ShowcaseInterstitialContent: Equatable {
    let authoredLines: [String]
    /// The live claim about the video that just played; nil when it cannot
    /// support one.
    let liveLine: String?
}

enum ShowcaseStats {
    /// The card is fixed full-screen with no scroll; past this the lines run
    /// off a 1080p frame.
    static let maxAuthoredLines = 4

    /// The breadth claim counts LANGUAGES, not dub rows — several dubs can
    /// carry one language slug, and counting those twice overstates the
    /// catalog on a screen a stranger is reading.
    static func countDistinctLanguages(_ dubs: [Dub]) -> Int {
        Set(ShowcaseLanguage.playable(dubs).compactMap(\.languageSlug)).count
    }

    /// Authored globals ARE the breadth claim, so nil (skip the interstitial)
    /// is the answer whenever they are absent. One video's dub count never
    /// stands in for them.
    static func interstitial(
        authoredLines: [String],
        liveTitle: String?,
        liveLanguageCount: Int?
    ) -> ShowcaseInterstitialContent? {
        let lines = authoredLines
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .prefix(maxAuthoredLines)
        guard !lines.isEmpty else { return nil }
        return ShowcaseInterstitialContent(
            authoredLines: Array(lines),
            liveLine: liveLine(title: liveTitle, languageCount: liveLanguageCount)
        )
    }

    private static func liveLine(title: String?, languageCount: Int?) -> String? {
        guard let name = title?.trimmingCharacters(in: .whitespaces), !name.isEmpty,
              let count = languageCount, count >= 1
        else { return nil }
        return "\(name) is available in \(grouped(count)) \(count == 1 ? "language" : "languages")"
    }

    /// Hand-rolled thousands grouping rather than NumberFormatter: this string
    /// is read by a stranger walking past an office TV, and it must render the
    /// same on every device regardless of the TV's regional settings.
    static func grouped(_ value: Int) -> String {
        let digits = Array(String(value))
        var out = ""
        for (index, digit) in digits.enumerated() {
            if index > 0, (digits.count - index) % 3 == 0 { out.append(",") }
            out.append(digit)
        }
        return out
    }
}

// MARK: - The sequencing machine

enum ShowcasePhase: Equatable {
    case resolving
    case chapterCard
    case excerpt
    case interstitial
    /// The floor: poster art on a slow crossfade while resolution is retried
    /// behind it. Deliberately not an error screen — a walk-past viewer must
    /// never see a fault.
    case stills
    case exited
}

struct ShowcaseHopPlan: Equatable {
    let hops: [ShowcaseHop]
    let index: Int
}

struct ShowcaseReelState: Equatable {
    var phase: ShowcasePhase
    /// Last-good queue, retained through stills so the slideshow has art.
    var queue: ShowcaseQueue?
    var chapterIndex: Int
    var excerptIndex: Int
    var consecutiveFailures: Int
    /// Chapters completed since the last interstitial — drives the cadence.
    var chaptersSinceInterstitial: Int
    /// Bumps whenever the TARGET stream changes. A one-chapter reel loops onto
    /// identical indices and the identical excerpt value, so nothing else can
    /// tell the player "play that again".
    var excerptToken: Int
    /// Non-nil only while the centerpiece plays.
    var hop: ShowcaseHopPlan?

    static let initial = ShowcaseReelState(
        phase: .resolving,
        queue: nil,
        chapterIndex: 0,
        excerptIndex: 0,
        consecutiveFailures: 0,
        chaptersSinceInterstitial: 0,
        excerptToken: 0,
        hop: nil
    )
}

enum ShowcaseEvent: Equatable {
    /// A queue resolved: cold start, or a retry rejoining the reel from stills.
    case resolved(ShowcaseQueue)
    /// Resolution yielded nothing playable.
    case resolveFailed
    case cardTimerElapsed
    case interstitialTimerElapsed
    /// The bounded window reached its end — and the breaker's only reset.
    case excerptEnded
    /// This item cannot play. Skip it.
    case excerptFailed
    /// The centerpiece's hop plan finished building. Carries the token it was
    /// built for so a plan that arrives after the reel moved on is dropped.
    case hopPlanResolved(token: Int, hops: [ShowcaseHop])
    /// A deliberate remote press. Terminal from every state.
    case exit
}

enum ShowcaseReel {
    /// The chapter card names the felt need for about five seconds — and it
    /// doubles as the resolve window for the excerpt behind it.
    static let chapterCardDuration: TimeInterval = 5
    static let interstitialDuration: TimeInterval = 6
    /// Stills re-attempt resolution on a slow beat rather than hammering a
    /// backend that is already unhappy.
    static let stillsRetryInterval: TimeInterval = 30
    static let interstitialEveryNChapters = 3
    /// Several consecutive dead items before the reel stops fast-skipping and
    /// settles into stills.
    static let failureBreakerThreshold = 3

    // MARK: Selectors

    static func currentChapter(_ state: ShowcaseReelState) -> ShowcaseChapter? {
        guard let queue = state.queue,
              state.chapterIndex >= 0, state.chapterIndex < queue.chapters.count
        else { return nil }
        return queue.chapters[state.chapterIndex]
    }

    static func currentExcerpt(_ state: ShowcaseReelState) -> ShowcaseExcerpt? {
        guard let chapter = currentChapter(state),
              state.excerptIndex >= 0, state.excerptIndex < chapter.excerpts.count
        else { return nil }
        return chapter.excerpts[state.excerptIndex]
    }

    /// True when the current position is the language chapter's centerpiece —
    /// the one item that hops. Only the FIRST excerpt of such a chapter hops;
    /// the curator may put more behind it and those play ordinarily.
    static func isCenterpiece(_ state: ShowcaseReelState) -> Bool {
        currentChapter(state)?.isLanguageChapter == true && state.excerptIndex == 0
    }

    /// The excerpt that plays next if nothing fails — the poster to warm.
    /// Wraps within the current queue at the loop boundary.
    static func nextExcerpt(_ state: ShowcaseReelState) -> ShowcaseExcerpt? {
        guard let queue = state.queue, let chapter = currentChapter(state) else { return nil }
        let within = state.excerptIndex + 1
        if within < chapter.excerpts.count { return chapter.excerpts[within] }
        guard let nextIndex = playableChapterIndex(queue, from: state.chapterIndex + 1)
            ?? playableChapterIndex(queue, from: 0)
        else { return nil }
        return queue.chapters[nextIndex].excerpts.first
    }

    /// Poster art for the stills floor, deduped, from the last-good queue.
    static func stillsPosters(_ state: ShowcaseReelState) -> [URL] {
        var seen = Set<URL>()
        return (state.queue?.chapters ?? [])
            .flatMap(\.excerpts)
            .compactMap(\.posterURL)
            .filter { seen.insert($0).inserted }
    }

    // MARK: Chapter selection

    /// A chapter with no playable items is skipped whole, so its card never
    /// shows over nothing.
    private static func playableChapterIndex(
        _ queue: ShowcaseQueue,
        from: Int
    ) -> Int? {
        var index = max(from, 0)
        while index < queue.chapters.count {
            if !queue.chapters[index].excerpts.isEmpty { return index }
            index += 1
        }
        return nil
    }

    private static func enterChapter(
        _ state: ShowcaseReelState,
        _ queue: ShowcaseQueue,
        at chapterIndex: Int
    ) -> ShowcaseReelState {
        var next = state
        // The fallback reel carries no felt-need labels, so it never shows a
        // chapter card — a blank card is worse than no card.
        next.phase = queue.kind == .fallback ? .excerpt : .chapterCard
        next.queue = queue
        next.chapterIndex = chapterIndex
        next.excerptIndex = 0
        next.excerptToken += 1
        next.hop = nil
        return next
    }

    private static func enterQueue(
        _ state: ShowcaseReelState,
        _ queue: ShowcaseQueue,
        keepCadence: Bool
    ) -> ShowcaseReelState {
        guard let chapterIndex = playableChapterIndex(queue, from: 0) else {
            var next = state
            next.phase = .stills
            next.queue = queue
            next.hop = nil
            return next
        }
        var seed = state
        seed.queue = queue
        // A wrap is the SAME queue continuing, so its failures still count.
        // Zeroing here would let a short all-dead reel loop forever and never
        // reach stills; only a fresh attempt earns a clean slate.
        seed.consecutiveFailures = keepCadence ? state.consecutiveFailures : 0
        seed.chaptersSinceInterstitial = keepCadence ? state.chaptersSinceInterstitial : 0
        seed.hop = nil
        return enterChapter(seed, queue, at: chapterIndex)
    }

    private static func advanceToNextChapter(
        _ state: ShowcaseReelState,
        _ queue: ShowcaseQueue
    ) -> ShowcaseReelState {
        guard let nextIndex = playableChapterIndex(queue, from: state.chapterIndex + 1) else {
            // The loop boundary: the same queue starts over, cadence intact.
            return enterQueue(state, queue, keepCadence: true)
        }
        return enterChapter(state, queue, at: nextIndex)
    }

    private static func isInterstitialDue(_ queue: ShowcaseQueue, completed: Int) -> Bool {
        // Interstitials need authored stats, and the fallback reel skips the
        // branch entirely rather than passing one video's dub count off as the
        // breadth claim.
        guard queue.kind == .curated, !queue.statLines.isEmpty else { return false }
        return completed >= interstitialEveryNChapters
    }

    private static func advanceExcerpt(
        _ state: ShowcaseReelState,
        _ queue: ShowcaseQueue
    ) -> ShowcaseReelState {
        guard state.chapterIndex >= 0, state.chapterIndex < queue.chapters.count else {
            return enterQueue(state, queue, keepCadence: true)
        }
        let chapter = queue.chapters[state.chapterIndex]
        let within = state.excerptIndex + 1
        if within < chapter.excerpts.count {
            var next = state
            next.phase = .excerpt
            next.excerptIndex = within
            next.excerptToken += 1
            return next
        }

        let completed = state.chaptersSinceInterstitial + 1
        if isInterstitialDue(queue, completed: completed) {
            var next = state
            next.phase = .interstitial
            next.chaptersSinceInterstitial = 0
            return next
        }
        var carried = state
        carried.chaptersSinceInterstitial = completed
        return advanceToNextChapter(carried, queue)
    }

    /// The breaker: one strike, then either stills at the threshold or a skip
    /// to the next item.
    private static func failExcerpt(
        _ state: ShowcaseReelState,
        _ queue: ShowcaseQueue
    ) -> ShowcaseReelState {
        var struck = state
        struck.consecutiveFailures += 1
        if struck.consecutiveFailures >= failureBreakerThreshold {
            struck.phase = .stills
            return struck
        }
        let advanced = advanceExcerpt(struck, queue)
        // Stay on the card while retrying behind it: the card IS the resolve
        // window, and holding it lets it run its full five seconds instead of
        // flashing past a dead first item.
        if state.phase == .chapterCard,
           advanced.phase == .excerpt,
           advanced.chapterIndex == state.chapterIndex {
            var held = advanced
            held.phase = .chapterCard
            return held
        }
        return advanced
    }

    // MARK: Reducer

    static func reduce(_ state: ShowcaseReelState, _ event: ShowcaseEvent) -> ShowcaseReelState {
        // Exit is terminal, which also makes it idempotent — a remote can
        // deliver one press through more than one path.
        guard state.phase != .exited else { return state }

        switch event {
        case .exit:
            var next = state
            next.phase = .exited
            return next

        case .resolved(let queue):
            // Cold start, or a retry rejoining from stills — both restart the
            // reel with a clean breaker.
            guard state.phase == .resolving || state.phase == .stills else { return state }
            return enterQueue(state, queue, keepCadence: false)

        case .resolveFailed:
            guard state.phase == .resolving else { return state }
            var next = state
            next.phase = .stills
            return next

        case .cardTimerElapsed:
            guard state.phase == .chapterCard else { return state }
            var next = state
            next.phase = .excerpt
            return next

        case .interstitialTimerElapsed:
            guard state.phase == .interstitial, let queue = state.queue else { return state }
            return advanceToNextChapter(state, queue)

        case .hopPlanResolved(let token, let hops):
            // The plan enters state only for the excerpt it was built for; a
            // stale plan (the reel advanced during the async build) is dropped.
            // The card is the centerpiece's buffer window, so both phases that
            // hold an in-flight excerpt may enter hop mode.
            guard state.excerptToken == token else { return state }
            guard state.phase == .excerpt || state.phase == .chapterCard else { return state }
            // A one-hop "plan" is not a language switch — play it ordinarily.
            guard hops.count >= 2 else { return state }
            var next = state
            next.hop = ShowcaseHopPlan(hops: hops, index: 0)
            return next

        case .excerptEnded:
            guard state.phase == .excerpt, let queue = state.queue else { return state }
            if let hop = state.hop {
                let nextIndex = hop.index + 1
                if nextIndex < hop.hops.count {
                    // Next hop: same footage, different dub. The token bump is
                    // what re-arms the player swap and the chrome animation.
                    var next = state
                    next.hop = ShowcaseHopPlan(hops: hop.hops, index: nextIndex)
                    next.excerptToken += 1
                    return next
                }
                var cleared = state
                cleared.hop = nil
                cleared.consecutiveFailures = 0
                return advanceExcerpt(cleared, queue)
            }
            // Completion is the ONLY proof the path works, so it is the only
            // thing that clears the breaker. A first frame proves nothing — an
            // item can paint one and then freeze.
            var played = state
            played.consecutiveFailures = 0
            return advanceExcerpt(played, queue)

        case .excerptFailed:
            // A curated chapter enters on its card while the token has already
            // armed the resolve, so an excerpt can fail BEFORE its own phase.
            // Dropping that case wedges the reel on the card with nothing left
            // to re-arm it.
            guard state.phase == .excerpt || state.phase == .chapterCard,
                  let queue = state.queue
            else { return state }
            if let hop = state.hop {
                let nextIndex = hop.index + 1
                if nextIndex < hop.hops.count {
                    // A failed or stalled hop skips to the next planned hop
                    // WITHOUT a strike — a dead dub is not a dead excerpt.
                    var next = state
                    next.hop = ShowcaseHopPlan(hops: hop.hops, index: nextIndex)
                    next.excerptToken += 1
                    return next
                }
                // No playable hop remains: the centerpiece itself failed. It
                // takes a SINGLE strike, not one per dead dub.
                var cleared = state
                cleared.hop = nil
                return failExcerpt(cleared, queue)
            }
            return failExcerpt(state, queue)
        }
    }
}

// MARK: - Injectable seams

/// Where the reel's content comes from. Injected so every test above and the
/// view-model tests below run without a network.
struct ShowcaseSource {
    var loadQueue: () async -> ShowcaseQueue?
    var loadVideo: (String) async -> WatchVideo?

    /// Production wiring: the curated Experience, falling back to the Home
    /// pool, falling back to stills (the view model turns a nil into stills).
    static let live = ShowcaseSource(
        loadQueue: {
            let client = GraphQLClient()
            if let data = try? await client.fetch(
                WatchHomeData.self,
                query: Queries.watchHomeExperience,
                variables: [
                    "locale": Config.contentLocale,
                    "slug": ShowcaseProjection.experienceSlug,
                ]
            ), let queue = ShowcaseProjection.curated(data) {
                return queue
            }
            if let home = try? await client.fetch(
                WatchHomeData.self,
                query: Queries.watchHomeExperience,
                variables: [
                    "locale": Config.contentLocale,
                    "slug": Config.homeExperienceSlug,
                ]
            ) {
                return ShowcaseProjection.fallback(HomeProjection.project(home))
            }
            return nil
        },
        loadVideo: { slug in
            try? await VideoRepository().video(slug: slug)
        }
    )
}

/// The one impure thing the sequencing needs. Injected so a test can drive
/// hours of reel in milliseconds — and so a stuck timer is a value, not a
/// behavior you can only observe by waiting.
struct ShowcaseClock {
    var sleep: (TimeInterval) async throws -> Void = { seconds in
        try await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
    }
}

// MARK: - View model

/// Drives the pure machine above: owns the timers, the per-excerpt resolution,
/// and the stream the player is asked to play. It decides nothing itself —
/// every branch worth testing lives in `ShowcaseReel` and its neighbours.
@MainActor
final class ShowcaseViewModel: ObservableObject {
    @Published private(set) var state = ShowcaseReelState.initial
    /// What to play. Nil while a stream is being resolved — the view holds the
    /// previous frame under a cover rather than showing black.
    @Published private(set) var stream: ShowcaseStream?
    /// The resolved title/language count of the video currently playing, for
    /// the interstitial's live line.
    @Published private(set) var liveTitle: String?
    @Published private(set) var liveLanguageCount: Int?

    private let source: ShowcaseSource
    private let clock: ShowcaseClock
    private let viewerLanguageSlug: String?
    private let deviceBcp47: String?
    private let rng: () -> Double
    private let telemetry: Telemetry

    private var phaseTask: Task<Void, Never>?
    private var resolveTask: Task<Void, Never>?
    /// What the effect layer has already acted on. Reset by `suspend()` so a
    /// return from background re-arms both timer and stream.
    private var armedPhase: ShowcasePhase?
    private var armedStreamKey: StreamKey?
    private var startReported = false
    private var exitReported = false

    /// The stream identity: token alone is not enough, because a hop advance
    /// bumps the token but a hop PLAN landing does not.
    private struct StreamKey: Equatable {
        let token: Int
        let hopIndex: Int?
    }

    init(
        source: ShowcaseSource = .live,
        clock: ShowcaseClock = ShowcaseClock(),
        viewerLanguageSlug: String? = nil,
        deviceBcp47: String? = Locale.current.language.languageCode?.identifier,
        rng: @escaping () -> Double = { Double.random(in: 0 ..< 1) },
        telemetry: Telemetry = .shared
    ) {
        self.source = source
        self.clock = clock
        self.viewerLanguageSlug = viewerLanguageSlug
        self.deviceBcp47 = deviceBcp47
        self.rng = rng
        self.telemetry = telemetry
    }

    // MARK: View-facing projections

    var chapter: ShowcaseChapter? { ShowcaseReel.currentChapter(state) }
    var excerpt: ShowcaseExcerpt? { ShowcaseReel.currentExcerpt(state) }
    var stillsPosters: [URL] { ShowcaseReel.stillsPosters(state) }

    var interstitial: ShowcaseInterstitialContent? {
        ShowcaseStats.interstitial(
            authoredLines: state.queue?.statLines ?? [],
            liveTitle: liveTitle,
            liveLanguageCount: liveLanguageCount
        )
    }

    // MARK: Lifecycle

    func start() {
        guard state.phase == .resolving, phaseTask == nil else { return }
        armEffects()
    }

    /// The player reached this stream's window end.
    func streamEnded() { send(.excerptEnded) }

    /// This stream cannot play (bad id, decode failure, never started).
    func streamFailed() { send(.excerptFailed) }

    /// A deliberate press, or the screen going away. Terminal.
    func exit(reason: String = "press") {
        reportExit(reason: reason)
        send(.exit)
    }

    /// Backgrounded. Timers and the in-flight resolve stop; the state stays,
    /// so `resume()` picks the reel up where it stood.
    ///
    /// tvOS `.inactive` must NOT call this: it is a foreground blip (Siri,
    /// Control Center) and tearing down there kills playback the moment
    /// somebody presses the Siri button.
    func suspend() {
        phaseTask?.cancel()
        phaseTask = nil
        resolveTask?.cancel()
        resolveTask = nil
        armedPhase = nil
        armedStreamKey = nil
        stream = nil
    }

    func resume() {
        guard state.phase != .exited else { return }
        armEffects()
    }

    // MARK: Machine driving

    private func send(_ event: ShowcaseEvent) {
        let next = ShowcaseReel.reduce(state, event)
        guard next != state else { return }
        state = next
        armEffects()
    }

    private func armEffects() {
        if state.phase == .exited {
            suspend()
            return
        }
        reportStartIfNeeded()
        armPhaseTimer()
        armStream()
    }

    private func armPhaseTimer() {
        guard armedPhase != state.phase else { return }
        armedPhase = state.phase
        phaseTask?.cancel()

        switch state.phase {
        case .resolving:
            phaseTask = Task { [weak self] in await self?.resolveQueue() }
        case .chapterCard:
            phaseTask = wait(ShowcaseReel.chapterCardDuration) { [weak self] in
                self?.send(.cardTimerElapsed)
            }
        case .interstitial:
            phaseTask = wait(ShowcaseReel.interstitialDuration) { [weak self] in
                self?.send(.interstitialTimerElapsed)
            }
        case .stills:
            // Keep trying behind the art. No error copy, no spinner: this is a
            // display in a public space, not a debugging surface.
            //
            // A LOOP, not one delayed attempt. Every other phase re-arms its
            // timer through the state-change path in `send`, but `.resolveFailed`
            // is deliberately a no-op once the reel is ALREADY on stills — so a
            // failed retry changes nothing and nothing re-arms this timer. A
            // single-shot retry meant an office TV that lost the backend for one
            // minute held the same art until somebody power-cycled it, long
            // after the network came back.
            //
            // `clock` is captured directly so no strong `self` is held across
            // the wait; a resolve that succeeds moves the reel off `.stills`,
            // which cancels this task from `armPhaseTimer`.
            phaseTask = Task { [weak self, clock] in
                while !Task.isCancelled {
                    try? await clock.sleep(ShowcaseReel.stillsRetryInterval)
                    guard !Task.isCancelled, let self else { return }
                    await self.resolveQueue()
                    guard self.state.phase == .stills else { return }
                    // An injected clock can make the wait above instantaneous,
                    // and `resolveQueue` need not suspend either. Without a
                    // guaranteed suspension point this loop would starve the
                    // main actor it runs on.
                    await Task.yield()
                }
            }
        case .excerpt:
            // The player owns this phase's end, not a timer.
            phaseTask = nil
        case .exited:
            phaseTask = nil
        }
    }

    private func wait(
        _ seconds: TimeInterval,
        then action: @escaping @MainActor () -> Void
    ) -> Task<Void, Never> {
        Task { [clock] in
            try? await clock.sleep(seconds)
            guard !Task.isCancelled else { return }
            action()
        }
    }

    private func resolveQueue() async {
        let queue = await source.loadQueue()
        guard !Task.isCancelled else { return }
        if let queue {
            send(.resolved(queue))
        } else {
            send(.resolveFailed)
        }
    }

    // MARK: Stream resolution

    private func armStream() {
        let key = StreamKey(token: state.excerptToken, hopIndex: state.hop?.index)
        guard armedStreamKey != key else { return }
        // Only phases that hold an in-flight excerpt resolve one. The card
        // resolves deliberately — it IS the buffer window for what follows.
        guard state.phase == .chapterCard || state.phase == .excerpt else { return }
        armedStreamKey = key
        resolveTask?.cancel()

        if let hop = state.hop, hop.index < hop.hops.count {
            // A hop's stream is already fully known — no fetch, so the switch
            // is bounded by the player alone.
            let current = hop.hops[hop.index]
            stream = ShowcaseStream(
                playbackID: current.playbackID,
                window: current.window,
                languageName: current.languageName,
                claimsLanguage: true,
                token: state.excerptToken,
                posterURL: excerpt?.posterURL
            )
            return
        }

        guard let excerpt else { return }
        let token = state.excerptToken
        let centerpiece = ShowcaseReel.isCenterpiece(state)
        stream = nil

        resolveTask = Task { [weak self] in
            guard let self else { return }
            let video = await self.source.loadVideo(excerpt.slug)
            guard !Task.isCancelled, self.state.excerptToken == token else { return }

            guard let video, !video.dubs.isEmpty else {
                self.send(.excerptFailed)
                return
            }
            self.liveTitle = video.title
            self.liveLanguageCount = ShowcaseStats.countDistinctLanguages(video.dubs)

            if centerpiece,
               let hops = ShowcaseHopSchedule.build(
                   dubs: video.dubs, deviceBcp47: self.deviceBcp47, rng: self.rng
               ) {
                // The plan lands in state; the effect layer then publishes its
                // first hop, so there is exactly one path that starts a stream.
                self.send(.hopPlanResolved(token: token, hops: hops))
                return
            }

            guard let pick = ShowcaseLanguage.pick(
                dubs: video.dubs,
                viewerLanguageSlug: self.viewerLanguageSlug,
                deviceBcp47: self.deviceBcp47
            ), let playbackID = pick.playbackID else {
                self.send(.excerptFailed)
                return
            }

            self.stream = ShowcaseStream(
                playbackID: playbackID,
                window: ShowcaseWindow.resolve(durationSeconds: pick.durationSeconds),
                languageName: pick.displayName,
                claimsLanguage: false,
                token: token,
                posterURL: excerpt.posterURL
            )
        }
    }

    // MARK: Telemetry

    /// The reel is presenting something, which is the first moment the session
    /// can honestly name its path. A press that exits during resolution never
    /// started.
    private func reportStartIfNeeded() {
        guard !startReported, state.phase != .resolving, state.phase != .exited else { return }
        startReported = true
        // No queue IS the stills floor: the last-good queue is retained
        // through stills, so nil means content was never found.
        let path: String
        switch state.queue?.kind {
        case .curated: path = "curated"
        case .fallback: path = "fallback"
        case nil: path = "stills"
        }
        telemetry.record(TelemetrySignals.showcaseStart, ["path": .text(path)])
    }

    private func reportExit(reason: String) {
        guard startReported, !exitReported else { return }
        exitReported = true
        telemetry.record(
            TelemetrySignals.showcaseExit,
            [
                "reason": .text(reason),
                "chapter_index": .int(state.chapterIndex),
            ]
        )
    }
}
