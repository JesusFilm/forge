import XCTest
@testable import JesusFilmTV

// MARK: - Recent-search policy

/// Ported from `apps/tv/src/lib/searchHistoryMerge.ts`. Each case pins a rule
/// the RN app treats as contract; drift between the two apps shows up as the
/// same list behaving differently on the same TV.
final class RecentSearchesPolicyTests: XCTestCase {
    func testNewestQueryLandsFirst() {
        XCTAssertEqual(RecentSearches.merge([], adding: "jesus"), ["jesus"])
        XCTAssertEqual(
            RecentSearches.merge(["jesus"], adding: "moses"),
            ["moses", "jesus"]
        )
    }

    /// The rule that makes five slots enough. Without it, "Jesus" and "jesus"
    /// each burn a slot and two more searches push out everything real.
    func testDedupesCaseInsensitivelyAndKeepsTheNewCasing() {
        XCTAssertEqual(
            RecentSearches.merge(["jesus", "moses"], adding: "JESUS"),
            ["JESUS", "moses"]
        )
    }

    func testCapsAtMaxEntriesByDroppingTheOldest() {
        let previous = ["a", "b", "c", "d", "e"]
        XCTAssertEqual(previous.count, RecentSearches.maxEntries)
        let next = RecentSearches.merge(previous, adding: "f")
        XCTAssertEqual(next, ["f", "a", "b", "c", "d"])
    }

    /// A query that reduces to nothing must leave the list untouched rather
    /// than inserting a blank chip nobody can identify or re-run.
    func testBlankAndInvisibleQueriesAreNotRecorded() {
        XCTAssertEqual(RecentSearches.merge(["jesus"], adding: "   "), ["jesus"])
        XCTAssertEqual(RecentSearches.merge(["jesus"], adding: ""), ["jesus"])
        XCTAssertEqual(RecentSearches.merge(["jesus"], adding: "\u{200B}\u{202E}"), ["jesus"])
    }

    func testNormalizeTrimsSurroundingWhitespace() {
        XCTAssertEqual(RecentSearches.normalize("  bible stories \n"), "bible stories")
    }

    /// Dictation and any future paste path can produce these; the on-screen
    /// keyboard cannot. They render as nothing inside a chip — or, for the
    /// directional overrides, reorder the text around them.
    /// One case per RANGE in `isStripped`, and both ends of each. A single
    /// representative per feature let a whole range be deleted with the suite
    /// green: dropping `0x007F...0x009F` altogether passed all 24 cases.
    func testNormalizeStripsControlZeroWidthAndDirectionalCodepoints() {
        // C0: 0x0000-0x001F
        XCTAssertEqual(RecentSearches.normalize("a\u{0007}b"), "ab")
        XCTAssertEqual(RecentSearches.normalize("a\u{001F}b"), "ab")
        // C1: 0x007F-0x009F — DEL through APC. Nothing renders; a stored one
        // survives every round trip and shows up as an unpressable gap.
        XCTAssertEqual(RecentSearches.normalize("a\u{007F}b"), "ab")
        XCTAssertEqual(RecentSearches.normalize("a\u{0085}b"), "ab")
        XCTAssertEqual(RecentSearches.normalize("a\u{009F}b"), "ab")
        // Zero-width + LRM/RLM: 0x200B-0x200F
        XCTAssertEqual(RecentSearches.normalize("je\u{200B}sus"), "jesus")
        XCTAssertEqual(RecentSearches.normalize("je\u{200D}sus"), "jesus")
        XCTAssertEqual(RecentSearches.normalize("je\u{200F}sus"), "jesus")
        // Directional overrides: 0x202A-0x202E. The bidi ones reorder the text
        // AROUND them, so a chip can display something the viewer never typed.
        XCTAssertEqual(RecentSearches.normalize("\u{202A}moses"), "moses")
        XCTAssertEqual(RecentSearches.normalize("\u{202E}moses"), "moses")
    }

    func testNormalizeFoldsCompatibilityForms() {
        // U+FB01 LATIN SMALL LIGATURE FI — NFKC folds it, so the ligature-typed
        // query shares a slot with its plain spelling instead of duplicating it.
        XCTAssertEqual(RecentSearches.normalize("\u{FB01}sh"), "fish")
    }

    func testNormalizeCapsEntryLength() {
        let long = String(repeating: "a", count: RecentSearches.maxEntryLength + 44)
        XCTAssertEqual(RecentSearches.normalize(long)?.count, RecentSearches.maxEntryLength)
    }

    func testNormalizeRejectsAnythingThatReducesToEmpty() {
        XCTAssertNil(RecentSearches.normalize(""))
        XCTAssertNil(RecentSearches.normalize("  \t "))
        XCTAssertNil(RecentSearches.normalize("\u{200D}"))
    }

    // MARK: sanitize (the on-disk read)

    func testSanitizeOfAbsentHistoryIsEmpty() {
        XCTAssertEqual(RecentSearches.sanitize(nil), [])
    }

    /// A blob written by an older policy (different cap, untrimmed entries,
    /// duplicates) must still read back as a legal list.
    func testSanitizeNormalizesDedupesAndCaps() {
        let stored = ["  jesus  ", "JESUS", "moses", "", "   ", "ruth", "job", "esther", "mark"]
        XCTAssertEqual(
            RecentSearches.sanitize(stored),
            ["jesus", "moses", "ruth", "job", "esther"]
        )
    }

    func testSanitizeClampsAnOverLongStoredEntry() {
        let long = String(repeating: "b", count: 1000)
        XCTAssertEqual(
            RecentSearches.sanitize([long]).first?.count,
            RecentSearches.maxEntryLength
        )
    }
}

// MARK: - Recent-search storage

@MainActor
final class RecentSearchesStoreTests: XCTestCase {
    func testRoundTripsThroughStorage() throws {
        let defaults = try makeIsolatedDefaults()
        let store = RecentSearchesStore(defaults: defaults)
        store.record("bible stories")
        store.record("parables")

        // A fresh instance is what a relaunch actually does — asserting on the
        // same instance would pass with no write at all.
        let reloaded = RecentSearchesStore(defaults: defaults)
        XCTAssertEqual(reloaded.queries, ["parables", "bible stories"])
    }

    /// A chip re-runs the query it came from, so the screen records the head of
    /// the list again on every such search. That must be inert, not a duplicate.
    func testRecordingTheCurrentHeadAgainIsInert() throws {
        let defaults = try makeIsolatedDefaults()
        let store = RecentSearchesStore(defaults: defaults)
        store.record("jesus")
        store.record("jesus")
        XCTAssertEqual(store.queries, ["jesus"])
    }

    /// The list being unchanged is not the claim — the claim is that an
    /// unchanged list SKIPS THE WRITE. Asserting on `queries` alone cannot see
    /// that: merge is idempotent for the head, so deleting the short-circuit
    /// leaves every visible value identical. Parking a sentinel under the key
    /// makes the write itself observable.
    func testRecordingTheCurrentHeadAgainSkipsTheWrite() throws {
        let defaults = try makeIsolatedDefaults()
        let store = RecentSearchesStore(defaults: defaults)
        store.record("jesus")

        defaults.set(["SENTINEL"], forKey: RecentSearches.storageKey)
        store.record("jesus")

        XCTAssertEqual(
            defaults.stringArray(forKey: RecentSearches.storageKey),
            ["SENTINEL"],
            "re-recording the head must not touch storage"
        )
    }

    func testClearEmptiesMemoryAndStorage() throws {
        let defaults = try makeIsolatedDefaults()
        let store = RecentSearchesStore(defaults: defaults)
        store.record("jesus")
        store.clear()

        XCTAssertEqual(store.queries, [])
        XCTAssertNil(
            defaults.stringArray(forKey: RecentSearches.storageKey),
            "clear removes the key so a cleared history is indistinguishable from an unwritten one"
        )
        XCTAssertEqual(RecentSearchesStore(defaults: defaults).queries, [])
    }

    /// Whatever is under the key may not be ours. A history that cannot be read
    /// degrades to no history — never to a crash on a screen the viewer reached
    /// by pressing Search.
    func testForeignStoredValueDegradesToNoHistory() throws {
        let defaults = try makeIsolatedDefaults()
        defaults.set(["jesus", 5] as [Any], forKey: RecentSearches.storageKey)
        XCTAssertEqual(RecentSearchesStore(defaults: defaults).queries, [])
    }

    func testAnOverCapStoredListIsClampedOnRead() throws {
        let defaults = try makeIsolatedDefaults()
        defaults.set(
            (1...9).map { "query-\($0)" },
            forKey: RecentSearches.storageKey
        )
        XCTAssertEqual(
            RecentSearchesStore(defaults: defaults).queries.count,
            RecentSearches.maxEntries
        )
    }
}

// MARK: - Settings

@MainActor
final class AppSettingsTests: XCTestCase {
    func testDefaultsToOffWhenNothingIsStored() throws {
        let defaults = try makeIsolatedDefaults()
        XCTAssertFalse(AppSettings(defaults: defaults).showcaseAutoStart)
    }

    func testRoundTripsThroughStorage() throws {
        let defaults = try makeIsolatedDefaults()
        let settings = AppSettings(defaults: defaults)
        settings.showcaseAutoStart = true

        XCTAssertTrue(AppSettings(defaults: defaults).showcaseAutoStart)
    }

    /// Turning it back off must WRITE false, not merely stop writing true.
    /// `bool(forKey:)` answers false for an absent key too, so reading the flag
    /// alone cannot tell the two apart — hence the object-presence assertion.
    func testTurningItOffPersistsAnExplicitFalse() throws {
        let defaults = try makeIsolatedDefaults()
        let settings = AppSettings(defaults: defaults)
        settings.showcaseAutoStart = true
        settings.showcaseAutoStart = false

        XCTAssertNotNil(defaults.object(forKey: AppSettings.Key.showcaseAutoStart))
        XCTAssertFalse(AppSettings(defaults: defaults).showcaseAutoStart)
    }

    /// Hydration must not write back over what it just read. If `init` ever
    /// fires the persist path, an unprovisioned install starts stamping the key
    /// on every launch and the "never chosen" state disappears.
    func testHydratingDoesNotWriteBack() throws {
        let defaults = try makeIsolatedDefaults()
        _ = AppSettings(defaults: defaults)
        XCTAssertNil(defaults.object(forKey: AppSettings.Key.showcaseAutoStart))
    }

    /// `didSet` guards on a value change. Nothing that reads the flag can see
    /// that guard — a redundant write stores the same boolean — so pin it by
    /// clearing the key and re-assigning the value already held.
    func testAssigningTheSameValueSkipsTheWrite() throws {
        let defaults = try makeIsolatedDefaults()
        let settings = AppSettings(defaults: defaults)
        settings.showcaseAutoStart = true
        defaults.removeObject(forKey: AppSettings.Key.showcaseAutoStart)

        settings.showcaseAutoStart = true

        XCTAssertNil(
            defaults.object(forKey: AppSettings.Key.showcaseAutoStart),
            "an unchanged assignment must not reach storage"
        )
    }
}

// MARK: - Browse categories

final class SearchCategoryTests: XCTestCase {
    /// The idle browse grid is laid out as fixed rows (non-lazy, so it has
    /// focusable descendants at first layout). This is the guard that the
    /// chunking never silently drops or reorders a category.
    func testRowsCoverEveryCategoryInOrder() {
        XCTAssertEqual(SearchCategory.rows.flatMap { $0 }, SearchCategory.all)
        for row in SearchCategory.rows {
            XCTAssertLessThanOrEqual(row.count, SearchCategory.columnCount)
            XCTAssertFalse(row.isEmpty, "an empty row would render as a focus hole")
        }
    }

    /// Titles and search terms are ported verbatim from
    /// `apps/tv/src/components/search/categories.ts`, itself a port of web's
    /// `search-categories.ts`. Pinning them here makes a one-app edit fail
    /// loudly instead of quietly diverging the three surfaces.
    func testSearchTermsMatchTheReactNativePort() {
        XCTAssertEqual(
            SearchCategory.all.map(\.searchTerm),
            ["bible stories", "parables", "animated", "study", "family", "christmas"]
        )
        XCTAssertEqual(
            SearchCategory.all.map(\.title),
            ["Bible Stories", "Parables", "Animated", "Study", "Family", "Christmas"]
        )
    }

    func testEveryCategoryHasTwoGradientStops() {
        for category in SearchCategory.all {
            XCTAssertEqual(category.colors.count, 2, "\(category.searchTerm)")
        }
    }
}

// MARK: - What a search transition records

/// The rule this unit turns on, and the one no assertion reached before: which
/// query a `.results` transition writes to history, and whether it writes at
/// all. Every case here drives a REAL `SearchViewModel` through a stubbed
/// transport, because the three ways this breaks — the view model never
/// publishing `submittedQuery`, the view reading the live `query` instead, and
/// the non-empty guard inverted — are all invisible to a test that calls the
/// policy with hand-built arguments.
@MainActor
final class SearchHistoryPolicyTests: XCTestCase {
    override func tearDown() {
        StubTransport.reset()
        super.tearDown()
    }

    func testRecordsTheQueryTheVisibleResultsAnswerFor() async throws {
        let viewModel = try await makeViewModel(searching: "  jesus  ", returning: 2)
        XCTAssertEqual(SearchHistoryPolicy.queryToRecord(viewModel), "jesus")
    }

    /// The whole reason `submittedQuery` exists. The viewer keeps typing while
    /// the answer to their last submission is still on screen; history must
    /// record what they SAW, not the prefix they have since typed past — which
    /// returned nothing and may never be submitted at all.
    func testKeepsRecordingTheSubmittedQueryAfterTheViewerTypesOn() async throws {
        let viewModel = try await makeViewModel(searching: "jesus", returning: 2)
        viewModel.query = "jesus and the fi"

        XCTAssertEqual(
            SearchHistoryPolicy.queryToRecord(viewModel),
            "jesus",
            "records the submitted query, never the newer live one"
        )
    }

    /// A search that found nothing is exactly what a recents row must not
    /// offer back — re-running it is guaranteed to waste the trip.
    func testASearchWithNoResultsRecordsNothing() async throws {
        let viewModel = try await makeViewModel(searching: "qwertyuiop", returning: 0)
        XCTAssertNil(SearchHistoryPolicy.queryToRecord(viewModel))
    }

    func testNonResultStatesRecordNothing() async throws {
        let idle = SearchViewModel(client: GraphQLClient(session: StubTransport.session))
        XCTAssertNil(SearchHistoryPolicy.queryToRecord(idle), "idle")

        let failed = try await makeViewModel(searching: "jesus", returning: nil)
        XCTAssertEqual(failed.state, .failed)
        XCTAssertNil(SearchHistoryPolicy.queryToRecord(failed), "failed")
    }

    // MARK: helpers

    /// Runs one real search to completion. `rows` nil stubs a transport failure.
    private func makeViewModel(
        searching query: String,
        returning rows: Int?
    ) async throws -> SearchViewModel {
        StubTransport.responder = { rows.map(Self.watchSearchPayload(rowCount:)) }
        let viewModel = SearchViewModel(client: GraphQLClient(session: StubTransport.session))
        viewModel.query = query
        viewModel.retry() // immediate; skips the 350ms debounce

        try await settle { viewModel.state != .idle && viewModel.state != .searching }
        return viewModel
    }

    private func settle(
        until condition: @MainActor () -> Bool,
        timeout: Duration = .seconds(5)
    ) async throws {
        let deadline = ContinuousClock.now.advanced(by: timeout)
        while ContinuousClock.now < deadline {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(5))
        }
        XCTFail("view model never left the pending states")
    }

    private static func watchSearchPayload(rowCount: Int) -> Data {
        let results = (0 ..< rowCount).map { index in
            """
            {"type":"VIDEO","id":"id-\(index)","slug":"slug-\(index)",
             "title":"Result \(index)","imageUrl":null,"snippet":null,
             "playbackId":"playback-\(index)","label":"SEGMENT","childCount":0}
            """
        }
        return Data("""
        {"data":{"watchSearch":{"query":"q","hasMore":false,"nextOffset":null,
         "results":[\(results.joined(separator: ","))]}}}
        """.utf8)
    }
}

/// `URLProtocol` stub for the one `URLSession` `GraphQLClient` holds. Injected
/// through the client's memberwise init, so the view model under test is the
/// shipped one — only the socket is fake.
final class StubTransport: URLProtocol, @unchecked Sendable {
    /// Returns the body to answer with, or nil to fail the request.
    nonisolated(unsafe) static var responder: (@Sendable () -> Data?)?

    static var session: URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubTransport.self]
        return URLSession(configuration: configuration)
    }

    static func reset() { responder = nil }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        guard let body = StubTransport.responder?() else {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: 200,
            httpVersion: nil,
            headerFields: ["content-type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
}

// MARK: - Helpers

extension XCTestCase {
    /// An isolated `UserDefaults` suite per test. `.standard` would leak state
    /// between tests and into whatever simulator ran them — and these suites are
    /// the substrate under test, so a leak here reads as a passing round trip.
    ///
    /// Wiped on the way IN as well as out: a test that crashes skips its
    /// teardown, and the next run would then inherit its writes.
    func makeIsolatedDefaults(_ caller: String = #function) throws -> UserDefaults {
        let scope = "\(type(of: self)).\(caller)".filter { $0.isLetter || $0 == "." }
        let suite = "org.jesusfilm.forgetv.native.tests.\(scope)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defaults.removePersistentDomain(forName: suite)
        addTeardownBlock { defaults.removePersistentDomain(forName: suite) }
        return defaults
    }
}
