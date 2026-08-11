import XCTest
@testable import JesusFilmTV

// Home parity (plan R9/R10). Two contracts are under test here and both are
// cross-surface, not local: the hero queue must pick what web and mobile pick
// on the same ET day, and the Continue Watching thresholds must be the exact
// numbers the React Native app ships.

private func date(_ iso: String) -> Date {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    guard let parsed = formatter.date(from: iso) else {
        preconditionFailure("unparseable test instant \(iso)")
    }
    return parsed
}

// MARK: - Business date

final class BusinessDateTests: XCTestCase {
    /// Every instant here sits in the 04:00–05:00 UTC window, which is the ONLY
    /// window where -4 and -5 disagree about the calendar DATE. An instant at
    /// noon UTC yields the same string under either offset and would pass for
    /// both the correct and the broken rule.
    private let discriminating: [(String, String)] = [
        // 2025 — DST starts Mar 9, ends Nov 2.
        ("2025-03-08T04:30:00Z", "2025-03-07"),
        ("2025-03-10T04:30:00Z", "2025-03-10"),
        ("2025-11-01T04:30:00Z", "2025-11-01"),
        ("2025-11-03T04:30:00Z", "2025-11-02"),
        // 2026 — DST starts Mar 8, ends Nov 1.
        ("2026-03-07T04:30:00Z", "2026-03-06"),
        ("2026-03-09T04:30:00Z", "2026-03-09"),
        ("2026-10-31T04:30:00Z", "2026-10-31"),
        ("2026-11-02T04:30:00Z", "2026-11-01"),
        // 2027 — DST starts Mar 14, ends Nov 7. The transition dates move by
        // more than a week year to year, so a rule that hardcoded 2026's dates
        // would pass the 2026 rows and fail these.
        ("2027-03-13T04:30:00Z", "2027-03-12"),
        ("2027-03-15T04:30:00Z", "2027-03-15"),
        ("2027-11-06T04:30:00Z", "2027-11-06"),
        ("2027-11-08T04:30:00Z", "2027-11-07"),
        // The transition day itself, before the 07:00 UTC switch.
        ("2026-03-08T04:30:00Z", "2026-03-07"),
        // Deep winter and deep summer.
        ("2026-01-15T04:30:00Z", "2026-01-14"),
        ("2026-07-13T04:30:00Z", "2026-07-13"),
        // Year boundary: 04:30 UTC on Jan 1 is still the previous YEAR in ET.
        ("2027-01-01T04:30:00Z", "2026-12-31"),
        ("2026-12-31T23:00:00Z", "2026-12-31"),
    ]

    func testBusinessDateIsTheEasternCalendarDateAcrossDstInBothDirections() {
        for (iso, expected) in discriminating {
            XCTAssertEqual(HeroQueue.businessDate(date(iso)), expected, "at \(iso)")
        }
    }

    /// The tz-database path and the hand-rolled US-Eastern fallback must agree,
    /// or a device with a missing/failed `TimeZone(identifier:)` would rotate on
    /// a different day than the rest of the fleet — the exact desync React
    /// Native hand-rolled its rule to prevent.
    func testHandRolledUSEasternRuleAgreesWithTheTimeZoneDatabase() {
        for (iso, expected) in discriminating {
            XCTAssertEqual(HeroQueue.businessDateFromUSEasternRule(date(iso)), expected, "at \(iso)")
        }
    }

    /// The date string cannot pin the transition INSTANT — the switch happens at
    /// 07:00/06:00 UTC and the day boundary at 04:00–05:00 UTC, so no single
    /// instant exercises both. Assert the offset at its own layer instead.
    func testOffsetFlipsAtTheExactTransitionInstant() {
        let transitions: [(start: String, end: String)] = [
            (start: "2025-03-09T07:00:00Z", end: "2025-11-02T06:00:00Z"),
            (start: "2026-03-08T07:00:00Z", end: "2026-11-01T06:00:00Z"),
            (start: "2027-03-14T07:00:00Z", end: "2027-11-07T06:00:00Z"),
        ]
        for transition in transitions {
            let start = date(transition.start)
            let end = date(transition.end)
            XCTAssertEqual(HeroQueue.usEasternOffsetHours(start.addingTimeInterval(-1)), -5,
                           "still EST one second before \(transition.start)")
            XCTAssertEqual(HeroQueue.usEasternOffsetHours(start), -4,
                           "EDT begins exactly at \(transition.start)")
            XCTAssertEqual(HeroQueue.usEasternOffsetHours(end.addingTimeInterval(-1)), -4,
                           "still EDT one second before \(transition.end)")
            XCTAssertEqual(HeroQueue.usEasternOffsetHours(end), -5,
                           "EST resumes exactly at \(transition.end)")
        }
    }
}

// MARK: - Fixtures

private func image(_ coreId: String) -> HomeVideoImage {
    HomeVideoImage(
        url: "https://img.example/\(coreId).jpg",
        thumbnail: nil,
        mobileCinematicHigh: "https://img.example/\(coreId)-high.jpg",
        mobileCinematicLow: nil,
        videoStill: nil
    )
}

private func video(
    _ coreId: String,
    _ label: String,
    children childCoreIds: [String] = [],
    durationSeconds: Int? = 3600,
    omitSlug: Bool = false,
    omitImages: Bool = false
) -> HomeVideoInput {
    HomeVideoInput(
        documentId: "\(coreId)-doc",
        coreId: coreId,
        slug: omitSlug ? nil : "\(coreId)-slug",
        label: label,
        durationSeconds: durationSeconds,
        images: omitImages ? [] : [image(coreId)],
        locales: [
            HomeVideoLocale(
                title: "Title \(coreId)",
                description: "Description \(coreId)",
                snippet: "Snippet \(coreId)",
                imageAlt: "Alt \(coreId)"
            )
        ],
        children: childCoreIds.isEmpty
            ? nil
            : childCoreIds.map { HomeVideoChildRelation(child: video($0, "SEGMENT")) }
    )
}

/// Shaped like what admin actually returns for `WatchHomeConfig.coreIds()`
/// (verified against production 2026-08-12): three playlist sources are
/// FEATURE_FILM and everything else in the sequence is a COLLECTION/SERIES
/// container, while five of the section sources are SHORT_FILM. The ORDER is
/// the response order admin gives for that argument list.
private let productionShapedVideos: [HomeVideoInput] = [
    video("1_jf-0-0", "FEATURE_FILM", children: ["1_jf6101-0-0", "1_jf6102-0-0"]),
    video("8_NBC", "SERIES"),
    video("2_GOJ-0-0", "FEATURE_FILM"),
    video("JFP-Featured", "COLLECTION"),
    video("MAG1", "FEATURE_FILM"),
    video("CS1", "COLLECTION"),
    video("11_Advent", "SERIES"),
    video("GOJohnCollection", "COLLECTION"),
    video("GOLukeCollection", "COLLECTION"),
    video("GOMarkCollection", "COLLECTION"),
    video("GOMattCollection", "COLLECTION"),
    video("2_0-ConsideringChristmas", "SHORT_FILM"),
    video("2_0-SupremeChristmas", "SHORT_FILM"),
    video("2_0-Noelevator", "SHORT_FILM"),
    video("2_0-TimeForChange", "SHORT_FILM"),
    video("2_0-Stunned", "SHORT_FILM"),
    video("1_jf6102-0-0", "SEGMENT"),
]

// MARK: - Hero queue

final class HeroQueueTests: XCTestCase {
    private func coreIds(_ cards: [HeroCard]) -> [String] { cards.map(\.coreId) }

    // MARK: Hash

    /// Pinned against the React Native implementation, run for real (node, JS
    /// int32 semantics). Recomputing these from the Swift port would prove only
    /// that the port agrees with itself; the whole point of the hash is that it
    /// agrees with the OTHER language.
    func testSimpleHashMatchesTheJavaScriptInt32Rule() {
        XCTAssertEqual(HeroQueue.simpleHash(""), 0)
        XCTAssertEqual(HeroQueue.simpleHash("a"), 97)
        XCTAssertEqual(HeroQueue.simpleHash("abc"), 96354)
        XCTAssertEqual(HeroQueue.simpleHash("abd"), 96355)
        XCTAssertEqual(HeroQueue.simpleHash("shortFilms"), 1_542_566_995)
        // Long enough to overflow int32 many times over — this is the case a
        // naive 64-bit port gets wrong, because it never wraps.
        XCTAssertEqual(
            HeroQueue.simpleHash("xyzzy-plugh-nested-deep-seed-value-1234567890"),
            7_246_304
        )
        // Real seeds, as `deterministicOffset` builds them.
        XCTAssertEqual(
            HeroQueue.simpleHash("2026-07-13playlist-0-1_jf-0-0-cycle0-prog0"),
            1_262_484_491
        )
        XCTAssertEqual(HeroQueue.simpleHash("2026-07-13shortFilms-cycle0-prog1"), 316_999_663)
    }

    func testOffsetIsInRangeStableForADayAndZeroForAnEmptyPool() {
        let now = date("2026-07-13T15:00:00Z")
        let first = HeroQueue.deterministicOffset(poolID: "pool-x", videoCount: 5, now: now, poolIndex: 0)
        let second = HeroQueue.deterministicOffset(poolID: "pool-x", videoCount: 5, now: now, poolIndex: 0)
        XCTAssertEqual(first, second)
        XCTAssertTrue((0 ..< 5).contains(first))
        XCTAssertEqual(HeroQueue.deterministicOffset(poolID: "pool-x", videoCount: 0, now: now), 0)
    }

    // MARK: Config

    /// The fetch argument order decides the response order, which decides the
    /// `shortFilms` pool order, which decides which short film the day-hash
    /// lands on. Pinned against `getWatchHomeCoreIds()` run from the React
    /// Native source.
    func testCoreIdsMatchTheReactNativeFetchSetInOrder() {
        XCTAssertEqual(WatchHomeConfig.coreIds(), [
            "1_jf-0-0", "2_GOJ-0-0", "GOMattCollection", "LUMOCollection", "JFP-Featured",
            "8_NBC", "GOJohnCollection", "GOLukeCollection", "GOMarkCollection", "7_Origins",
            "Nua", "2_ElCamWaySJEN", "MAG1", "11_Sermon", "11_Shema", "11_ReadBible",
            "11_Advent", "CS1", "9_CreationtoChrist", "2_FileZero-0-0", "10_DarkroomFaith",
            "2_0-ConsideringChristmas", "2_0-SupremeChristmas", "2_0-Noelevator",
            "2_0-TimeForChange", "2_0-Stunned", "1_wl604412-0-0", "9_0-TheSavior5505",
            "1_cl1301-0-0", "3_0-40DWJ_02-0-0", "1_jf6102-0-0", "1_riv_11-0-0",
            "1_wl604410-0-0", "6_GOLuke2601", "6_GOLuke2602", "6_GOMatt2501", "7_0-ncs",
            "7_Origins2Worth",
        ])
    }

    func testBlacklistedIdsNeverReachTheFetchSet() {
        XCTAssertFalse(WatchHomeConfig.coreIds().contains("7_Origins4Connect"))
    }

    // MARK: Pools

    func testPoolsDropCollectionAndSeriesContainersButKeepFeatureFilms() {
        // A COLLECTION record's playable media lives on its child episodes, so
        // it carries no stream of its own and must never hero. A feature film
        // is kept even though it has chapter children (the JESUS case).
        let pools = HeroQueue.pools(HeroQueue.sourceMap([
            video("1_jf-0-0", "FEATURE_FILM", children: ["jf-ep1", "jf-ep2"]),
            video("8_NBC", "COLLECTION", children: ["nbc-ep1"]),
            video("GOMattCollection", "SERIES", children: ["gomatt-ep1"]),
        ]))

        XCTAssertEqual(pools.map(\.id), ["playlist-0-1_jf-0-0"])
        XCTAssertEqual(coreIds(pools[0].cards), ["1_jf-0-0"])
    }

    func testPoolIdKeepsTheUnfilteredSequenceIndex() {
        // MAG1 is group 5 and 2_GOJ-0-0 is group 7. Groups 1–4 and 6 hydrate
        // nothing here, and the survivors must NOT be renumbered 0 and 1 — the
        // id is the hash seed, so renumbering would pick a different day's card
        // than web.
        let pools = HeroQueue.pools(HeroQueue.sourceMap([
            video("MAG1", "FEATURE_FILM"),
            video("2_GOJ-0-0", "FEATURE_FILM"),
        ]))
        XCTAssertEqual(pools.map(\.id), ["playlist-5-MAG1", "playlist-7-2_GOJ-0-0"])
    }

    func testMultiSourceGroupIdJoinsItsIdsWithAPipe() {
        let pools = HeroQueue.pools(HeroQueue.sourceMap([
            video("GOJohnCollection", "FEATURE_FILM"),
            video("GOMattCollection", "FEATURE_FILM"),
        ]))
        XCTAssertEqual(
            pools.map(\.id),
            ["playlist-3-GOJohnCollection|GOLukeCollection|GOMarkCollection|GOMattCollection"]
        )
        XCTAssertEqual(coreIds(pools[0].cards), ["GOJohnCollection", "GOMattCollection"])
    }

    /// Both records are FEATURE_FILM, so they survive the label gate and are
    /// dropped purely for missing art / a missing slug — that isolates the
    /// eligibility gate from the label gate instead of failing both at once.
    func testPoolsDropParentsWithoutArtOrASlug() {
        XCTAssertTrue(HeroQueue.pools(HeroQueue.sourceMap([
            video("2_GOJ-0-0", "FEATURE_FILM", omitImages: true),
            video("1_jf-0-0", "FEATURE_FILM", omitSlug: true),
        ])).isEmpty)

        // The same two records WITH art and a slug do build pools, so the
        // emptiness above is the gate firing and not the fixture being unusable.
        XCTAssertEqual(HeroQueue.pools(HeroQueue.sourceMap([
            video("2_GOJ-0-0", "FEATURE_FILM"),
            video("1_jf-0-0", "FEATURE_FILM"),
        ])).count, 2)
    }

    /// React Native gates eligibility on `Boolean(card.imageUrl && card.slug)`,
    /// where `""` is FALSY. Swift optionals carry no such notion, so every
    /// emptiness check in `isEligible` is a hand-written port of JavaScript
    /// truthiness — and the `omitSlug` fixtures above only ever exercise the NIL
    /// rung, so nothing else in this file notices if the `!slug.isEmpty` half is
    /// dropped. Verified reachable: relaxing it to `card.slug != nil` diverges
    /// from the React Native implementation on 380 of 1,600 differential cases.
    func testAnEmptyStringSlugIsIneligibleBecauseJavaScriptTreatsItAsFalsy() throws {
        let blankSlug = HomeVideoInput(
            documentId: "jf-doc", coreId: "1_jf-0-0", slug: "", label: "FEATURE_FILM",
            durationSeconds: 3600, images: [image("1_jf-0-0")],
            locales: [HomeVideoLocale(title: "JESUS", description: nil, snippet: nil, imageAlt: nil)],
            children: nil
        )
        let card = try XCTUnwrap(HeroQueue.card(sourceId: "1_jf-0-0", video: blankSlug))
        XCTAssertFalse(HeroQueue.isEligible(card))
        XCTAssertTrue(HeroQueue.pools(HeroQueue.sourceMap([blankSlug])).isEmpty)
        XCTAssertNil(card.route, "and it stays route-less rather than pushing an empty slug")

        // Anti-vacuous: the same record with a real slug IS eligible, so the
        // emptiness above is the gate firing, not the fixture being unusable.
        let realSlug = video("1_jf-0-0", "FEATURE_FILM")
        XCTAssertTrue(HeroQueue.isEligible(try XCTUnwrap(
            HeroQueue.card(sourceId: "1_jf-0-0", video: realSlug)
        )))
        XCTAssertEqual(HeroQueue.pools(HeroQueue.sourceMap([realSlug])).count, 1)
    }

    func testSourceMapIsTopLevelOnlySoAChildOnlySourceBuildsNoPool() {
        // CS1 is a playlist source that exists here only as 8_NBC's child.
        let pools = HeroQueue.pools(HeroQueue.sourceMap([
            video("8_NBC", "FEATURE_FILM", children: ["CS1"]),
        ]))
        XCTAssertEqual(pools.map(\.id), ["playlist-2-8_NBC"])
    }

    func testShortFilmsPoolIsAppendedLastInResponseOrder() {
        let pools = HeroQueue.pools(HeroQueue.sourceMap([
            video("sf-b", "SHORT_FILM"),
            video("1_jf-0-0", "FEATURE_FILM"),
            video("sf-a", "SHORT_FILM"),
        ]))
        XCTAssertEqual(pools.map(\.id), ["playlist-0-1_jf-0-0", "shortFilms"])
        // Response order, NOT sorted and NOT dictionary order — a Swift
        // dictionary port would scramble this and pick a different short film
        // than web on the same day.
        XCTAssertEqual(coreIds(pools[1].cards), ["sf-b", "sf-a"])
    }

    func testSourceMapKeepsFirstPositionOnARepeatedCoreId() {
        var map = HeroSourceMap()
        map.set("a", video("a", "SHORT_FILM"))
        map.set("b", video("b", "SHORT_FILM"))
        map.set("a", video("a", "FEATURE_FILM"))
        XCTAssertEqual(map.order, ["a", "b"], "a repeat key overwrites in place, it does not move")
        XCTAssertEqual(map["a"]?.label, "FEATURE_FILM", "and the later value wins")
    }

    /// The other JavaScript-truthiness port: React Native indexes a record only
    /// when `typeof coreId === "string" && coreId.length > 0`. An empty coreId
    /// admitted here would take a slot in the ordered map, and since that map's
    /// iteration order IS the `shortFilms` pool order, it shifts every
    /// day-seeded pick after it. Verified reachable: dropping the emptiness
    /// check diverges from React Native on the differential corpus.
    func testAnEmptyStringCoreIdIsNotIndexedAtAll() {
        let blankCoreId = HomeVideoInput(
            documentId: "blank-doc", coreId: "", slug: "blank-slug", label: "SHORT_FILM",
            durationSeconds: 60, images: [image("blank")], locales: nil, children: nil
        )
        let map = HeroQueue.sourceMap([blankCoreId, video("2_0-Stunned", "SHORT_FILM")])
        XCTAssertEqual(map.order, ["2_0-Stunned"], "the blank coreId takes no slot in the order")
        XCTAssertNil(map[""])
        XCTAssertEqual(map.values.count, 1)
    }

    // MARK: Queue

    func testEmptyPoolsAndNonPositiveTargetsYieldNothing() {
        let now = date("2026-07-13T15:00:00Z")
        XCTAssertTrue(HeroQueue.queue(pools: [], now: now).isEmpty)
        XCTAssertTrue(
            HeroQueue.queue(
                pools: HeroQueue.pools(HeroQueue.sourceMap([video("1_jf-0-0", "FEATURE_FILM")])),
                now: now,
                targetVideoCount: 0
            ).isEmpty
        )
    }

    func testQueueDedupesOnCoreId() {
        // 8_NBC as a SHORT_FILM lands in its sequence pool AND the synthetic
        // shortFilms pool; the same coreId may be emitted at most once.
        let queue = HeroQueue.featured(
            videos: [video("8_NBC", "SHORT_FILM")],
            now: date("2026-07-13T15:00:00Z")
        )
        XCTAssertEqual(coreIds(queue).filter { $0 == "8_NBC" }.count, 1)
    }

    func testQueueIsDeterministicForTheSameDay() {
        // Same DAY, different instants: the rotation is seeded by the ET
        // calendar date, so re-opening Home at teatime must not reshuffle it.
        let morning = HeroQueue.featured(videos: productionShapedVideos, now: date("2026-07-13T13:00:00Z"))
        let evening = HeroQueue.featured(videos: productionShapedVideos, now: date("2026-07-13T23:00:00Z"))
        XCTAssertFalse(morning.isEmpty)
        XCTAssertEqual(coreIds(morning), coreIds(evening))
    }

    /// The goldens are the React Native implementation's REAL output for this
    /// fixture, captured by running `apps/tv/src/lib/watchHome/heroQueue.ts`
    /// itself. Regenerate them the same way on any change to the shared
    /// algorithm or config — never by running the Swift port.
    func testQueueMatchesTheReactNativeGoldenPerBusinessDate() {
        let goldens: [(instant: String, businessDate: String, coreIds: [String])] = [
            (
                instant: "2026-07-13T15:00:00Z",
                businessDate: "2026-07-13",
                coreIds: ["1_jf-0-0", "MAG1", "2_GOJ-0-0", "2_0-Stunned",
                          "2_0-ConsideringChristmas", "2_0-TimeForChange", "2_0-Noelevator"]
            ),
            (
                instant: "2026-07-14T15:00:00Z",
                businessDate: "2026-07-14",
                coreIds: ["1_jf-0-0", "MAG1", "2_GOJ-0-0", "2_0-Noelevator",
                          "2_0-SupremeChristmas", "2_0-ConsideringChristmas", "2_0-TimeForChange"]
            ),
            // 04:30 UTC in January is the PREVIOUS ET day — this row fails if
            // the business date is taken from UTC or from the device clock.
            (
                instant: "2026-01-15T04:30:00Z",
                businessDate: "2026-01-14",
                coreIds: ["1_jf-0-0", "MAG1", "2_GOJ-0-0", "2_0-TimeForChange",
                          "2_0-Stunned", "2_0-Noelevator", "2_0-ConsideringChristmas"]
            ),
            // DST-transition day, before the 07:00 UTC switch: still EST, so
            // 04:30 UTC is March 7 in ET. A rule that flipped to EDT at
            // midnight would serve March 8's hero here.
            (
                instant: "2026-03-08T04:30:00Z",
                businessDate: "2026-03-07",
                coreIds: ["1_jf-0-0", "MAG1", "2_GOJ-0-0", "2_0-ConsideringChristmas",
                          "2_0-Stunned", "2_0-SupremeChristmas", "2_0-Noelevator"]
            ),
        ]

        for golden in goldens {
            let now = date(golden.instant)
            XCTAssertEqual(HeroQueue.businessDate(now), golden.businessDate, "at \(golden.instant)")
            XCTAssertEqual(
                coreIds(HeroQueue.featured(videos: productionShapedVideos, now: now)),
                golden.coreIds,
                "at \(golden.instant)"
            )
        }
    }

    func testQueueRotatesAcrossDays() {
        let days = ["2026-07-13T15:00:00Z", "2026-07-14T15:00:00Z", "2026-01-15T04:30:00Z"]
        let picked = days.map { coreIds(HeroQueue.featured(videos: productionShapedVideos, now: date($0))) }
        XCTAssertEqual(Set(picked).count, days.count, "each business date must produce its own order")
    }

    func testQueueFillsToTheTargetAndPreservesPoolOrder() {
        let queue = HeroQueue.featured(videos: productionShapedVideos, now: date("2026-07-13T15:00:00Z"))
        XCTAssertEqual(queue.count, WatchHomeConfig.heroQueueTarget)
        // First pass takes one card from each of the four pools in order; the
        // remaining three come from the only pool with cards left.
        XCTAssertEqual(
            queue.prefix(3).compactMap(\.rawLabel),
            ["FEATURE_FILM", "FEATURE_FILM", "FEATURE_FILM"]
        )
        XCTAssertEqual(Set(queue.suffix(4).compactMap(\.rawLabel)), Set(["SHORT_FILM"]))
    }

    /// Every record here is a COLLECTION or SERIES container, so the label gate
    /// empties the queue and `featured` must fall through to the curated hero
    /// source ids — in CONFIG order, ungated, and skipping ids that did not come
    /// back (CS1 is present in the response but is not a hero source).
    ///
    /// Golden captured from React Native's `buildWatchHomeModelFromVideos`.
    func testAnEmptyQueueFallsBackToTheCuratedHeroSources() {
        let featured = HeroQueue.featured(
            videos: [
                video("LUMOCollection", "COLLECTION"),
                video("GOMattCollection", "SERIES"),
                video("2_GOJ-0-0", "COLLECTION"),
                video("1_jf-0-0", "COLLECTION"),
                video("CS1", "COLLECTION"),
            ],
            now: date("2026-07-13T15:00:00Z")
        )
        XCTAssertEqual(
            coreIds(featured),
            ["1_jf-0-0", "2_GOJ-0-0", "GOMattCollection", "LUMOCollection"]
        )
        // The fallback is ungated, so these containers DO reach the hero — and
        // they must route to the series screen, not to a watch screen with a
        // disabled Play button (Finding 4).
        XCTAssertEqual(featured.first?.route, .series(slug: "1_jf-0-0-slug"))
    }

    func testFallbackYieldsNothingWhenEvenTheHeroSourcesAreAbsent() {
        XCTAssertTrue(HeroQueue.featured(videos: [], now: date("2026-07-13T15:00:00Z")).isEmpty)
    }

    func testQueueStopsWhenThePoolsRunOutRatherThanSpinning() {
        let queue = HeroQueue.featured(
            videos: [video("1_jf-0-0", "FEATURE_FILM"), video("MAG1", "FEATURE_FILM")],
            now: date("2026-07-13T15:00:00Z")
        )
        XCTAssertEqual(coreIds(queue), ["1_jf-0-0", "MAG1"])
    }

    // MARK: Card projection

    func testCardCarriesTheDisplayLabelAndTheRawWireLabel() throws {
        let card = try XCTUnwrap(
            HeroQueue.card(sourceId: "1_jf-0-0", video: video("1_jf-0-0", "FEATURE_FILM"))
        )
        XCTAssertEqual(card.label, "Feature film")
        XCTAssertEqual(card.rawLabel, "FEATURE_FILM")
        XCTAssertEqual(card.title, "Title 1_jf-0-0")
        XCTAssertEqual(card.description, "Snippet 1_jf-0-0")
        XCTAssertEqual(card.imageURL, URL(string: "https://img.example/1_jf-0-0-high.jpg"))
        XCTAssertEqual(card.imageAlt, "Alt 1_jf-0-0")
    }

    /// `locale?.title ?? slug ?? coreId` — three rungs, and every other fixture
    /// in this file carries a localized title, so the middle rung is invisible
    /// to them. It is not a hypothetical branch: React Native emits a
    /// `missingData` diagnostic for exactly this case ("Admin returned X without
    /// a localized title"), and `imageAlt` inherits whatever the fallback
    /// resolves to. Verified reachable: collapsing the chain to
    /// `locale?.title ?? coreId` diverges from React Native on 736 titles and
    /// 692 imageAlts across the differential corpus.
    func testTitleFallsBackToTheSlugBeforeTheCoreId() throws {
        let untitled = HomeVideoInput(
            documentId: "d1", coreId: "core-x", slug: "slug-x", label: "FEATURE_FILM",
            durationSeconds: 60, images: [image("x")], locales: nil, children: nil
        )
        let fromSlug = try XCTUnwrap(HeroQueue.card(sourceId: "core-x", video: untitled))
        XCTAssertEqual(fromSlug.title, "slug-x")
        XCTAssertEqual(fromSlug.imageAlt, "slug-x", "imageAlt inherits the resolved title")

        let slugless = HomeVideoInput(
            documentId: "d2", coreId: "core-y", slug: nil, label: "FEATURE_FILM",
            durationSeconds: 60, images: [image("y")], locales: nil, children: nil
        )
        let fromCoreId = try XCTUnwrap(HeroQueue.card(sourceId: "core-y", video: slugless))
        XCTAssertEqual(fromCoreId.title, "core-y", "the coreId is the last rung, not the second")

        // Anti-vacuous: a localized title still outranks both, so the chain is
        // ordered rather than merely reachable.
        let titled = try XCTUnwrap(HeroQueue.card(sourceId: "core-z", video: video("core-z", "FEATURE_FILM")))
        XCTAssertEqual(titled.title, "Title core-z")
    }

    func testUnknownLabelsFallBackToVideo() throws {
        let card = try XCTUnwrap(
            HeroQueue.card(sourceId: "x", video: video("x", "SOMETHING_NEW"))
        )
        XCTAssertEqual(card.label, "Video")
        XCTAssertEqual(card.rawLabel, "SOMETHING_NEW", "the raw enum still reaches routing")
    }

    func testCardImagePrecedenceIsFieldMajorAndRanksTheBareUrlLast() {
        // The bare `url` is Cloudflare Images' variant-less delivery base and
        // 400s, so a sibling image's real transform must outrank it — a
        // per-image scan would return this record's `url` instead.
        let urlOnly = HomeVideoImage(
            url: "https://img.example/base.jpg", thumbnail: nil,
            mobileCinematicHigh: nil, mobileCinematicLow: nil, videoStill: nil
        )
        let cinematic = HomeVideoImage(
            url: nil, thumbnail: nil, mobileCinematicHigh: nil,
            mobileCinematicLow: nil, videoStill: "https://img.example/still.jpg"
        )
        XCTAssertEqual(
            HeroQueue.pickCardImage([urlOnly, cinematic]),
            "https://img.example/still.jpg"
        )
        XCTAssertEqual(HeroQueue.pickCardImage([urlOnly]), "https://img.example/base.jpg")
        XCTAssertNil(HeroQueue.pickCardImage([]))
        XCTAssertNil(HeroQueue.pickCardImage(nil))
    }

    func testChildRelationSelfReferencesAndDuplicatesAreDroppedBeforeCounting() {
        let parent = HomeVideoInput(
            documentId: "p-doc", coreId: "p", slug: "p-slug", label: "FEATURE_FILM",
            durationSeconds: 3600, images: [image("p")], locales: nil,
            children: [
                HomeVideoChildRelation(child: video("c1", "SEGMENT")),
                HomeVideoChildRelation(child: video("c1", "SEGMENT")),
                HomeVideoChildRelation(child: nil),
                HomeVideoChildRelation(
                    child: HomeVideoInput(
                        documentId: "p-doc", coreId: "p", slug: "p-slug", label: "FEATURE_FILM",
                        durationSeconds: nil, images: nil, locales: nil, children: nil
                    )
                ),
            ]
        )
        XCTAssertEqual(HeroQueue.resolvedChildren(parent).count, 1)
    }

    /// The noun is label-aware exactly as routing is: a feature film's children
    /// are chapters, a series' are episodes.
    ///
    /// SYNTHETIC ON THE SERIES SIDE: `HeroQueue.pools` drops every SERIES and
    /// COLLECTION record, so no series card can reach the hero today and the
    /// "episodes" branch is unreachable through `featured(videos:now:)`. It is
    /// asserted here because `metaLabel` is a shared helper and the branch is
    /// live the moment a series rail reuses it (plan R7).
    func testMetaLabelPrefersChildCountThenDurationThenLabel() {
        XCTAssertEqual(
            HeroQueue.metaLabel(label: "Feature film", rawLabel: "FEATURE_FILM",
                                durationSeconds: 3600, childCount: 61),
            "61 chapters"
        )
        XCTAssertEqual(
            HeroQueue.metaLabel(label: "Series", rawLabel: "SERIES",
                                durationSeconds: nil, childCount: 7),
            "7 episodes"
        )
        XCTAssertEqual(
            HeroQueue.metaLabel(label: "Series", rawLabel: "SERIES",
                                durationSeconds: nil, childCount: 1),
            "1 episode"
        )
        XCTAssertEqual(
            HeroQueue.metaLabel(label: "Short film", rawLabel: "SHORT_FILM",
                                durationSeconds: 184, childCount: 0),
            "3:04"
        )
        XCTAssertEqual(
            HeroQueue.metaLabel(label: "Feature film", rawLabel: "FEATURE_FILM",
                                durationSeconds: 14805, childCount: 0),
            "4:06:45"
        )
        XCTAssertEqual(
            HeroQueue.metaLabel(label: "Segment", rawLabel: "SEGMENT",
                                durationSeconds: nil, childCount: 0),
            "Segment"
        )
        XCTAssertEqual(
            HeroQueue.metaLabel(label: "Segment", rawLabel: "SEGMENT",
                                durationSeconds: -1, childCount: 0),
            "Segment",
            "a negative duration formats to nothing and must not render as a chip"
        )
    }

    /// Finding 4: a COLLECTION record's playable media lives on its children, so
    /// routing one to the watch screen is a dead end with a disabled Play
    /// button. Routing must read the RAW wire enum — the display text
    /// ("Collection") fails the uppercase predicate silently.
    func testRoutingReadsTheRawLabelNotTheDisplayText() throws {
        let series = try XCTUnwrap(HeroQueue.card(sourceId: "s", video: video("s", "SERIES")))
        XCTAssertEqual(series.route, .series(slug: "s-slug"))
        XCTAssertEqual(series.label, "Series", "the display text is NOT what routing matched on")

        let collection = try XCTUnwrap(HeroQueue.card(sourceId: "c", video: video("c", "COLLECTION")))
        XCTAssertEqual(collection.route, .series(slug: "c-slug"))

        let film = try XCTUnwrap(HeroQueue.card(sourceId: "f", video: video("f", "FEATURE_FILM")))
        XCTAssertEqual(film.route, .video(slug: "f-slug"))

        // Lowercase must NOT match: admin's wire enum is uppercase, and case
        // folding here would let a lowercase fixture pass falsely.
        let lowercase = try XCTUnwrap(HeroQueue.card(sourceId: "l", video: video("l", "series")))
        XCTAssertEqual(lowercase.route, .video(slug: "l-slug"))

        let slugless = try XCTUnwrap(
            HeroQueue.card(sourceId: "n", video: video("n", "FEATURE_FILM", omitSlug: true))
        )
        XCTAssertNil(slugless.route, "a slugless card stays focusable but inert")
    }

    func testQueryKeepsTheBulkFetchCardLean() {
        // Adding `dubs` here is the ~9.5MB / ~13s payload incident: JESUS alone
        // returns over 2,000 of them.
        XCTAssertFalse(HomeVideoQueries.watchHomeVideos.contains("dubs"))
        XCTAssertFalse(HomeVideoQueries.watchHomeVideos.contains("variants"))
        XCTAssertTrue(HomeVideoQueries.watchHomeVideos.contains("watchHomeVideos(coreIds: $coreIds)"))
    }

    func testDecodesTheProductionWireShape() throws {
        // Field names and the `documentId: id` alias as admin answers them.
        let json = """
        {"watchHomeVideos":[{
          "documentId":"cmp76xcw602imny01vnsbwwy9","coreId":"1_jf-0-0","slug":"jesus",
          "label":"FEATURE_FILM","durationSeconds":14805,
          "images":[{"url":"https://imagedelivery.net/x/1_jf-0-0.videoStill.jpg","thumbnail":null,
                     "mobileCinematicHigh":null,"mobileCinematicLow":null,
                     "videoStill":"https://imagedelivery.net/x/still.jpg"}],
          "locales":[{"title":"JESUS","description":"A film.","snippet":"A snippet.","imageAlt":"JESUS"}],
          "children":[{"child":{"documentId":"c-doc","coreId":"1_jf6101-0-0","slug":"the-beginning",
                                "label":"SEGMENT","durationSeconds":300,"images":[],"locales":[]}}]
        }]}
        """
        let data = try JSONDecoder().decode(WatchHomeVideosData.self, from: Data(json.utf8))
        let videos = try XCTUnwrap(data.watchHomeVideos)
        let card = try XCTUnwrap(HeroQueue.card(sourceId: "1_jf-0-0", video: videos[0]))
        XCTAssertEqual(card.id, "cmp76xcw602imny01vnsbwwy9")
        XCTAssertEqual(card.title, "JESUS")
        XCTAssertEqual(card.metaLabel, "1 chapter")
        XCTAssertEqual(card.imageURLString, "https://imagedelivery.net/x/still.jpg")
        XCTAssertEqual(card.route, .video(slug: "jesus"))
    }
}

// MARK: - Continue Watching

final class ContinueWatchingTests: XCTestCase {
    private let seed = ContinueWatchingSeed(
        videoId: "video-1",
        slug: "stunned",
        title: "Stunned",
        imageURL: "https://img.example/stunned.jpg",
        updatedAt: "2026-08-12T00:00:00.000Z"
    )

    private func snapshot(_ position: Double, _ duration: Double?) -> ResumeSnapshot {
        ResumeSnapshot(positionSeconds: position, durationSeconds: duration)
    }

    private func entry(_ videoId: String, positionSeconds: Int = 45) -> ContinueWatchingEntry {
        ContinueWatchingEntry(
            videoId: videoId, slug: "slug-\(videoId)", title: "Title \(videoId)",
            imageURL: "https://img.example/\(videoId).jpg", positionSeconds: positionSeconds,
            durationSeconds: 300, progress: 0.15, updatedAt: "2026-08-12T00:00:00.000Z"
        )
    }

    // MARK: Thresholds, each at its boundary

    func testThresholdsAreTheContractedNumbers() {
        XCTAssertEqual(ContinueWatching.maxEntries, 10)
        XCTAssertEqual(ContinueWatching.resumeMinSeconds, 30)
        XCTAssertEqual(ContinueWatching.resumeMinProgress, 0.25)
        XCTAssertEqual(ContinueWatching.resumeFinishedProgress, 0.95)
    }

    /// 29s vs 30s. The duration is an hour so the progress rung cannot carry
    /// either case — this isolates the seconds floor.
    func testSecondsFloorIsInclusiveAtThirty() {
        XCTAssertFalse(ContinueWatching.isResumeWorthy(snapshot(29, 3600)))
        XCTAssertTrue(ContinueWatching.isResumeWorthy(snapshot(30, 3600)))
    }

    /// 0.24 vs 0.25. Both positions sit under 30s so the seconds rung cannot
    /// carry either case — this isolates the progress floor, which is the rung
    /// that makes short films shelvable at all.
    func testProgressFloorIsInclusiveAtOneQuarter() {
        XCTAssertFalse(ContinueWatching.isResumeWorthy(snapshot(24, 100)))
        XCTAssertTrue(ContinueWatching.isResumeWorthy(snapshot(25, 100)))
    }

    /// 0.94 vs 0.95. Finished wins over resume-worthy: at 95% the entry must
    /// leave the shelf even though 95s is well past the seconds floor.
    func testFinishedFloorIsInclusiveAtNinetyFivePercent() {
        XCTAssertFalse(ContinueWatching.isFinished(snapshot(94, 100)))
        XCTAssertTrue(ContinueWatching.isResumeWorthy(snapshot(94, 100)))

        XCTAssertTrue(ContinueWatching.isFinished(snapshot(95, 100)))
        XCTAssertFalse(ContinueWatching.isResumeWorthy(snapshot(95, 100)))
    }

    func testUnknownOrDegenerateDurationsFallBackToTheSecondsRule() {
        XCTAssertTrue(ContinueWatching.isResumeWorthy(snapshot(31, nil)))
        XCTAssertFalse(ContinueWatching.isResumeWorthy(snapshot(29, nil)))
        // A live stream reports 0 or NaN; neither may divide, and neither may
        // ever read as finished.
        XCTAssertFalse(ContinueWatching.isFinished(snapshot(9999, 0)))
        XCTAssertFalse(ContinueWatching.isFinished(snapshot(9999, .nan)))
        XCTAssertTrue(ContinueWatching.isResumeWorthy(snapshot(9999, .nan)))
    }

    func testNonPositiveOrNonFinitePositionsAreNeverWorthy() {
        XCTAssertFalse(ContinueWatching.isResumeWorthy(snapshot(0, 3600)))
        XCTAssertFalse(ContinueWatching.isResumeWorthy(snapshot(-10, 3600)))
        XCTAssertFalse(ContinueWatching.isResumeWorthy(snapshot(.infinity, 3600)))
        XCTAssertFalse(ContinueWatching.isResumeWorthy(snapshot(.nan, 3600)))
    }

    // MARK: apply

    func testCapEvictsTheOldestEntry() {
        var entries: [ContinueWatchingEntry] = []
        for index in 0 ..< (ContinueWatching.maxEntries + 2) {
            entries = ContinueWatching.apply(
                entries: entries,
                seed: ContinueWatchingSeed(
                    videoId: "video-\(index)", slug: "slug-\(index)", title: nil,
                    imageURL: nil, updatedAt: "2026-08-12T00:00:00.000Z"
                ),
                snapshot: snapshot(60, 600)
            )
        }
        XCTAssertEqual(entries.count, ContinueWatching.maxEntries)
        XCTAssertEqual(entries.first?.videoId, "video-11", "newest first")
        XCTAssertEqual(entries.last?.videoId, "video-2", "the two oldest were evicted")
        XCTAssertFalse(entries.contains { $0.videoId == "video-0" || $0.videoId == "video-1" })
    }

    func testUpsertMovesAnExistingEntryToTheFront() {
        let entries = ContinueWatching.apply(
            entries: [entry("a"), entry("b")],
            seed: ContinueWatchingSeed(videoId: "b", slug: "slug-b", title: nil,
                                       imageURL: nil, updatedAt: "2026-08-12T00:00:00.000Z"),
            snapshot: snapshot(120, 300)
        )
        XCTAssertEqual(entries.map(\.videoId), ["b", "a"])
        XCTAssertEqual(entries.first?.positionSeconds, 120)
    }

    /// Backing out at 4 seconds must not erase yesterday's 40-minute position.
    /// The no-op branch returns the list UNTOUCHED, not the others-only list.
    func testASubThresholdSnapshotLeavesTheExistingEntryIntact() {
        let entries = ContinueWatching.apply(
            entries: [entry("a", positionSeconds: 2400)],
            seed: ContinueWatchingSeed(videoId: "a", slug: "slug-a", title: nil,
                                       imageURL: nil, updatedAt: "2026-08-12T00:00:00.000Z"),
            snapshot: snapshot(4, 3600)
        )
        XCTAssertEqual(entries.map(\.videoId), ["a"])
        XCTAssertEqual(entries.first?.positionSeconds, 2400)
    }

    func testFinishingAVideoRemovesItsEntry() {
        let entries = ContinueWatching.apply(
            entries: [entry("a"), entry("b")],
            seed: ContinueWatchingSeed(videoId: "a", slug: "slug-a", title: nil,
                                       imageURL: nil, updatedAt: "2026-08-12T00:00:00.000Z"),
            snapshot: snapshot(299, 300)
        )
        XCTAssertEqual(entries.map(\.videoId), ["b"])
    }

    func testStoredSecondsAreFlooredWhileProgressKeepsTheRawRatio() throws {
        let entries = ContinueWatching.apply(
            entries: [], seed: seed, snapshot: snapshot(45.9, 299.7)
        )
        let stored = try XCTUnwrap(entries.first)
        XCTAssertEqual(stored.positionSeconds, 45)
        XCTAssertEqual(stored.durationSeconds, 299)
        let progress = try XCTUnwrap(stored.progress)
        XCTAssertEqual(progress, 45.9 / 299.7, accuracy: 1e-9)
        XCTAssertEqual(stored.title, "Stunned")
        XCTAssertEqual(stored.imageURL, "https://img.example/stunned.jpg")
    }

    func testAnUnrepresentablePositionIsANoOpRatherThanACrash() {
        let entries = ContinueWatching.apply(
            entries: [entry("video-1", positionSeconds: 900)],
            seed: seed,
            snapshot: snapshot(1e30, nil)
        )
        XCTAssertEqual(entries.first?.positionSeconds, 900)
    }

    // MARK: parse / serialize

    func testParseDropsMalformedPayloadsAndEntriesIndividually() throws {
        XCTAssertTrue(ContinueWatching.parse(nil).isEmpty)
        XCTAssertTrue(ContinueWatching.parse("{bad").isEmpty)
        XCTAssertTrue(ContinueWatching.parse("{\"not\":\"an array\"}").isEmpty)

        let raw = """
        [{"videoId":"a","slug":"slug-a","title":null,"imageUrl":null,"positionSeconds":45,
          "durationSeconds":300,"progress":0.15,"updatedAt":"2026-08-12T00:00:00.000Z"},
         {"videoId":1},
         "junk"]
        """
        let parsed = ContinueWatching.parse(raw)
        XCTAssertEqual(parsed.map(\.videoId), ["a"])
    }

    func testParseCapsAStoredOverflowAtTheShelfLimit() throws {
        let overflow = (0 ..< 20).map { entry("video-\($0)") }
        let raw = try XCTUnwrap(ContinueWatching.serialize(overflow))
        XCTAssertEqual(ContinueWatching.parse(raw).count, ContinueWatching.maxEntries)
    }

    func testRoundTripsThroughTheReactNativeJsonKeys() throws {
        let raw = try XCTUnwrap(ContinueWatching.serialize([entry("a")]))
        XCTAssertTrue(raw.contains("\"imageUrl\""), "the wire key is RN's, not Swift's imageURL")
        XCTAssertEqual(ContinueWatching.parse(raw), [entry("a")])
    }

    // MARK: Rail projection

    func testRailIsNilWhenEmptySoNoFocusHoleIsRendered() {
        XCTAssertNil(ContinueWatching.rail([]))
    }

    func testRailProjectsNewestFirstAndRoutesBySlug() throws {
        let rail = try XCTUnwrap(ContinueWatching.rail([entry("a"), entry("b")]))
        XCTAssertEqual(rail.id, "continue-watching")
        XCTAssertEqual(rail.items.map(\.id), ["a", "b"])
        XCTAssertEqual(rail.items.first?.slug, "slug-a")
        XCTAssertEqual(rail.items.first?.title, "Title a")
        XCTAssertNil(rail.items.first?.playbackID, "the shelf routes to watch, it does not stream")
    }

    func testACardWithoutATitleFallsBackToItsSlug() {
        let untitled = ContinueWatchingEntry(
            videoId: "a", slug: "slug-a", title: nil, imageURL: nil,
            positionSeconds: 45, durationSeconds: 300, progress: 0.15,
            updatedAt: "2026-08-12T00:00:00.000Z"
        )
        XCTAssertEqual(untitled.card.title, "slug-a")
    }

    // MARK: Store

    private func makeStore() throws -> (ContinueWatchingStore, UserDefaults, String) {
        let suite = "org.jesusfilm.forgetv.native.tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        return (ContinueWatchingStore(defaults: defaults), defaults, suite)
    }

    func testStoreSavesLoadsAndExposesTheResumePosition() async throws {
        let (store, defaults, suite) = try makeStore()
        defer { defaults.removePersistentDomain(forName: suite) }

        await store.record(
            videoId: "video-1", slug: "stunned", title: "Stunned",
            imageURL: "https://img.example/stunned.jpg",
            snapshot: snapshot(62.4, 600), now: date("2026-08-12T10:00:00Z")
        )

        let entries = await store.entries()
        XCTAssertEqual(entries.map(\.slug), ["stunned"])
        let resume = await store.resumePosition(videoId: "video-1")
        XCTAssertEqual(resume, 62)
        let missing = await store.resumePosition(videoId: "nope")
        XCTAssertNil(missing)
    }

    func testStoreClearsItsKeyWhenTheLastEntryFinishes() async throws {
        let (store, defaults, suite) = try makeStore()
        defer { defaults.removePersistentDomain(forName: suite) }

        let now = date("2026-08-12T10:00:00Z")
        await store.record(videoId: "video-1", slug: "stunned", title: nil, imageURL: nil,
                           snapshot: snapshot(60, 600), now: now)
        await store.record(videoId: "video-1", slug: "stunned", title: nil, imageURL: nil,
                           snapshot: snapshot(598, 600), now: now)

        let entries = await store.entries()
        XCTAssertTrue(entries.isEmpty)
        XCTAssertNil(defaults.string(forKey: ContinueWatching.storageKey),
                     "an emptied shelf removes its key rather than storing []")
    }

    func testStoreStampsAnIsoTimestampFromTheInjectedClock() async throws {
        let (store, defaults, suite) = try makeStore()
        defer { defaults.removePersistentDomain(forName: suite) }

        await store.record(videoId: "video-1", slug: "stunned", title: nil, imageURL: nil,
                           snapshot: snapshot(60, 600), now: date("2026-08-12T10:00:00Z"))
        let entries = await store.entries()
        XCTAssertEqual(entries.first?.updatedAt, "2026-08-12T10:00:00.000Z")
    }

    func testRemoveAllWipesTheShelf() async throws {
        let (store, defaults, suite) = try makeStore()
        defer { defaults.removePersistentDomain(forName: suite) }

        await store.record(videoId: "video-1", slug: "stunned", title: nil, imageURL: nil,
                           snapshot: snapshot(60, 600), now: date("2026-08-12T10:00:00Z"))
        await store.removeAll()
        let entries = await store.entries()
        XCTAssertTrue(entries.isEmpty)
    }

    func testStoreStartsEmptyRatherThanInheritingAnotherSuite() async throws {
        let (store, defaults, suite) = try makeStore()
        defer { defaults.removePersistentDomain(forName: suite) }
        let entries = await store.entries()
        XCTAssertTrue(entries.isEmpty)
    }
}
