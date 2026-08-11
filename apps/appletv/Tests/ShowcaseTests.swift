import XCTest
@testable import JesusFilmTV

// Showcase Mode runs UNATTENDED for hours. Nobody is watching it to notice a
// reel that wedges on one poster, loops the same chapter forever, or shows a
// stat card on the fallback path. These tests are the only place that
// behavior is observed, so each case pins a rule the reel would otherwise
// break silently in an office.

// MARK: - Fixtures

private func makeExcerpt(_ id: String, poster: String? = nil) -> ShowcaseExcerpt {
    ShowcaseExcerpt(
        id: id,
        slug: id,
        title: id.capitalized,
        posterURL: poster.flatMap(URL.init(string:))
    )
}

private func makeChapter(
    _ id: String,
    excerpts: Int,
    isLanguageChapter: Bool = false
) -> ShowcaseChapter {
    ShowcaseChapter(
        id: id,
        title: id.capitalized,
        subtitle: nil,
        excerpts: (0 ..< excerpts).map { makeExcerpt("\(id)-\($0)") },
        isLanguageChapter: isLanguageChapter
    )
}

private func makeQueue(
    chapters: Int,
    excerptsEach: Int,
    kind: ShowcaseQueueKind = .curated,
    statLines: [String] = ["Nearly 1,000 films"]
) -> ShowcaseQueue {
    ShowcaseQueue(
        kind: kind,
        chapters: (0 ..< chapters).map { makeChapter("chapter\($0)", excerpts: excerptsEach) },
        statLines: statLines
    )
}

/// Unplayability is its OWN knob rather than a nil `playbackID` argument,
/// because nil is indistinguishable from an omitted argument on a
/// derive-by-default parameter — the helper would quietly hand back a PLAYABLE
/// dub and the test would be asserting about a fixture it did not build.
/// (Caught by running these tests: four assertions failed on a helper that
/// looked correct.)
private func makeDub(
    _ slug: String,
    bcp47: String,
    duration: Int? = 200,
    playable: Bool = true
) -> Dub {
    Dub(
        id: "dub-\(slug)",
        languageSlug: slug,
        bcp47: bcp47,
        displayName: slug.capitalized,
        // The `hls` field stays populated even when unplayable: the reel gates
        // on the PLAYBACK ID (it builds the Mux URL), so a fixture that
        // stripped both would not isolate which gate is under test.
        hls: "https://stream.mux.com/\(slug).m3u8",
        playbackID: playable ? "pb\(slug.replacingOccurrences(of: "-", with: ""))" : nil,
        durationSeconds: duration
    )
}

/// Counts calls made from the injected source closures. A plain class rather
/// than a captured `var`: the closures escape into the view model.
private final class AttemptCounter {
    var value = 0
}

/// Drive the reel from cold to the first excerpt playing.
private func started(_ queue: ShowcaseQueue) -> ShowcaseReelState {
    var state = ShowcaseReel.reduce(.initial, .resolved(queue))
    if state.phase == .chapterCard {
        state = ShowcaseReel.reduce(state, .cardTimerElapsed)
    }
    return state
}

// MARK: - Projection

final class ShowcaseProjectionTests: XCTestCase {
    /// Shaped like the live `tv-showcase` response (verified against
    /// production 2026-08-12): felt-need chapters with three items, a
    /// `showcase-languages` chapter with one, and the reserved stats block
    /// whose lines ride its description.
    private let json = """
    {"experienceBySlug":{
      "id":"exp","slug":"tv-showcase","title":"TV Showcase",
      "blocks":[
        {"__typename":"MediaCollectionBlock","sectionKey":"showcase-01-fear-power",
         "mcTitle":"Fear & Power","mcSubtitle":null,"mcDescription":null,"categoryLabel":null,
         "items":[
           {"titleOverride":null,"subtitleOverride":null,"imageAsset":null,
            "videoImage":{"previewUrl":"https://img/one.jpg"},
            "videoDub":{"muxVideo":{"playbackId":"pbOne"}},
            "videoId":"v1","videoSlug":"82-how-much-am-i-worth"},
           {"titleOverride":null,"subtitleOverride":null,"imageAsset":null,
            "videoImage":{"previewUrl":"https://img/two.jpg"},
            "videoDub":{"muxVideo":{"playbackId":"pbTwo"}},
            "videoId":"v2","videoSlug":"bp-4-divine-council"}
         ]},
        {"__typename":"MediaCollectionBlock","sectionKey":"showcase-lang-01-birth-of-jesus",
         "mcTitle":"Every Language","mcSubtitle":"One story — told in 2,264 languages",
         "mcDescription":null,"categoryLabel":"showcase-languages",
         "items":[
           {"titleOverride":null,"subtitleOverride":null,"imageAsset":null,
            "videoImage":{"previewUrl":"https://img/birth.jpg"},
            "videoDub":{"muxVideo":{"playbackId":"pbBirth"}},
            "videoId":"v3","videoSlug":"birth-of-jesus"}
         ]},
        {"__typename":"MediaCollectionBlock","sectionKey":"showcase-broken",
         "mcTitle":"Broken","mcSubtitle":null,"mcDescription":null,"categoryLabel":null,
         "items":[
           {"titleOverride":"No slug","subtitleOverride":null,"imageAsset":null,
            "videoImage":null,"videoDub":null,"videoId":"v4","videoSlug":null}
         ]},
        {"__typename":"MediaCollectionBlock","sectionKey":"showcase-stats",
         "mcTitle":"showcase-stats","mcSubtitle":null,
         "mcDescription":"Nearly 1,000 films and episodes\\nAudio in 2,300 languages\\n\\nSubtitles in 99 languages",
         "categoryLabel":null,"items":[]}
      ]}}
    """

    private func decoded() throws -> WatchHomeData {
        try JSONDecoder().decode(WatchHomeData.self, from: Data(json.utf8))
    }

    /// The slug is a production contract, not a preference: this Experience is
    /// what the curator edits, and a typo here shows an empty office TV.
    func testExperienceSlugMatchesTheAuthoredExperience() {
        XCTAssertEqual(ShowcaseProjection.experienceSlug, "tv-showcase")
    }

    func testSplitsChaptersStatLinesAndTheLanguageMarker() throws {
        let queue = try XCTUnwrap(ShowcaseProjection.curated(decoded()))
        XCTAssertEqual(queue.kind, .curated)
        XCTAssertEqual(queue.chapters.map(\.id), [
            "showcase-01-fear-power", "showcase-lang-01-birth-of-jesus",
        ])
        XCTAssertEqual(queue.chapters[0].isLanguageChapter, false)
        XCTAssertEqual(queue.chapters[1].isLanguageChapter, true)
        XCTAssertEqual(queue.statLines, [
            "Nearly 1,000 films and episodes",
            "Audio in 2,300 languages",
            "Subtitles in 99 languages",
        ])
    }

    /// The stats block is NOT a chapter. Rendering it as one would put the
    /// literal string "showcase-stats" on screen as a felt-need card.
    func testStatsBlockNeverBecomesAChapter() throws {
        let queue = try XCTUnwrap(ShowcaseProjection.curated(decoded()))
        XCTAssertFalse(queue.chapters.contains { $0.id == "showcase-stats" })
    }

    /// A chapter whose every item lacks a slug cannot play anything, so its
    /// card must never appear over an empty run.
    func testChapterWithNoPlayableItemIsDroppedWhole() throws {
        let queue = try XCTUnwrap(ShowcaseProjection.curated(decoded()))
        XCTAssertFalse(queue.chapters.contains { $0.id == "showcase-broken" })
    }

    func testCuratorMarkersAreMatchedCaseFoldedAndTrimmed() throws {
        let json = """
        {"experienceBySlug":{"blocks":[
          {"__typename":"MediaCollectionBlock","sectionKey":"c1","mcTitle":"Lang",
           "categoryLabel":"  Showcase-Languages  ","items":[
             {"videoId":"v1","videoSlug":"a"}]},
          {"__typename":"MediaCollectionBlock","sectionKey":"c2","mcTitle":" Showcase-Stats ",
           "mcDescription":"One line","items":[]}
        ]}}
        """
        let data = try JSONDecoder().decode(WatchHomeData.self, from: Data(json.utf8))
        let queue = try XCTUnwrap(ShowcaseProjection.curated(data))
        XCTAssertEqual(queue.chapters.count, 1)
        XCTAssertTrue(queue.chapters[0].isLanguageChapter)
        XCTAssertEqual(queue.statLines, ["One line"])
    }

    func testNoChaptersProjectsToNilSoTheCallerCanFallBack() throws {
        let data = try JSONDecoder().decode(
            WatchHomeData.self, from: Data(#"{"experienceBySlug":null}"#.utf8)
        )
        XCTAssertNil(ShowcaseProjection.curated(data))
    }

    /// The fallback reel is one unlabeled chapter and carries NO stat lines —
    /// authored globals describe the curated reel only.
    func testFallbackDedupesByCardAndCarriesNoStats() throws {
        let home = HomeModel(rails: [
            Rail(id: "r1", title: "One", eyebrow: nil, description: nil, items: [
                VideoCard(id: "a", title: "A", posterURL: nil, playbackID: "pbA", slug: "a"),
                VideoCard(id: "b", title: "B", posterURL: nil, playbackID: "pbB", slug: "b"),
            ]),
            Rail(id: "r2", title: "Two", eyebrow: nil, description: nil, items: [
                // Same card in a second rail — one video, one slot in the reel.
                VideoCard(id: "a", title: "A", posterURL: nil, playbackID: "pbA", slug: "a"),
                // No slug: the per-video fetch keys on slug, so it can't play.
                VideoCard(id: "c", title: "C", posterURL: nil, playbackID: "pbC", slug: nil),
            ]),
        ])
        let queue = try XCTUnwrap(ShowcaseProjection.fallback(home))
        XCTAssertEqual(queue.kind, .fallback)
        XCTAssertEqual(queue.chapters.count, 1)
        XCTAssertEqual(queue.chapters[0].excerpts.map(\.slug), ["a", "b"])
        XCTAssertTrue(queue.statLines.isEmpty)
    }
}

// MARK: - Excerpt windows

final class ShowcaseWindowTests: XCTestCase {
    /// An unknown duration must still be BOUNDED. Without the cap, a video
    /// whose `duration` is missing would play in full and the reel would stop
    /// being a reel.
    func testUnknownDurationIsStillCapped() {
        XCTAssertEqual(ShowcaseWindow.resolve(durationSeconds: nil), ExcerptWindow(start: 0, end: 40))
        XCTAssertEqual(ShowcaseWindow.resolve(durationSeconds: 0), ExcerptWindow(start: 0, end: 40))
    }

    func testShortItemStopsClearOfTheCreditsTail() {
        XCTAssertEqual(ShowcaseWindow.resolve(durationSeconds: 30), ExcerptWindow(start: 0, end: 25))
    }

    /// Below ~25s, clearing the tail would drop under the 20s floor — so the
    /// item plays out rather than being cut to a stub.
    func testVeryShortItemPlaysOutRatherThanBecomingAStub() {
        XCTAssertEqual(ShowcaseWindow.resolve(durationSeconds: 22), ExcerptWindow(start: 0, end: 22))
    }

    func testLongFormStartsInsideTheFilmAndStaysInBand() {
        let window = ShowcaseWindow.resolve(durationSeconds: 600)
        XCTAssertEqual(window, ExcerptWindow(start: 90, end: 130))
        XCTAssertGreaterThanOrEqual(window.duration, ShowcaseWindow.minSeconds)
        XCTAssertLessThanOrEqual(window.duration, ShowcaseWindow.maxSeconds)
    }

    func testLongFormNeverReachesIntoTheCreditsTail() {
        let window = ShowcaseWindow.resolve(durationSeconds: 100)
        XCTAssertEqual(window, ExcerptWindow(start: 15, end: 55))
        XCTAssertLessThanOrEqual(window.end, 100 - ShowcaseWindow.creditsTailSeconds)
    }
}

// MARK: - Language policy

final class ShowcaseLanguageTests: XCTestCase {
    private let dubs = [
        makeDub("thai", bcp47: "th"),
        makeDub("english", bcp47: "en"),
        makeDub("korean", bcp47: "ko"),
    ]

    func testViewerPreferenceWinsExactlyOnSlug() {
        XCTAssertEqual(
            ShowcaseLanguage.pick(dubs: dubs, viewerLanguageSlug: "thai", deviceBcp47: "en")?
                .languageSlug,
            "thai"
        )
    }

    /// The collision this rule exists for: `ko-kmr` shares a prefix with `ko`.
    /// A preference matched on the prefix hands the room a language nobody
    /// chose, on a screen with no way to correct it.
    ///
    /// English is in the pool ON PURPOSE, and it is what makes this test able
    /// to fail. With only the two Korean dubs present, exact matching falls
    /// through the default chain to `korean-kmr` and a prefix rule returns
    /// `korean-kmr` too — identical outcomes, so the assertion held no matter
    /// which rule was in force. English gives the default chain (rung 4) a
    /// landing spot that no prefix rule can reach, so the two rules now differ.
    func testPreferenceNeverMatchesOnABcp47Prefix() {
        let colliding = [
            makeDub("korean-kmr", bcp47: "ko-kmr"),
            makeDub("korean", bcp47: "ko"),
            makeDub("english", bcp47: "en"),
        ]
        let picked = ShowcaseLanguage.pick(
            dubs: colliding, viewerLanguageSlug: "ko", deviceBcp47: nil
        )
        // A prefix rule would seize `korean-kmr`; a bcp47 rule, one of the two
        // Korean rows. Neither is a language the viewer asked for.
        XCTAssertNotEqual(picked?.languageSlug, "korean-kmr")
        XCTAssertNotEqual(picked?.languageSlug, "korean")
        // Falls through to the default chain rather than guessing.
        XCTAssertEqual(picked?.languageSlug, "english")
    }

    func testFallsThroughToDeviceThenEnglish() {
        XCTAssertEqual(
            ShowcaseLanguage.pick(dubs: dubs, viewerLanguageSlug: nil, deviceBcp47: "ko-KR")?
                .languageSlug,
            "korean"
        )
        XCTAssertEqual(
            ShowcaseLanguage.pick(dubs: dubs, viewerLanguageSlug: nil, deviceBcp47: "de")?
                .languageSlug,
            "english"
        )
    }

    /// The reel builds a Mux URL from the playback id, so a dub without a
    /// valid one is not playable here whatever its `hls` field says.
    func testDubWithoutAValidPlaybackIdIsNotPlayable() {
        let unplayable = makeDub("thai", bcp47: "th", playable: false)
        XCTAssertTrue(ShowcaseLanguage.playable([unplayable]).isEmpty)
        XCTAssertNil(
            ShowcaseLanguage.pick(dubs: [unplayable], viewerLanguageSlug: nil, deviceBcp47: "en")
        )
    }
}

// MARK: - Hop schedule

final class ShowcaseHopScheduleTests: XCTestCase {
    private let zeroRng: () -> Double = { 0 }

    func testEnglishOpensThePlan() throws {
        let hops = try XCTUnwrap(
            ShowcaseHopSchedule.build(
                dubs: [
                    makeDub("thai", bcp47: "th"),
                    makeDub("english", bcp47: "en"),
                    makeDub("korean", bcp47: "ko"),
                ],
                deviceBcp47: "th",
                rng: zeroRng
            )
        )
        // English wins over the device locale: it is the language most of the
        // room reads, so the switch AWAY from it is what registers.
        XCTAssertEqual(hops.first?.languageSlug, "english")
        XCTAssertEqual(hops.count, 3)
    }

    func testWindowsAreContiguousAndTenSecondsEach() throws {
        let hops = try XCTUnwrap(
            ShowcaseHopSchedule.build(
                dubs: [makeDub("english", bcp47: "en"), makeDub("thai", bcp47: "th")],
                deviceBcp47: nil,
                rng: zeroRng
            )
        )
        XCTAssertEqual(hops[0].window.end, hops[1].window.start, "a gap would be a visible jump")
        XCTAssertEqual(hops[0].window.duration, ShowcaseHopSchedule.segmentSeconds)
    }

    /// Dub durations drift per language in this catalog (German 335s against
    /// Dutch 150s on `how-to-know-jesus-personally`). Every hop seeks the SAME
    /// window into its OWN asset, so a window sized to the opener alone seeks
    /// a shorter sibling past its end and the reel plays silence.
    func testPlansAgainstTheShortestKnownDubDuration() throws {
        let hops = try XCTUnwrap(
            ShowcaseHopSchedule.build(
                dubs: [
                    makeDub("english", bcp47: "en", duration: 300),
                    makeDub("dutch", bcp47: "nl", duration: 100),
                ],
                deviceBcp47: nil,
                rng: zeroRng
            )
        )
        // 15% of 100, not of 300 — sizing on the opener would start at 45.
        XCTAssertEqual(hops[0].window.start, 15)
        XCTAssertLessThanOrEqual(hops.last!.window.end, 100 - ShowcaseWindow.creditsTailSeconds)
    }

    func testUnderTwoPlayableLanguagesHasNoSwitchToShow() {
        XCTAssertNil(
            ShowcaseHopSchedule.build(
                dubs: [makeDub("english", bcp47: "en")], deviceBcp47: nil, rng: zeroRng
            )
        )
        XCTAssertNil(
            ShowcaseHopSchedule.build(
                dubs: [
                    makeDub("english", bcp47: "en"),
                    makeDub("thai", bcp47: "th", playable: false),
                ],
                deviceBcp47: nil,
                rng: zeroRng
            )
        )
    }

    /// One language, two dub rows. Counting rows would hop from a language
    /// into itself — a switch the viewer cannot perceive.
    func testDuplicateLanguageRowsHopOncePerLanguage() throws {
        let hops = try XCTUnwrap(
            ShowcaseHopSchedule.build(
                dubs: [
                    makeDub("english", bcp47: "en"),
                    makeDub("english", bcp47: "en"),
                    makeDub("thai", bcp47: "th"),
                ],
                deviceBcp47: nil,
                rng: zeroRng
            )
        )
        XCTAssertEqual(hops.count, 2)
        XCTAssertEqual(Set(hops.map(\.languageSlug)), ["english", "thai"])
    }

    func testUnknownOpenerDurationIsUnschedulable() {
        XCTAssertNil(
            ShowcaseHopSchedule.build(
                dubs: [
                    makeDub("english", bcp47: "en", duration: nil),
                    makeDub("thai", bcp47: "th", duration: 200),
                ],
                deviceBcp47: nil,
                rng: zeroRng
            )
        )
    }

    func testCapsAtNineLanguages() throws {
        let dubs = (0 ..< 12).map { makeDub("lang\($0)", bcp47: "l\($0)", duration: 2000) }
        let hops = try XCTUnwrap(
            ShowcaseHopSchedule.build(dubs: dubs, deviceBcp47: nil, rng: zeroRng)
        )
        XCTAssertEqual(hops.count, ShowcaseHopSchedule.maxHops)
    }

    /// A remainder below the readable floor is DROPPED, not flashed: a
    /// two-second slice is too short to hear the switch or read the label.
    func testFinalSliceBelowTheReadableFloorIsDropped() throws {
        // 27s → 22s clear of credits → two full 10s segments, 2s remainder.
        let hops = try XCTUnwrap(
            ShowcaseHopSchedule.build(
                dubs: [
                    makeDub("english", bcp47: "en", duration: 27),
                    makeDub("thai", bcp47: "th", duration: 27),
                    makeDub("korean", bcp47: "ko", duration: 27),
                ],
                deviceBcp47: nil,
                rng: zeroRng
            )
        )
        XCTAssertEqual(hops.count, 2, "the 2s remainder must not become a third hop")
        XCTAssertEqual(hops[0].window.start, 0)
    }

    func testSourceTooShortForTwoSegmentsIsUnschedulable() {
        XCTAssertNil(
            ShowcaseHopSchedule.build(
                dubs: [
                    makeDub("english", bcp47: "en", duration: 12),
                    makeDub("thai", bcp47: "th", duration: 12),
                ],
                deviceBcp47: nil,
                rng: zeroRng
            )
        )
    }

    /// The plan must be reproducible from its inputs: an injected rng is the
    /// difference between a testable schedule and one you can only watch.
    func testTheSameRngProducesTheSamePlan() throws {
        let dubs = (0 ..< 6).map { makeDub("lang\($0)", bcp47: "l\($0)", duration: 400) }
        var seedA = 0
        var seedB = 0
        let sequence: [Double] = [0.9, 0.1, 0.5, 0.3, 0.7]
        let first = try XCTUnwrap(
            ShowcaseHopSchedule.build(dubs: dubs, deviceBcp47: nil) {
                defer { seedA += 1 }
                return sequence[seedA % sequence.count]
            }
        )
        let second = try XCTUnwrap(
            ShowcaseHopSchedule.build(dubs: dubs, deviceBcp47: nil) {
                defer { seedB += 1 }
                return sequence[seedB % sequence.count]
            }
        )
        XCTAssertEqual(first, second)
    }
}

// MARK: - Interstitial copy

final class ShowcaseStatsTests: XCTestCase {
    func testAuthoredLinesAreRequiredForAnInterstitial() {
        // One video's dub count is not the catalog's breadth claim. Without
        // authored globals there is nothing honest to put on the card.
        XCTAssertNil(
            ShowcaseStats.interstitial(
                authoredLines: [], liveTitle: "JESUS", liveLanguageCount: 2291
            )
        )
        XCTAssertNil(
            ShowcaseStats.interstitial(
                authoredLines: ["   "], liveTitle: "JESUS", liveLanguageCount: 2291
            )
        )
    }

    func testCapsAuthoredLinesSoTheCardCannotOverflow() throws {
        let content = try XCTUnwrap(
            ShowcaseStats.interstitial(
                authoredLines: ["a", "b", "c", "d", "e", "f"],
                liveTitle: nil,
                liveLanguageCount: nil
            )
        )
        XCTAssertEqual(content.authoredLines, ["a", "b", "c", "d"])
        XCTAssertNil(content.liveLine)
    }

    func testLiveLineGroupsThousandsAndAgreesWithItsNoun() throws {
        let plural = try XCTUnwrap(
            ShowcaseStats.interstitial(
                authoredLines: ["x"], liveTitle: "JESUS", liveLanguageCount: 2291
            )
        )
        XCTAssertEqual(plural.liveLine, "JESUS is available in 2,291 languages")

        let singular = try XCTUnwrap(
            ShowcaseStats.interstitial(
                authoredLines: ["x"], liveTitle: "Short", liveLanguageCount: 1
            )
        )
        XCTAssertEqual(singular.liveLine, "Short is available in 1 language")
    }

    func testLiveLineIsOmittedRatherThanRenderedHalfEmpty() {
        XCTAssertNil(
            ShowcaseStats.interstitial(
                authoredLines: ["x"], liveTitle: nil, liveLanguageCount: 5
            )?.liveLine
        )
        XCTAssertNil(
            ShowcaseStats.interstitial(
                authoredLines: ["x"], liveTitle: "JESUS", liveLanguageCount: 0
            )?.liveLine
        )
    }

    /// Languages, not dub rows: several dubs can carry one language slug, and
    /// counting those twice overstates the catalog to a stranger reading it.
    func testBreadthClaimCountsDistinctLanguages() {
        let dubs = [
            makeDub("english", bcp47: "en"),
            makeDub("english", bcp47: "en"),
            makeDub("thai", bcp47: "th"),
            makeDub("korean", bcp47: "ko", playable: false),
        ]
        XCTAssertEqual(ShowcaseStats.countDistinctLanguages(dubs), 2)
    }

    func testGroupingIsIndependentOfDeviceRegion() {
        XCTAssertEqual(ShowcaseStats.grouped(999), "999")
        XCTAssertEqual(ShowcaseStats.grouped(1000), "1,000")
        XCTAssertEqual(ShowcaseStats.grouped(2291), "2,291")
        XCTAssertEqual(ShowcaseStats.grouped(1234567), "1,234,567")
    }
}

// MARK: - Sequencing

final class ShowcaseReelSequenceTests: XCTestCase {
    func testCuratedReelOpensOnItsChapterCardAndFallbackDoesNot() {
        let curated = ShowcaseReel.reduce(.initial, .resolved(makeQueue(chapters: 2, excerptsEach: 2)))
        XCTAssertEqual(curated.phase, .chapterCard)

        let fallback = ShowcaseReel.reduce(
            .initial,
            .resolved(makeQueue(chapters: 1, excerptsEach: 2, kind: .fallback, statLines: []))
        )
        // The fallback reel carries no felt-need labels; a blank card is worse
        // than no card.
        XCTAssertEqual(fallback.phase, .excerpt)
    }

    func testAdvancesThroughExcerptsThenChapters() {
        var state = started(makeQueue(chapters: 2, excerptsEach: 2))
        XCTAssertEqual(state.excerptIndex, 0)

        state = ShowcaseReel.reduce(state, .excerptEnded)
        XCTAssertEqual(state.excerptIndex, 1)
        XCTAssertEqual(state.chapterIndex, 0)

        state = ShowcaseReel.reduce(state, .excerptEnded)
        XCTAssertEqual(state.chapterIndex, 1)
        XCTAssertEqual(state.excerptIndex, 0)
        XCTAssertEqual(state.phase, .chapterCard, "each chapter announces itself")
    }

    /// The token is the only thing that can tell the player "play that again".
    /// A one-chapter reel loops onto identical indices and the identical
    /// excerpt value, so without the bump the loop would freeze on one item.
    func testEveryTargetChangeBumpsTheToken() {
        var state = started(makeQueue(chapters: 1, excerptsEach: 2))
        let first = state.excerptToken
        state = ShowcaseReel.reduce(state, .excerptEnded)
        XCTAssertGreaterThan(state.excerptToken, first)

        // Wrap back onto the same single chapter, same index 0.
        let beforeWrap = state.excerptToken
        state = ShowcaseReel.reduce(state, .excerptEnded)
        XCTAssertEqual(state.excerptIndex, 0)
        XCTAssertGreaterThan(state.excerptToken, beforeWrap)
    }

    func testLoopsBackToTheFirstChapterAtTheEnd() {
        // No stat lines, so the interstitial never intercepts the boundary.
        var state = started(makeQueue(chapters: 2, excerptsEach: 1, statLines: []))
        state = ShowcaseReel.reduce(state, .excerptEnded) // → chapter 1 card
        state = ShowcaseReel.reduce(state, .cardTimerElapsed)
        state = ShowcaseReel.reduce(state, .excerptEnded) // → loop

        XCTAssertEqual(state.chapterIndex, 0)
        XCTAssertEqual(state.excerptIndex, 0)
        XCTAssertEqual(state.phase, .chapterCard)
    }

    func testChapterWithNoExcerptsIsSkippedWholeSoItsCardNeverShows() {
        let queue = ShowcaseQueue(
            kind: .curated,
            chapters: [
                makeChapter("first", excerpts: 1),
                ShowcaseChapter(id: "empty", title: "Empty", subtitle: nil, excerpts: [], isLanguageChapter: false),
                makeChapter("third", excerpts: 1),
            ],
            statLines: []
        )
        var state = started(queue)
        state = ShowcaseReel.reduce(state, .excerptEnded)
        XCTAssertEqual(ShowcaseReel.currentChapter(state)?.id, "third")
    }

    func testNextExcerptWrapsWithinTheQueue() {
        let state = started(makeQueue(chapters: 2, excerptsEach: 1, statLines: []))
        XCTAssertEqual(ShowcaseReel.nextExcerpt(state)?.id, "chapter1-0")

        var last = ShowcaseReel.reduce(state, .excerptEnded)
        last = ShowcaseReel.reduce(last, .cardTimerElapsed)
        XCTAssertEqual(ShowcaseReel.nextExcerpt(last)?.id, "chapter0-0", "the warm target wraps")
    }

    func testExitIsTerminalAndIdempotent() {
        var state = started(makeQueue(chapters: 2, excerptsEach: 2))
        state = ShowcaseReel.reduce(state, .exit)
        XCTAssertEqual(state.phase, .exited)
        // A remote can deliver one press through more than one path.
        XCTAssertEqual(ShowcaseReel.reduce(state, .exit), state)
        XCTAssertEqual(ShowcaseReel.reduce(state, .excerptEnded), state)
        XCTAssertEqual(ShowcaseReel.reduce(state, .cardTimerElapsed), state)
    }
}

// MARK: - Interstitial cadence

final class ShowcaseInterstitialCadenceTests: XCTestCase {
    /// Walk a curated reel one chapter at a time.
    private func completeChapter(_ state: ShowcaseReelState) -> ShowcaseReelState {
        var next = state
        if next.phase == .chapterCard {
            next = ShowcaseReel.reduce(next, .cardTimerElapsed)
        }
        return ShowcaseReel.reduce(next, .excerptEnded)
    }

    func testInterstitialFiresEveryThirdChapterAndResetsItsCount() {
        var state = started(makeQueue(chapters: 6, excerptsEach: 1))
        state = completeChapter(state) // 1
        XCTAssertNotEqual(state.phase, .interstitial)
        state = completeChapter(state) // 2
        XCTAssertNotEqual(state.phase, .interstitial)
        state = completeChapter(state) // 3
        XCTAssertEqual(state.phase, .interstitial)
        XCTAssertEqual(state.chaptersSinceInterstitial, 0)

        state = ShowcaseReel.reduce(state, .interstitialTimerElapsed)
        XCTAssertEqual(state.phase, .chapterCard)
        XCTAssertEqual(state.chapterIndex, 3)

        state = completeChapter(state) // 4
        XCTAssertNotEqual(state.phase, .interstitial, "the count restarts, not continues")
    }

    /// The interstitial needs authored stats. Without them the reel would put
    /// one video's dub count on screen as the catalog's breadth claim.
    func testNoAuthoredStatsMeansNoInterstitial() {
        var state = started(makeQueue(chapters: 6, excerptsEach: 1, statLines: []))
        for _ in 0 ..< 4 {
            state = completeChapter(state)
            XCTAssertNotEqual(state.phase, .interstitial)
        }
    }

    func testFallbackReelNeverShowsAnInterstitial() {
        // Even with stat lines forced onto it, the fallback path is excluded.
        var state = started(
            ShowcaseQueue(
                kind: .fallback,
                chapters: (0 ..< 6).map { makeChapter("c\($0)", excerpts: 1) },
                statLines: ["breadth"]
            )
        )
        for _ in 0 ..< 4 {
            state = completeChapter(state)
            XCTAssertNotEqual(state.phase, .interstitial)
        }
    }

    /// The cadence survives the loop boundary: a wrap is the same reel
    /// continuing, so restarting the count there would drift the interstitial
    /// off its beat on every short queue.
    func testCadenceSurvivesTheLoopBoundary() {
        var state = started(makeQueue(chapters: 2, excerptsEach: 1))
        state = completeChapter(state) // 1
        state = completeChapter(state) // 2 → wraps to chapter 0
        XCTAssertEqual(state.chapterIndex, 0)
        XCTAssertEqual(state.chaptersSinceInterstitial, 2)
        state = completeChapter(state) // 3
        XCTAssertEqual(state.phase, .interstitial)
    }
}

// MARK: - Failure ladder

final class ShowcaseFailureLadderTests: XCTestCase {
    func testThreeConsecutiveFailuresFallToStills() {
        var state = started(makeQueue(chapters: 1, excerptsEach: 6, statLines: []))
        state = ShowcaseReel.reduce(state, .excerptFailed)
        XCTAssertEqual(state.phase, .excerpt)
        state = ShowcaseReel.reduce(state, .excerptFailed)
        XCTAssertEqual(state.phase, .excerpt)
        state = ShowcaseReel.reduce(state, .excerptFailed)
        XCTAssertEqual(state.phase, .stills)
    }

    /// Completion is the ONLY proof the path works, so it is the only thing
    /// that clears the breaker. A first frame proves nothing — an item can
    /// paint one and then freeze.
    func testOnlyACompletionClearsTheBreaker() {
        var state = started(makeQueue(chapters: 1, excerptsEach: 8, statLines: []))
        state = ShowcaseReel.reduce(state, .excerptFailed)
        state = ShowcaseReel.reduce(state, .excerptFailed)
        state = ShowcaseReel.reduce(state, .excerptEnded)
        XCTAssertEqual(state.consecutiveFailures, 0)
        state = ShowcaseReel.reduce(state, .excerptFailed)
        state = ShowcaseReel.reduce(state, .excerptFailed)
        XCTAssertEqual(state.phase, .excerpt, "the completion reset the count")
    }

    /// A wrap is the SAME queue continuing, so its failures still count.
    /// Zeroing at the boundary lets a short all-dead reel loop forever and
    /// never reach the stills floor.
    func testFailuresSurviveTheLoopBoundary() {
        var state = started(makeQueue(chapters: 1, excerptsEach: 2, statLines: []))
        state = ShowcaseReel.reduce(state, .excerptFailed)
        state = ShowcaseReel.reduce(state, .excerptFailed) // wraps
        XCTAssertEqual(state.consecutiveFailures, 2)
        state = ShowcaseReel.reduce(state, .excerptFailed)
        XCTAssertEqual(state.phase, .stills)
    }

    /// The chapter card IS the resolve window for the excerpt behind it, so an
    /// item can fail BEFORE its own phase begins. Dropping that event wedged
    /// the reel on the card with nothing left to re-arm it.
    func testAnItemCanFailWhileItsChapterCardIsStillShowing() {
        let state = ShowcaseReel.reduce(.initial, .resolved(makeQueue(chapters: 2, excerptsEach: 3)))
        XCTAssertEqual(state.phase, .chapterCard)

        let next = ShowcaseReel.reduce(state, .excerptFailed)
        XCTAssertEqual(next.excerptIndex, 1, "it skipped to the next item")
        XCTAssertEqual(next.phase, .chapterCard, "…behind a card that still owns its full dwell")
        XCTAssertEqual(next.consecutiveFailures, 1)
    }

    func testStillsRejoinsTheReelWhenResolutionSucceedsAgain() {
        var state = ShowcaseReel.reduce(.initial, .resolveFailed)
        XCTAssertEqual(state.phase, .stills)
        state = ShowcaseReel.reduce(state, .resolved(makeQueue(chapters: 2, excerptsEach: 1)))
        XCTAssertEqual(state.phase, .chapterCard)
        XCTAssertEqual(state.consecutiveFailures, 0, "a fresh attempt earns a clean slate")
    }

    func testAQueueWithNothingPlayableLandsOnStillsRatherThanAnEmptyReel() {
        let empty = ShowcaseQueue(
            kind: .curated,
            chapters: [
                ShowcaseChapter(id: "e", title: "E", subtitle: nil, excerpts: [], isLanguageChapter: false),
            ],
            statLines: []
        )
        XCTAssertEqual(ShowcaseReel.reduce(.initial, .resolved(empty)).phase, .stills)
    }

    func testStillsPostersComeFromTheLastGoodQueueDeduped() {
        let queue = ShowcaseQueue(
            kind: .curated,
            chapters: [
                ShowcaseChapter(
                    id: "c",
                    title: "C",
                    subtitle: nil,
                    excerpts: [
                        makeExcerpt("a", poster: "https://img/a.jpg"),
                        makeExcerpt("b", poster: "https://img/a.jpg"),
                        makeExcerpt("c", poster: nil),
                        makeExcerpt("d", poster: "https://img/d.jpg"),
                    ],
                    isLanguageChapter: false
                ),
            ],
            statLines: []
        )
        let state = started(queue)
        XCTAssertEqual(
            ShowcaseReel.stillsPosters(state).map(\.absoluteString),
            ["https://img/a.jpg", "https://img/d.jpg"]
        )
    }
}

// MARK: - Language hops in the reel

final class ShowcaseHopSequenceTests: XCTestCase {
    private let hops = [
        ShowcaseHop(languageSlug: "english", languageName: "English", playbackID: "pbEn",
                    window: ExcerptWindow(start: 0, end: 10)),
        ShowcaseHop(languageSlug: "thai", languageName: "Thai", playbackID: "pbTh",
                    window: ExcerptWindow(start: 10, end: 20)),
        ShowcaseHop(languageSlug: "korean", languageName: "Korean", playbackID: "pbKo",
                    window: ExcerptWindow(start: 20, end: 30)),
    ]

    private func centerpieceQueue() -> ShowcaseQueue {
        ShowcaseQueue(
            kind: .curated,
            chapters: [
                makeChapter("languages", excerpts: 1, isLanguageChapter: true),
                makeChapter("after", excerpts: 1),
            ],
            statLines: []
        )
    }

    private func playingCenterpiece() -> ShowcaseReelState {
        var state = started(centerpieceQueue())
        state = ShowcaseReel.reduce(state, .hopPlanResolved(token: state.excerptToken, hops: hops))
        return state
    }

    func testOnlyTheFirstExcerptOfALanguageChapterIsTheCenterpiece() {
        let queue = ShowcaseQueue(
            kind: .curated,
            chapters: [makeChapter("languages", excerpts: 2, isLanguageChapter: true)],
            statLines: []
        )
        var state = started(queue)
        XCTAssertTrue(ShowcaseReel.isCenterpiece(state))
        state = ShowcaseReel.reduce(state, .excerptEnded)
        XCTAssertFalse(ShowcaseReel.isCenterpiece(state), "the rest play ordinarily")
    }

    func testEachHopEndAdvancesTheDubAndBumpsTheToken() {
        var state = playingCenterpiece()
        XCTAssertEqual(state.hop?.index, 0)
        let token = state.excerptToken

        state = ShowcaseReel.reduce(state, .excerptEnded)
        XCTAssertEqual(state.hop?.index, 1)
        // The bump is what re-arms the player swap and the lower-third
        // animation; without it the second dub would never load.
        XCTAssertGreaterThan(state.excerptToken, token)
        XCTAssertEqual(state.chapterIndex, 0, "the reel has not moved on")
    }

    func testThePlanPlayingOutAdvancesTheReelAndClearsTheBreaker() {
        var state = playingCenterpiece()
        state.consecutiveFailures = 1
        for _ in 0 ..< hops.count {
            state = ShowcaseReel.reduce(state, .excerptEnded)
        }
        XCTAssertNil(state.hop)
        XCTAssertEqual(state.chapterIndex, 1)
        XCTAssertEqual(state.consecutiveFailures, 0)
    }

    /// A dead dub is not a dead excerpt. Striking per hop would drop a
    /// nine-language centerpiece into stills on three bad dubs.
    func testAFailedHopSkipsToTheNextWithoutAStrike() {
        var state = playingCenterpiece()
        state = ShowcaseReel.reduce(state, .excerptFailed)
        XCTAssertEqual(state.hop?.index, 1)
        XCTAssertEqual(state.consecutiveFailures, 0)
    }

    func testACenterpieceWithNoPlayableHopLeftTakesASingleStrike() {
        var state = playingCenterpiece()
        state = ShowcaseReel.reduce(state, .excerptFailed) // → hop 1
        state = ShowcaseReel.reduce(state, .excerptFailed) // → hop 2
        state = ShowcaseReel.reduce(state, .excerptFailed) // plan exhausted
        XCTAssertNil(state.hop)
        XCTAssertEqual(state.consecutiveFailures, 1, "one dead centerpiece, one strike")
    }

    /// The plan is built asynchronously. One that arrives after the reel has
    /// moved on would dub-switch a completely different video.
    func testAStalePlanIsDropped() {
        var state = started(centerpieceQueue())
        let stale = state.excerptToken - 1
        state = ShowcaseReel.reduce(state, .hopPlanResolved(token: stale, hops: hops))
        XCTAssertNil(state.hop)
    }

    func testAOneHopPlanIsNotALanguageSwitch() {
        var state = started(centerpieceQueue())
        state = ShowcaseReel.reduce(
            state, .hopPlanResolved(token: state.excerptToken, hops: [hops[0]])
        )
        XCTAssertNil(state.hop, "one language is not a switch — play it as an ordinary excerpt")
    }

    /// The card is the centerpiece's buffer window, so a plan may land while
    /// it is still showing.
    func testAPlanMayLandWhileTheChapterCardIsStillUp() {
        var state = ShowcaseReel.reduce(.initial, .resolved(centerpieceQueue()))
        XCTAssertEqual(state.phase, .chapterCard)
        state = ShowcaseReel.reduce(state, .hopPlanResolved(token: state.excerptToken, hops: hops))
        XCTAssertEqual(state.hop?.index, 0)
    }

    func testANewChapterNeverInheritsThePreviousCenterpiecesPlan() {
        var state = playingCenterpiece()
        for _ in 0 ..< hops.count {
            state = ShowcaseReel.reduce(state, .excerptEnded)
        }
        XCTAssertNil(state.hop)
        XCTAssertEqual(ShowcaseReel.currentChapter(state)?.id, "after")
    }
}

// MARK: - View model

@MainActor
final class ShowcaseViewModelTests: XCTestCase {
    /// Every phase dwell collapses to nothing, so a test runs hours of reel in
    /// milliseconds. Safe against runaway loops by construction: the only
    /// self-re-arming phase is `stills`, and a failed retry there produces an
    /// unchanged state, which stops the effect chain.
    private var instantClock: ShowcaseClock {
        ShowcaseClock(sleep: { _ in })
    }

    private func waitUntil(
        _ description: String,
        timeout: TimeInterval = 2,
        _ condition: () -> Bool
    ) async {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return }
            try? await Task.sleep(nanoseconds: 2_000_000)
        }
        XCTFail("timed out waiting for \(description)")
    }

    private func video(dubs: [Dub], title: String = "Birth of Jesus") -> WatchVideo {
        WatchVideo(
            id: "v1",
            slug: "birth-of-jesus",
            label: "SEGMENT",
            title: title,
            description: nil,
            posterURL: nil,
            primaryBcp47: "en",
            dubs: dubs
        )
    }

    func testNothingResolvableLandsOnStillsRatherThanAnError() async {
        let model = ShowcaseViewModel(
            source: ShowcaseSource(loadQueue: { nil }, loadVideo: { _ in nil }),
            clock: instantClock,
            deviceBcp47: "en"
        )
        model.start()
        await waitUntil("the stills floor") { model.state.phase == .stills }
    }

    /// The stills floor's whole promise is that resolution is being retried
    /// BEHIND the art. That retry has to survive its own failure.
    ///
    /// `.resolveFailed` is a deliberate no-op once the reel is already on
    /// stills, so a failed retry changes no state — and the state-change path
    /// is what re-arms every other phase timer. A single-shot stills timer
    /// therefore retried exactly once and then stopped forever: an office TV
    /// that lost the backend for one minute would hold the same art until
    /// somebody power-cycled it, long after the network came back.
    func testStillsKeepsRetryingAfterAFailedRetry() async {
        let attempts = AttemptCounter()
        let model = ShowcaseViewModel(
            source: ShowcaseSource(
                loadQueue: {
                    attempts.value += 1
                    return nil
                },
                loadVideo: { _ in nil }
            ),
            clock: instantClock,
            deviceBcp47: "en"
        )
        model.start()
        await waitUntil("the stills floor") { model.state.phase == .stills }
        // One attempt is the cold-start resolve. Anything past it can only
        // come from the stills timer re-arming after a failed retry.
        await waitUntil("repeated retries behind the art") { attempts.value >= 4 }
        XCTAssertEqual(model.state.phase, .stills, "retrying never leaves the floor")
    }

    /// A resolve that finally succeeds must take the reel off the floor —
    /// otherwise the retry loop above would spin behind the art forever.
    func testStillsRejoinsTheReelOnceResolutionRecovers() async {
        let attempts = AttemptCounter()
        let queue = makeQueue(chapters: 1, excerptsEach: 1, statLines: [])
        let model = ShowcaseViewModel(
            source: ShowcaseSource(
                loadQueue: {
                    attempts.value += 1
                    // Dead until the third attempt, then the backend recovers.
                    return attempts.value >= 3 ? queue : nil
                },
                loadVideo: { _ in
                    self.video(dubs: [makeDub("english", bcp47: "en", duration: 600)])
                }
            ),
            clock: instantClock,
            deviceBcp47: "en"
        )
        model.start()
        await waitUntil("the reel to rejoin") { model.state.phase != .stills }
        await waitUntil("a stream") { model.stream != nil }
    }

    func testAnOrdinaryExcerptResolvesToABoundedStream() async {
        let model = ShowcaseViewModel(
            source: ShowcaseSource(
                loadQueue: { makeQueue(chapters: 1, excerptsEach: 1, statLines: []) },
                loadVideo: { _ in
                    self.video(dubs: [makeDub("english", bcp47: "en", duration: 600)])
                }
            ),
            clock: instantClock,
            deviceBcp47: "en"
        )
        model.start()
        await waitUntil("a stream") { model.stream != nil }

        let stream = model.stream!
        XCTAssertEqual(stream.playbackID, "pbenglish")
        XCTAssertEqual(stream.window, ExcerptWindow(start: 90, end: 130))
        XCTAssertFalse(stream.claimsLanguage, "an ordinary excerpt announces no language")
    }

    /// The centerpiece is the whole point of the language chapter: it must
    /// reach the player as a HOP, announcing its language, not as one more
    /// silent excerpt.
    func testTheCenterpieceResolvesIntoAnAnnouncedHop() async {
        let queue = ShowcaseQueue(
            kind: .curated,
            chapters: [makeChapter("languages", excerpts: 1, isLanguageChapter: true)],
            statLines: []
        )
        let model = ShowcaseViewModel(
            source: ShowcaseSource(
                loadQueue: { queue },
                loadVideo: { _ in
                    self.video(dubs: [
                        makeDub("english", bcp47: "en", duration: 400),
                        makeDub("thai", bcp47: "th", duration: 400),
                        makeDub("korean", bcp47: "ko", duration: 400),
                    ])
                }
            ),
            clock: instantClock,
            deviceBcp47: "en",
            rng: { 0 }
        )
        model.start()
        await waitUntil("a hop stream") { model.stream?.claimsLanguage == true }

        XCTAssertEqual(model.state.hop?.hops.count, 3)
        XCTAssertEqual(model.stream?.languageName, "English")
        XCTAssertEqual(model.liveLanguageCount, 3)
        XCTAssertEqual(model.liveTitle, "Birth of Jesus")
    }

    func testAVideoWithNothingPlayableSkipsRatherThanStalling() async {
        let model = ShowcaseViewModel(
            source: ShowcaseSource(
                loadQueue: { makeQueue(chapters: 1, excerptsEach: 3, statLines: []) },
                loadVideo: { _ in self.video(dubs: []) }
            ),
            clock: instantClock,
            deviceBcp47: "en"
        )
        model.start()
        // Three dead items in a row is exactly the breaker's threshold.
        await waitUntil("the breaker to reach stills") { model.state.phase == .stills }
    }

    /// `suspend()` is the background path. It must leave the reel's POSITION
    /// intact — coming back from background should not restart the showcase
    /// from chapter one.
    func testSuspendKeepsPositionAndResumeRepublishesAStream() async {
        let model = ShowcaseViewModel(
            source: ShowcaseSource(
                loadQueue: { makeQueue(chapters: 2, excerptsEach: 2, statLines: []) },
                loadVideo: { _ in
                    self.video(dubs: [makeDub("english", bcp47: "en", duration: 600)])
                }
            ),
            clock: instantClock,
            deviceBcp47: "en"
        )
        model.start()
        await waitUntil("a stream") { model.stream != nil }
        model.streamEnded()
        await waitUntil("the second excerpt") { model.state.excerptIndex == 1 }

        model.suspend()
        XCTAssertNil(model.stream, "the player is detached while backgrounded")
        XCTAssertEqual(model.state.excerptIndex, 1, "position survives")

        model.resume()
        await waitUntil("a republished stream") { model.stream != nil }
        XCTAssertEqual(model.state.excerptIndex, 1)
    }

    func testExitIsTerminalAndStopsPublishing() async {
        let model = ShowcaseViewModel(
            source: ShowcaseSource(
                loadQueue: { makeQueue(chapters: 1, excerptsEach: 2, statLines: []) },
                loadVideo: { _ in
                    self.video(dubs: [makeDub("english", bcp47: "en", duration: 600)])
                }
            ),
            clock: instantClock,
            deviceBcp47: "en"
        )
        model.start()
        await waitUntil("a stream") { model.stream != nil }

        model.exit()
        XCTAssertEqual(model.state.phase, .exited)
        XCTAssertNil(model.stream)
        model.streamEnded()
        XCTAssertEqual(model.state.phase, .exited, "nothing restarts a finished session")
    }

    /// Zero PII, checked where the events are actually produced: the showcase
    /// session reports its PATH and its position, never a slug or a title.
    func testSessionTelemetryCarriesNoContentIdentity() async {
        let sink = RecordingTelemetrySink()
        let telemetry = Telemetry(sink: sink)
        let model = ShowcaseViewModel(
            source: ShowcaseSource(
                loadQueue: { makeQueue(chapters: 1, excerptsEach: 1, statLines: []) },
                loadVideo: { _ in
                    self.video(dubs: [makeDub("english", bcp47: "en", duration: 600)], title: "Birth of Jesus")
                }
            ),
            clock: instantClock,
            deviceBcp47: "en",
            telemetry: telemetry
        )
        model.start()
        await waitUntil("a stream") { model.stream != nil }
        model.exit(reason: "press")

        let names = sink.events.map(\.name)
        XCTAssertTrue(names.contains(TelemetrySignals.showcaseStart))
        XCTAssertTrue(names.contains(TelemetrySignals.showcaseExit))
        let rendered = sink.events.map(TelemetryFormatter.line).joined(separator: " ")
        XCTAssertFalse(rendered.contains("birth-of-jesus"))
        XCTAssertFalse(rendered.contains("Birth of Jesus"))
    }
}
