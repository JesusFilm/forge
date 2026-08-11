import XCTest
@testable import JesusFilmTV

final class DefaultDubTests: XCTestCase {
    private func dub(_ slug: String, _ bcp47: String, name: String? = nil) -> Dub {
        Dub(
            id: "id-\(slug)",
            languageSlug: slug,
            bcp47: bcp47,
            displayName: name ?? slug.capitalized,
            hls: "https://stream.mux.com/x.m3u8",
            playbackID: "pb\(slug)",
            durationSeconds: 100
        )
    }

    func testPreferenceWinsOverEverything() {
        let dubs = [dub("english", "en"), dub("korean", "ko"), dub("thai", "th")]
        XCTAssertEqual(
            DefaultDub.resolve(
                dubs: dubs, preferredLanguageSlug: "thai",
                deviceBcp47: "ko", videoPrimaryBcp47: "en"
            )?.languageSlug,
            "thai"
        )
    }

    /// The collision this rule exists for. `ko-kmr` shares a prefix with `ko`
    /// and `en-nai` with `en`; matching a PREFERENCE on the prefix would hand
    /// the viewer a language they never chose. Preferences are exact on the
    /// stable slug; only the device/primary/English rungs use prefixes.
    func testPreferenceIsExactOnSlugNeverAPrefix() {
        let dubs = [dub("korean-kmr", "ko-kmr"), dub("korean", "ko")]
        XCTAssertNil(
            DefaultDub.resolve(
                dubs: dubs, preferredLanguageSlug: "ko",
                deviceBcp47: nil, videoPrimaryBcp47: nil
            ).flatMap { $0.languageSlug == "ko" ? $0 : nil },
            "a preference of 'ko' must not match the slug 'korean' or 'korean-kmr'"
        )
    }

    func testFallsThroughDeviceThenPrimaryThenEnglishThenFirst() {
        let dubs = [dub("thai", "th"), dub("english", "en"), dub("korean", "ko")]

        // Device locale, when the preference misses.
        XCTAssertEqual(
            DefaultDub.resolve(
                dubs: dubs, preferredLanguageSlug: "absent",
                deviceBcp47: "ko-KR", videoPrimaryBcp47: "th"
            )?.languageSlug,
            "korean"
        )
        // Video primary, when device misses.
        XCTAssertEqual(
            DefaultDub.resolve(
                dubs: dubs, preferredLanguageSlug: nil,
                deviceBcp47: "de", videoPrimaryBcp47: "th"
            )?.languageSlug,
            "thai"
        )
        // English, when both miss.
        XCTAssertEqual(
            DefaultDub.resolve(
                dubs: dubs, preferredLanguageSlug: nil,
                deviceBcp47: "de", videoPrimaryBcp47: "fr"
            )?.languageSlug,
            "english"
        )
        // First, when everything misses.
        let noEnglish = [dub("thai", "th"), dub("korean", "ko")]
        XCTAssertEqual(
            DefaultDub.resolve(
                dubs: noEnglish, preferredLanguageSlug: nil,
                deviceBcp47: "de", videoPrimaryBcp47: "fr"
            )?.languageSlug,
            "thai"
        )
    }

    func testEmptyListResolvesToNothingRatherThanCrashing() {
        XCTAssertNil(
            DefaultDub.resolve(
                dubs: [], preferredLanguageSlug: "x",
                deviceBcp47: "en", videoPrimaryBcp47: "en"
            )
        )
    }

    /// Sorting is for DISPLAY only. Selection must never depend on it, or a
    /// locale-sensitive comparison could change which dub a choice refers to.
    func testDisplaySortDoesNotChangeMembership() {
        let dubs = [dub("thai", "th", name: "Thai"), dub("english", "en", name: "English")]
        let sorted = DefaultDub.sortedForDisplay(dubs)
        XCTAssertEqual(sorted.map(\.displayName), ["English", "Thai"])
        XCTAssertEqual(Set(sorted.map(\.id)), Set(dubs.map(\.id)))
    }
}

final class WatchProjectionTests: XCTestCase {
    /// Shaped like production: `language.name` is a JSONB locale map, and
    /// unpublished dubs exist alongside published ones.
    private let json = """
    {"videoBySlug":{
      "id":"v1","slug":"jesus","label":"FEATURE_FILM",
      "images":[{"url":null,"thumbnail":"https://img/t.jpg","mobileCinematicHigh":"https://img/c.jpg"}],
      "primaryLanguage":{"bcp47":"en"},
      "locales":[{"title":"JESUS","description":"A film.","snippet":null}],
      "variants":[
        {"id":"d1","slug":"english","published":true,"hls":"https://stream.mux.com/a.m3u8","duration":7800,
         "language":{"bcp47":"en","slug":"english","name":{"en":"English"}},"muxVideo":{"playbackId":"pbA"}},
        {"id":"d2","slug":"tera","published":true,"hls":"https://stream.mux.com/b.m3u8","duration":7800,
         "language":{"bcp47":"ttr","slug":"tera","name":{"en":"Tera"}},"muxVideo":{"playbackId":"pbB"}},
        {"id":"d3","slug":"draft","published":false,"hls":"https://stream.mux.com/c.m3u8","duration":10,
         "language":{"bcp47":"xx","slug":"draft","name":{"en":"Draft"}},"muxVideo":{"playbackId":"pbC"}}
      ]}}
    """

    func testProjectsPublishedDubsOnly() throws {
        let data = try JSONDecoder().decode(VideoBySlugData.self, from: Data(json.utf8))
        let video = try XCTUnwrap(WatchProjection.project(data))
        XCTAssertEqual(video.title, "JESUS")
        XCTAssertEqual(video.dubs.count, 2, "the unpublished dub must be dropped")
        XCTAssertFalse(video.dubs.contains { $0.languageSlug == "draft" })
    }

    func testResolvesTheJsonbLocaleNameMap() throws {
        let data = try JSONDecoder().decode(VideoBySlugData.self, from: Data(json.utf8))
        let video = try XCTUnwrap(WatchProjection.project(data))
        // `name` arrives as {"en": "Tera"}, not a string — rendering the raw
        // map would put a dictionary literal on screen.
        XCTAssertEqual(video.dubs.map(\.displayName).sorted(), ["English", "Tera"])
    }

    func testPosterPrefersCinematicOverThumbnail() throws {
        let data = try JSONDecoder().decode(VideoBySlugData.self, from: Data(json.utf8))
        let video = try XCTUnwrap(WatchProjection.project(data))
        XCTAssertEqual(video.posterURL?.absoluteString, "https://img/c.jpg")
    }

    func testMissingVideoProjectsToNil() throws {
        let data = try JSONDecoder().decode(
            VideoBySlugData.self, from: Data(#"{"videoBySlug":null}"#.utf8)
        )
        XCTAssertNil(WatchProjection.project(data))
    }

    func testSubtitlesWithoutASourceAreDropped() throws {
        let json = """
        {"videoDub":{"id":"d1","downloads":[],"videoEdition":{"subtitles":[
          {"id":"s1","language":{"slug":"english","name":{"en":"English"},"bcp47":"en"},
           "vttSrc":"https://cdn/en.vtt","primary":true},
          {"id":"s2","language":{"slug":"thai","name":{"en":"Thai"},"bcp47":"th"},
           "vttSrc":null,"primary":false}
        ]}}}
        """
        let data = try JSONDecoder().decode(VideoDubData.self, from: Data(json.utf8))
        let subtitles = WatchProjection.projectSubtitles(data)
        XCTAssertEqual(subtitles.count, 1, "a subtitle with no vttSrc cannot render")
        XCTAssertEqual(subtitles.first?.displayName, "English")
    }
}

final class QueryContractTests: XCTestCase {
    /// The two-query split is a PERFORMANCE LAW: inlining per-dub subtitles
    /// and downloads made RN's payload ~9.5MB and its resolver ~13s at 2,259
    /// dubs. `jesus` currently returns 2,291. This test fails the moment
    /// someone "simplifies" the split away.
    func testVideoQueryDoesNotInlinePerDubMedia() {
        let q = VideoQueries.videoBySlug
        XCTAssertFalse(q.contains("subtitles"), "per-dub subtitles must not be inlined")
        XCTAssertFalse(q.contains("downloads"), "per-dub downloads must not be inlined")
        XCTAssertTrue(q.contains("variants: dubs"), "the dub list itself is still required")
    }

    func testDubMediaQueryFetchesExactlyTheOmittedFields() {
        let q = VideoQueries.videoDub
        XCTAssertTrue(q.contains("subtitles"))
        XCTAssertTrue(q.contains("downloads"))
        XCTAssertTrue(q.contains("vttSrc"))
    }
}
