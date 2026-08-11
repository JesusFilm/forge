import XCTest
@testable import JesusFilmTV

final class SeriesShapeTests: XCTestCase {
    /// Every `VideoLabel` the production schema can emit, with the answer the
    /// React Native predicate gives. Table-driven so a label added to the enum
    /// has an obvious place to land — and so nobody has to guess which of the
    /// eight the rule covers.
    func testEveryProductionLabel() {
        let cases: [(String, Bool)] = [
            ("SERIES", true),
            ("COLLECTION", true),
            ("FEATURE_FILM", false),
            ("EPISODE", false),
            ("SEGMENT", false),
            ("SHORT_FILM", false),
            ("BEHIND_THE_SCENES", false),
            ("TRAILER", false),
        ]
        for (label, expected) in cases {
            XCTAssertEqual(
                SeriesShape.isSeriesLabel(label), expected,
                "\(label) should \(expected ? "" : "not ")be series-shaped"
            )
        }
    }

    func testAbsentLabelIsNotSeriesShaped() {
        XCTAssertFalse(SeriesShape.isSeriesLabel(nil))
        XCTAssertFalse(SeriesShape.isSeriesLabel(""))
    }

    /// STRICT uppercase, ported deliberately. `VideoLabel` is a GraphQL enum,
    /// so nothing lowercase ever crosses the wire; case-folding would let a
    /// lowercase FIXTURE pass and hide the fact that the production spelling
    /// was never exercised.
    func testMatchingIsCaseSensitive() {
        XCTAssertFalse(SeriesShape.isSeriesLabel("series"))
        XCTAssertFalse(SeriesShape.isSeriesLabel("Series"))
        XCTAssertFalse(SeriesShape.isSeriesLabel("collection"))
        XCTAssertFalse(SeriesShape.isSeriesLabel("Collection"))
    }

    /// Children do NOT make a record series-shaped. Feature films carry their
    /// own chapter clips — `jesus` has 61 in production — and counting them
    /// billed ten films as series in the RN app. The label is the whole rule.
    func testChapterCountIsNotAProxyForSeriesShape() {
        XCTAssertFalse(
            SeriesShape.isSeriesLabel("FEATURE_FILM"),
            "a 61-chapter feature film is still a leaf"
        )
    }

    func testRouteSendsSeriesShapedRecordsToTheSeriesScreen() {
        XCTAssertEqual(
            SeriesShape.route(label: "COLLECTION", slug: "lumo-the-gospel-of-matthew"),
            .series(slug: "lumo-the-gospel-of-matthew")
        )
        XCTAssertEqual(
            SeriesShape.route(label: "SERIES", slug: "lumo-acts-of-the-apostles"),
            .series(slug: "lumo-acts-of-the-apostles")
        )
        XCTAssertEqual(
            SeriesShape.route(label: "SEGMENT", slug: "lumo-matthew-1-1-2-23"),
            .video(slug: "lumo-matthew-1-1-2-23")
        )
        XCTAssertEqual(
            SeriesShape.route(label: nil, slug: "unknown"),
            .video(slug: "unknown")
        )
    }

    /// Finding 4, from the watch screen's side: `lumo-the-gospel-of-matthew`
    /// returns 56 published dubs and zero playable ones, because a collection's
    /// media lives on its children. The label is already on the loaded record,
    /// so the redirect needs no extra query.
    func testWatchRedirectFiresForACollectionAndNotForALeaf() {
        XCTAssertEqual(
            SeriesShape.watchRedirect(label: "COLLECTION", slug: "lumo-the-gospel-of-matthew"),
            .series(slug: "lumo-the-gospel-of-matthew")
        )
        XCTAssertNil(SeriesShape.watchRedirect(label: "FEATURE_FILM", slug: "jesus"))
        XCTAssertNil(
            SeriesShape.watchRedirect(label: nil, slug: "jesus"),
            "an unloaded record must render, not bounce"
        )
    }
}

final class SeriesProjectionTests: XCTestCase {
    /// Trimmed from the real production response for
    /// `lumo-the-gospel-of-matthew` (fetched 2026-08-12): a COLLECTION whose
    /// children are playable SEGMENTs, each image entry carrying either
    /// cinematic art or a thumbnail but never both.
    private let collectionJSON = """
    {"videoBySlug":{
      "id":"cmokmnbls0oa1qscc5a0k9p1d",
      "slug":"lumo-the-gospel-of-matthew",
      "label":"COLLECTION",
      "images":[
        {"url":"https://img/GOMattCollection.jpg","thumbnail":null,
         "mobileCinematicHigh":"https://img/GOMattCollection.jpg/f=jpg,w=1280"},
        {"url":"https://img/GOMattCollection.still.jpg",
         "thumbnail":"https://img/GOMattCollection.still.jpg/f=jpg,w=120",
         "mobileCinematicHigh":null}
      ],
      "locales":[{"title":"LUMO - The Gospel of Matthew","description":"The Gospel of Matthew...","snippet":null}],
      "children":[
        {"order":2,"child":{
          "id":"c2","slug":"lumo-matthew-3-1-4-25","label":"SEGMENT",
          "muxPlaybackId":"pbTwo","durationSeconds":700,
          "images":[{"url":"https://img/two.jpg","thumbnail":null,"mobileCinematicHigh":"https://img/two.jpg/f=jpg"}],
          "locales":[{"title":"LUMO - Matthew 3:1-4:25"}]}},
        {"order":1,"child":{
          "id":"c1","slug":"lumo-matthew-1-1-2-23","label":"SEGMENT",
          "muxPlaybackId":"VqhT01jgV02Ug85u99nlG3skLiEBIxjYa96g017ayN5xbU","durationSeconds":581,
          "images":[{"url":"https://img/one.jpg","thumbnail":null,"mobileCinematicHigh":"https://img/one.jpg/f=jpg"}],
          "locales":[{"title":"LUMO - Matthew 1:1-2:23"}]}}
      ]}}
    """

    private func project(_ json: String) throws -> SeriesDetail {
        let data = try JSONDecoder().decode(SeriesBySlugData.self, from: Data(json.utf8))
        return try XCTUnwrap(SeriesProjection.project(data))
    }

    func testProjectsHeroFieldsFromTheEnglishLocale() throws {
        let series = try project(collectionJSON)
        XCTAssertEqual(series.id, "cmokmnbls0oa1qscc5a0k9p1d")
        XCTAssertEqual(series.slug, "lumo-the-gospel-of-matthew")
        XCTAssertEqual(series.label, "COLLECTION")
        XCTAssertEqual(series.title, "LUMO - The Gospel of Matthew")
        XCTAssertEqual(series.description, "The Gospel of Matthew...")
    }

    func testEpisodesAreOrderedByTheRelationOrderNotWireOrder() throws {
        let series = try project(collectionJSON)
        XCTAssertEqual(series.episodes.map(\.slug), ["lumo-matthew-1-1-2-23", "lumo-matthew-3-1-4-25"])
        XCTAssertEqual(series.episodes.map(\.episodeNumber), [1, 2])
    }

    func testPlayableChildCarriesItsRepresentativePlaybackID() throws {
        let series = try project(collectionJSON)
        let first = try XCTUnwrap(series.episodes.first)
        XCTAssertTrue(first.isPlayable)
        XCTAssertEqual(first.route, .video(slug: "lumo-matthew-1-1-2-23"))
        XCTAssertEqual(first.durationSeconds, 581)
    }

    func testMissingVideoProjectsToNil() throws {
        let data = try JSONDecoder().decode(
            SeriesBySlugData.self, from: Data(#"{"videoBySlug":null}"#.utf8)
        )
        XCTAssertNil(SeriesProjection.project(data))
    }

    // MARK: - The nested-series case

    /// Straight from production: `lumo` is a COLLECTION whose six children are
    /// four COLLECTIONs, a SHORT_FILM, and a SERIES. Routing those collections
    /// to the watch screen would reproduce exactly the dead end this whole unit
    /// exists to remove — so an episode card's destination is decided by the
    /// CHILD's label, never by the parent's and never by playability.
    func testANestedCollectionChildRoutesToSeriesNotWatch() throws {
        let json = """
        {"videoBySlug":{
          "id":"cmokmpjtw0ofhqsccozenpulr","slug":"lumo","label":"COLLECTION",
          "images":[],"locales":[{"title":"LUMO","description":null,"snippet":null}],
          "children":[
            {"order":1,"child":{"id":"m","slug":"lumo-the-gospel-of-matthew","label":"COLLECTION",
              "muxPlaybackId":null,"durationSeconds":null,"images":[],"locales":[{"title":"Matthew"}]}},
            {"order":5,"child":{"id":"r","slug":"how-to-have-a-relationship-with-god","label":"SHORT_FILM",
              "muxPlaybackId":"it83nZPxY00NT02ZgX6g00nZzstVwby7oG00m2oy01RMpMH8","durationSeconds":274,
              "images":[],"locales":[{"title":"How to have a relationship with God"}]}},
            {"order":6,"child":{"id":"a","slug":"lumo-acts-of-the-apostles","label":"SERIES",
              "muxPlaybackId":null,"durationSeconds":null,"images":[],"locales":[{"title":"Acts"}]}}
          ]}}
        """
        let series = try project(json)
        let expected: [Route?] = [
            .series(slug: "lumo-the-gospel-of-matthew"),
            .video(slug: "how-to-have-a-relationship-with-god"),
            .series(slug: "lumo-acts-of-the-apostles"),
        ]
        XCTAssertEqual(series.episodes.map(\.route), expected)
    }

    /// An unplayable child is NOT an unopenable one. A collection has no
    /// playback id by design; treating "no playback id" as "inert" would hide
    /// every nested collection behind a dead card.
    func testUnplayableCollectionChildIsStillOpenable() throws {
        let json = """
        {"videoBySlug":{"id":"p","slug":"lumo","label":"COLLECTION","images":[],
          "locales":[{"title":"LUMO","description":null,"snippet":null}],
          "children":[{"order":1,"child":{"id":"m","slug":"lumo-the-gospel-of-matthew",
            "label":"COLLECTION","muxPlaybackId":null,"durationSeconds":null,
            "images":[],"locales":[{"title":"Matthew"}]}}]}}
        """
        let episode = try XCTUnwrap(project(json).episodes.first)
        XCTAssertFalse(episode.isPlayable)
        XCTAssertNotNil(episode.route, "an unplayable collection still opens its own series screen")
    }

    // MARK: - buildChildren defences

    func testRelationsWithoutAChildAreDropped() {
        let relations: [WireChildRelation] = [
            WireChildRelation(order: 1, child: nil),
            WireChildRelation(order: 2, child: child(id: "a", slug: "a")),
        ]
        let episodes = SeriesProjection.episodes(from: relations, parentID: "parent")
        XCTAssertEqual(episodes.map(\.id), ["a"])
    }

    /// Admin's inverted relation surfaces the parent among its own children.
    /// Rendering it produces a card that navigates to the screen you are on.
    func testSelfReferenceIsDropped() {
        let relations = [
            WireChildRelation(order: 1, child: child(id: "parent", slug: "parent")),
            WireChildRelation(order: 2, child: child(id: "a", slug: "a")),
        ]
        XCTAssertEqual(
            SeriesProjection.episodes(from: relations, parentID: "parent").map(\.id),
            ["a"]
        )
    }

    func testDuplicateChildrenAreDedupedKeepingTheFirst() {
        let relations = [
            WireChildRelation(order: 1, child: child(id: "a", slug: "first")),
            WireChildRelation(order: 2, child: child(id: "a", slug: "second")),
        ]
        let episodes = SeriesProjection.episodes(from: relations, parentID: nil)
        XCTAssertEqual(episodes.count, 1)
        XCTAssertEqual(episodes.first?.slug, "first")
    }

    /// THE discriminating test for the tie-break. `sorted(by:)` is documented
    /// as not guaranteed stable, and every relation in an unordered series
    /// ties, so the rail could reshuffle under a focused card. Asserting on the
    /// comparator rather than on sorted output is deliberate: falsified by hand
    /// on 2026-08-12, deleting the tie-break from `episodes(from:)` left the
    /// whole end-to-end suite GREEN, because today's stdlib sort happens to be
    /// stable. Only this assertion goes red.
    func testTiedOrdersFallBackToWirePosition() {
        XCTAssertTrue(SeriesProjection.relationPrecedes((offset: 0, order: nil), (offset: 1, order: nil)))
        XCTAssertFalse(SeriesProjection.relationPrecedes((offset: 1, order: nil), (offset: 0, order: nil)))
        XCTAssertTrue(SeriesProjection.relationPrecedes((offset: 0, order: 7), (offset: 1, order: 7)))
    }

    /// `order` outranks wire position — a relation that arrives second but is
    /// ordered first sorts first.
    func testRelationOrderOutranksWirePosition() {
        XCTAssertTrue(SeriesProjection.relationPrecedes((offset: 5, order: 1), (offset: 0, order: 2)))
        XCTAssertFalse(SeriesProjection.relationPrecedes((offset: 0, order: 2), (offset: 5, order: 1)))
    }

    /// The end-to-end companion. It pins the observable contract — an
    /// unordered series renders in wire sequence — but it CANNOT falsify the
    /// tie-break on its own (see above), so it is not the guard, only the
    /// statement of intent.
    func testTiedOrdersKeepTheirWireSequenceEndToEnd() {
        let relations = (0 ..< 12).map { index in
            WireChildRelation(order: nil, child: child(id: "c\(index)", slug: "c\(index)"))
        }
        XCTAssertEqual(
            SeriesProjection.episodes(from: relations, parentID: nil).map(\.id),
            (0 ..< 12).map { "c\($0)" }
        )
    }

    func testChildWithoutASlugStaysAsAnInertCard() throws {
        let relations = [
            WireChildRelation(order: 1, child: child(id: "a", slug: nil))
        ]
        let episode = try XCTUnwrap(
            SeriesProjection.episodes(from: relations, parentID: nil).first
        )
        // Kept, not dropped: tvOS navigates by focus targets, so a hole in the
        // rail is a dead swipe. Inert on select, focusable on screen.
        XCTAssertEqual(episode.id, "a")
        XCTAssertNil(episode.route)
    }

    // MARK: - Artwork precedence

    /// FIELD-major, image-minor: the second entry's `thumbnail` must not beat
    /// the first entry's cinematic art, and — the case that actually breaks on
    /// screen — an entry carrying only `url` must fall through to a SIBLING's
    /// thumbnail. The bare `url` is the variant-less Cloudflare delivery base
    /// and returns HTTP 400 (verified 2026-08-12 against
    /// `imagedelivery.net/…/GOMattCollection.mobileCinematicHigh.jpg`), so
    /// ranking it above `thumbnail` renders a broken image rather than a
    /// smaller one.
    func testCinematicArtWinsAcrossImageEntries() {
        let images = [
            WireImage(url: "https://img/a.jpg", thumbnail: "https://img/a.jpg/f=jpg,w=120", mobileCinematicHigh: nil),
            WireImage(url: "https://img/b.jpg", thumbnail: nil, mobileCinematicHigh: "https://img/b.jpg/f=jpg,w=1280"),
        ]
        XCTAssertEqual(
            SeriesProjection.posterURL(from: images)?.absoluteString,
            "https://img/b.jpg/f=jpg,w=1280"
        )
    }

    func testBareURLRanksBelowThumbnailFromAnotherEntry() {
        let images = [
            WireImage(url: "https://img/bare.jpg", thumbnail: nil, mobileCinematicHigh: nil),
            WireImage(url: nil, thumbnail: "https://img/small.jpg/f=jpg,w=120", mobileCinematicHigh: nil),
        ]
        XCTAssertEqual(
            SeriesProjection.posterURL(from: images)?.absoluteString,
            "https://img/small.jpg/f=jpg,w=120"
        )
    }

    func testBareURLIsStillUsedWhenItIsAllThereIs() {
        let images = [WireImage(url: "https://img/bare.jpg", thumbnail: nil, mobileCinematicHigh: nil)]
        XCTAssertEqual(
            SeriesProjection.posterURL(from: images)?.absoluteString,
            "https://img/bare.jpg"
        )
    }

    func testNoImagesProjectsToNil() {
        XCTAssertNil(SeriesProjection.posterURL(from: nil))
        XCTAssertNil(SeriesProjection.posterURL(from: []))
    }

    // MARK: - Hero derivations

    func testLeadEpisodeSkipsUnopenableCardsWithoutDroppingThem() {
        let relations = [
            WireChildRelation(order: 1, child: child(id: "a", slug: nil)),
            WireChildRelation(order: 2, child: child(id: "b", slug: "b", playbackID: "pb")),
        ]
        let series = SeriesDetail(
            id: "s", slug: "s", label: "SERIES", title: "S", description: nil, posterURL: nil,
            episodes: SeriesProjection.episodes(from: relations, parentID: nil)
        )
        XCTAssertEqual(series.episodes.count, 2, "the unopenable card stays focusable on screen")
        XCTAssertEqual(series.leadEpisode?.id, "b")
    }

    func testTotalRuntimeIsNilWhenNoEpisodeReportsOne() throws {
        let noDurations = SeriesDetail(
            id: "s", slug: "s", label: "COLLECTION", title: "S", description: nil, posterURL: nil,
            episodes: SeriesProjection.episodes(
                from: [WireChildRelation(order: 1, child: child(id: "a", slug: "a"))],
                parentID: nil
            )
        )
        // A collection of collections carries no durations at all. "0m" would
        // read as a broken record instead of an absent value.
        XCTAssertNil(noDurations.totalDurationSeconds)

        let withDurations = try project(collectionJSON)
        XCTAssertEqual(withDurations.totalDurationSeconds, 1281)
    }

    // MARK: - Helpers

    private func child(
        id: String,
        slug: String?,
        label: String? = "SEGMENT",
        playbackID: String? = nil,
        durationSeconds: Int? = nil
    ) -> WireChildVideo {
        // Every field is set independently of `id` on purpose: a helper that
        // DERIVES slug or playback id from the id makes one fixture fail
        // several gates at once, and a test then passes for the wrong reason.
        WireChildVideo(
            id: id,
            slug: slug,
            label: label,
            muxPlaybackId: playbackID,
            durationSeconds: durationSeconds,
            images: nil,
            locales: nil
        )
    }
}

final class SeriesQueryContractTests: XCTestCase {
    /// The narrow-child law. Each child gets `muxPlaybackId` — ONE
    /// server-resolved representative id — instead of its own dub list.
    /// Projecting `dubs` per child multiplies the watch screen's 9.5MB/13s
    /// trap by the child count: admin's own schema documentation puts
    /// 61 chapters x ~2,200 dubs at ~45MB / 137k records. This test fails the
    /// moment someone "just adds languages" to the episode cards.
    func testChildrenDoNotProjectTheirDubLists() {
        let query = selection(of: SeriesQueries.seriesBySlug)
        XCTAssertFalse(query.contains("dubs"), "no child may project its dub list")
        XCTAssertFalse(query.contains("variants"), "nor under an alias")
        XCTAssertFalse(query.contains("subtitles"))
        XCTAssertFalse(query.contains("downloads"))
        XCTAssertTrue(query.contains("muxPlaybackId"), "playability still has to be knowable")
    }

    /// Routing depends on the child's own label. Dropping it from the
    /// selection would silently send every nested collection to the watch
    /// screen — the exact dead end this screen removes.
    ///
    /// ASSERTED AGAINST THE CHILD BLOCK, NEVER THE WHOLE DOCUMENT. The parent
    /// selects `label` too, so a whole-query `contains("label")` stays green
    /// when the CHILD loses its own — the guard would pass while the very bug
    /// its comment names ships. Found by mutation on 2026-08-12: deleting
    /// `label` from the child selection left the whole-query form passing and
    /// turns this form red.
    func testChildrenCarryTheirOwnLabel() throws {
        let query = selection(of: SeriesQueries.seriesBySlug)
        XCTAssertTrue(query.contains("children"))
        // `order` belongs to the RELATION, so it sits outside the child block.
        XCTAssertTrue(query.contains("order"))

        let child = try childSelection(of: query)
        XCTAssertTrue(
            child.contains("label"),
            "a child that cannot state its own shape routes every nested collection to the watch dead end"
        )
        XCTAssertTrue(child.contains("slug"), "a child with no slug cannot be opened at all")
        XCTAssertTrue(child.contains("muxPlaybackId"), "playability is decided per child")
        XCTAssertTrue(child.contains("durationSeconds"))
    }

    // MARK: - Helpers

    /// The document with its `#` comments stripped. Every contract assertion
    /// here reads the SELECTION — a field name that appears only in the prose
    /// explaining the selection must neither satisfy a `contains` nor trip a
    /// `does not contain`.
    private func selection(of query: String) -> String {
        query
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false)[0] }
            .joined(separator: "\n")
    }

    /// The `child { … }` block alone, found by brace matching so the assertion
    /// cannot accidentally read a parent-level field.
    private func childSelection(of query: String) throws -> String {
        let open = try XCTUnwrap(
            query.range(of: "child {"),
            "the query must still select children { child { … } }"
        )
        var depth = 1
        var index = open.upperBound
        while index < query.endIndex, depth > 0 {
            switch query[index] {
            case "{": depth += 1
            case "}": depth -= 1
            default: break
            }
            if depth == 0 { break }
            index = query.index(after: index)
        }
        XCTAssertEqual(depth, 0, "unbalanced braces in the child selection")
        return String(query[open.upperBound ..< index])
    }
}
