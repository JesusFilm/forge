import XCTest
@testable import JesusFilmTV

// ZERO PII is a product law. Every case below is a leak that would otherwise
// be invisible: telemetry is write-only from the app's side, so a field that
// carries a user's email or a live device code is discovered by an auditor
// reading a dashboard months later, not by anyone using the TV.
//
// Behaviors verified empirically against the real Foundation regex engine
// before these assertions were written (2026-08-12), not derived from reading
// the patterns.

/// Shared test sink. Not private — `ShowcaseTests` asserts on session events
/// through this same recorder.
final class RecordingTelemetrySink: TelemetrySink {
    private(set) var events: [TelemetryEvent] = []

    func record(_ event: TelemetryEvent) {
        events.append(event)
    }

    var rendered: String {
        events.map(TelemetryFormatter.line).joined(separator: " ")
    }
}

private func text(_ value: TelemetryValue?) -> String? {
    switch value {
    case .text(let string), .identifier(let string): return string
    default: return nil
    }
}

// MARK: - Sanitizer

final class TelemetrySanitizerTests: XCTestCase {
    /// The query string is where the secrets are: a signed Mux URL, and the
    /// device-grant verification link that carries the live `user_code`. The
    /// origin and path stay, because "which host failed" is the whole
    /// diagnostic value of an error message.
    func testStripsQueryStringsButKeepsTheOriginAndPath() {
        XCTAssertEqual(
            TelemetrySanitizer.sanitize(
                "failed to load https://stream.mux.com/abc.m3u8?token=abc123 at 12s"
            ),
            "failed to load https://stream.mux.com/abc.m3u8?[redacted] at 12s"
        )
        XCTAssertEqual(
            TelemetrySanitizer.sanitize("open https://auth.jesusfilm.org/device?user_code=WDJB-MJHT"),
            "open https://auth.jesusfilm.org/device?[redacted]"
        )
    }

    func testCapsLength() {
        let long = String(repeating: "word ", count: 100)
        XCTAssertEqual(long.count, 500)
        XCTAssertEqual(TelemetrySanitizer.sanitize(long).count, TelemetrySanitizer.maxLength)
    }

    /// The order matters and this is the case that proves it. Capping first
    /// would cut `user@example.com` down to `user@exa`, which no longer
    /// matches the email pattern — so the fragment would survive into the log.
    func testRedactionRunsBeforeTheLengthCap() {
        let filler = String(repeating: "ab ", count: 64)
        let sanitized = TelemetrySanitizer.sanitize(filler + "user@example.com")

        XCTAssertEqual(sanitized.count, TelemetrySanitizer.maxLength)
        XCTAssertFalse(sanitized.contains("@"))
        XCTAssertFalse(sanitized.contains("example.com"))
    }

    func testCollapsesNewlinesSoOneEventStaysOneLogLine() {
        XCTAssertEqual(
            TelemetrySanitizer.sanitize("line one\nline two\r\tthree"),
            "line one line two three"
        )
    }

    func testRedactsEmailShapedStrings() {
        XCTAssertEqual(
            TelemetrySanitizer.sanitize("contact user@example.com now"),
            "contact [redacted-email] now"
        )
    }

    func testRedactsTokenShapedStrings() {
        XCTAssertEqual(
            TelemetrySanitizer.sanitize("Authorization: Bearer abc123def456ghi"),
            "Authorization: Bearer [redacted-token]"
        )
        // A JWT id token embeds the viewer's email in its payload segment, so
        // the shape alone has to be enough to condemn it.
        XCTAssertEqual(
            TelemetrySanitizer.sanitize("id_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcSIG"),
            "id_token=[redacted-token]"
        )
        XCTAssertEqual(
            TelemetrySanitizer.sanitize("key jfp_search_abc_def rejected"),
            "key [redacted-token] rejected"
        )
    }

    /// The RFC 8628 user code IS a credential for the seconds it is on screen.
    /// A sign-in error string that quotes it back is the exemplar this rule
    /// exists for.
    func testRedactsTheDeviceGrantUserCode() {
        XCTAssertEqual(
            TelemetrySanitizer.sanitize("enter code WDJB-MJHT to continue"),
            "enter code [redacted-code] to continue"
        )
    }

    /// Backstop for shapes nobody enumerated.
    func testRedactsLongOpaqueRunsInFreeText() {
        XCTAssertEqual(
            TelemetrySanitizer.sanitize("sig=0123456789abcdef0123456789abcdef01234567 done"),
            "sig=[redacted-token] done"
        )
    }

    // MARK: Identifiers

    /// The reason `.identifier` is a separate case: a real Mux playback id is
    /// itself a 46-character opaque run, which is exactly what the free-text
    /// backstop condemns. Content id is a required QoE field, so it needs a
    /// path the backstop does not touch.
    func testPublicCatalogIdentityPassesThrough() {
        let playbackID = "2TwRLgQliZujOs4gBKZoKsfK9D00mHp6mx00oJgfcS00xA"
        XCTAssertEqual(playbackID.count, 46)
        XCTAssertEqual(TelemetrySanitizer.sanitizeIdentifier(playbackID), playbackID)
        XCTAssertEqual(TelemetrySanitizer.sanitizeIdentifier("birth-of-jesus"), "birth-of-jesus")

        // …and the same value in free text IS condemned, which is the
        // asymmetry stated.
        XCTAssertEqual(TelemetrySanitizer.sanitize(playbackID), "[redacted-token]")
    }

    func testIdentifierRejectsAnythingThatIsNotCatalogIdentity() {
        // Fails the character allowlist.
        XCTAssertEqual(TelemetrySanitizer.sanitizeIdentifier("user@example.com"), "[redacted]")
        XCTAssertEqual(TelemetrySanitizer.sanitizeIdentifier("Bearer abc"), "[redacted]")
        // Passes the allowlist (dots and dashes are legal in a slug) but is
        // caught by the PII rules — the allowlist must not become a bypass.
        XCTAssertEqual(
            TelemetrySanitizer.sanitizeIdentifier("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcSIG"),
            "[redacted-token]"
        )
        XCTAssertEqual(TelemetrySanitizer.sanitizeIdentifier("WDJB-MJHT"), "[redacted-code]")
        // Longer than any catalog id.
        XCTAssertEqual(
            TelemetrySanitizer.sanitizeIdentifier(String(repeating: "a1", count: 32)),
            "[redacted]"
        )
    }

    func testSymbolsAreBoundedLowercaseAndPunctuationFree() {
        XCTAssertEqual(TelemetrySanitizer.symbol("Content-Type"), "content_type")
        XCTAssertEqual(TelemetrySanitizer.symbol("watch_search"), "watch_search")
        XCTAssertEqual(TelemetrySanitizer.symbol(""), "")
        XCTAssertEqual(TelemetrySanitizer.symbol(String(repeating: "x", count: 200)).count, 64)
    }
}

// MARK: - Event construction

final class TelemetryEventTests: XCTestCase {
    /// The law is enforced STRUCTURALLY: there is no path that records an
    /// unsanitized string, so a future call site cannot leak by forgetting.
    /// Feed a payload every PII shape and assert none of it survives.
    func testNoEventPayloadCanCarryAnEmailOrATokenShapedString() {
        let event = TelemetryEvent(
            name: "content_action",
            attributes: [
                "reason": .text("sign-in failed for user@example.com with code WDJB-MJHT"),
                "detail": .text("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcSIG"),
                "url": .text("https://auth.jesusfilm.org/device?user_code=WDJB-MJHT"),
                "content_id": .identifier("someone@example.com"),
                "other_id": .identifier("WDJB-MJHT"),
            ]
        )
        let rendered = TelemetryFormatter.line(event)

        XCTAssertFalse(rendered.contains("@"), rendered)
        XCTAssertFalse(rendered.contains("example.com"), rendered)
        XCTAssertFalse(rendered.contains("WDJB-MJHT"), rendered)
        XCTAssertFalse(rendered.contains("eyJ"), rendered)
        XCTAssertEqual(text(event.attributes["content_id"]), "[redacted]")
        XCTAssertEqual(text(event.attributes["other_id"]), "[redacted-code]")
    }

    func testNumericAttributesArePreservedExactly() {
        let event = TelemetryEvent(
            name: "video_qoe",
            attributes: ["ttff_ms": .int(1234), "rate": .double(0.5), "muted": .bool(true)]
        )
        XCTAssertEqual(event.attributes["ttff_ms"], .int(1234))
        XCTAssertEqual(
            TelemetryFormatter.line(event),
            "event=video_qoe muted=true rate=0.500 ttff_ms=1234"
        )
    }

    func testNamesAndKeysAreNormalizedAndEmptyKeysDropped() {
        let event = TelemetryEvent(
            name: "Watch Search",
            attributes: ["Result-Count": .int(3), "!!!": .int(1)]
        )
        XCTAssertEqual(event.name, "watch_search")
        XCTAssertEqual(event.attributes["result_count"], .int(3))
        // "!!!" sanitizes to "___" and then trims to empty — a key with no
        // meaning would collide with every other such key.
        XCTAssertEqual(event.attributes.count, 1)
    }

    /// Sorted keys so two records of one event are diffable; dictionary order
    /// is otherwise unspecified and shuffles between runs.
    func testFormatterSortsKeysAndQuotesOnlyWhenNeeded() {
        let event = TelemetryEvent(
            name: "route_view",
            attributes: ["zulu": .text("plain"), "alpha": .text("two words")]
        )
        XCTAssertEqual(
            TelemetryFormatter.line(event),
            #"event=route_view alpha="two words" zulu=plain"#
        )
    }
}

// MARK: - Recorder and signals

final class TelemetryRecorderTests: XCTestCase {
    func testRecordsToTheConfiguredSink() {
        let sink = RecordingTelemetrySink()
        let telemetry = Telemetry(sink: sink)
        telemetry.record("route_view", ["route": .text("home")])
        XCTAssertEqual(sink.events.map(\.name), ["route_view"])
    }

    /// Route names are PATTERNS. A path-shaped view name turns a navigation
    /// log into a viewing history, and it makes view cardinality unbounded.
    func testRouteNamesCarryNoSlug() {
        XCTAssertEqual(TelemetryRoute.name(for: .video(slug: "birth-of-jesus")), "video/[slug]")
        XCTAssertEqual(TelemetryRoute.name(for: .series(slug: "lumo")), "series/[slug]")
        XCTAssertEqual(
            TelemetryRoute.name(for: .experience(slug: "tv-showcase")), "experience/[slug]"
        )
    }

    /// A typed search string is user text by definition — the one field on
    /// that screen that can hold a name, an address, or a confession. Only its
    /// SHAPE crosses the wire.
    func testSearchSignalCarriesShapeNeverTheQuery() {
        let sink = RecordingTelemetrySink()
        let telemetry = Telemetry(sink: sink)
        telemetry.searchPerformed(queryLength: 17, resultCount: 0, latencyMs: 240)

        let event = sink.events[0]
        XCTAssertEqual(event.name, "watch_search")
        XCTAssertEqual(event.attributes["query_length"], .int(17))
        XCTAssertEqual(text(event.attributes["outcome"]), "no_result")
        XCTAssertNil(event.attributes["query"], "there is no field for the query text")

        telemetry.searchPerformed(queryLength: 4, resultCount: 12, latencyMs: nil)
        XCTAssertEqual(text(sink.events[1].attributes["outcome"]), "completed")
        XCTAssertNil(sink.events[1].attributes["latency_ms"])
    }

    func testContentActionRedactsAnIdThatIsNotCatalogIdentity() {
        let sink = RecordingTelemetrySink()
        let telemetry = Telemetry(sink: sink)
        telemetry.contentAction(
            "open", contentType: "video", contentID: "viewer@example.com", position: 3
        )
        XCTAssertEqual(text(sink.events[0].attributes["content_id"]), "[redacted]")
        XCTAssertEqual(sink.events[0].attributes["position"], .int(3))
    }
}

// MARK: - Playback QoE

final class PlaybackQoESessionTests: XCTestCase {
    /// A clock that only moves when a test moves it.
    private final class Ticker {
        var now = Date(timeIntervalSinceReferenceDate: 0)
        func advance(_ seconds: TimeInterval) { now.addTimeInterval(seconds) }
    }

    func testRecordsTimeToFirstFrameExactlyOnce() {
        let ticker = Ticker()
        let session = PlaybackQoESession(contentID: "pbAbc", now: { ticker.now })

        ticker.advance(1.5)
        XCTAssertEqual(session.firstFrame(), 1500)
        // A stall that resolves must not overwrite the original: the metric is
        // "how long until the viewer saw something", and that happens once.
        ticker.advance(10)
        XCTAssertNil(session.firstFrame())

        let summary = session.finalize(.ended)
        XCTAssertEqual(summary?.ttffMs, 1500)
    }

    func testNeverStartedPlaybackReportsNoFirstFrame() {
        let session = PlaybackQoESession(contentID: "pbAbc")
        XCTAssertNil(session.finalize(.abandoned)?.ttffMs)
    }

    func testAccumulatesStallsErrorsAndPosition() {
        let session = PlaybackQoESession(contentID: "pbAbc")
        session.rebuffered()
        session.rebuffered()
        session.failed("boom")
        session.progressed(to: 42.5)
        // Nonsense positions are ignored rather than reported as watched time.
        session.progressed(to: -1)
        session.progressed(to: .infinity)

        let summary = session.finalize(.ended)
        XCTAssertEqual(summary?.rebufferCount, 2)
        XCTAssertEqual(summary?.errorCount, 1)
        XCTAssertEqual(summary?.watchedMs, 42500)
        XCTAssertEqual(summary?.reason, .ended)
    }

    /// tvOS teardown paths overlap — `onDisappear`, a scene-phase change, and
    /// a dismiss can all fire for one exit — so a second finalize must be
    /// silent rather than double-count the session.
    func testFinalizesExactlyOnce() {
        let session = PlaybackQoESession(contentID: "pbAbc")
        XCTAssertNotNil(session.finalize(.ended))
        XCTAssertNil(session.finalize(.abandoned))
    }

    /// A native player error can embed the signed Mux URL it failed on.
    func testErrorMessagesAreSanitizedBeforeTheyAreEvenStored() {
        let session = PlaybackQoESession(contentID: "pbAbc")
        session.failed("CoreMediaErrorDomain -12881 https://stream.mux.com/x.m3u8?token=secret")
        let summary = session.finalize(.abandoned)
        XCTAssertEqual(
            summary?.lastError,
            "CoreMediaErrorDomain -12881 https://stream.mux.com/x.m3u8?[redacted]"
        )
    }

    func testTheEmittedEventCarriesOnlyNumbersEnumsAndAPublicId() {
        let summary = PlaybackQoESummary(
            contentID: "2TwRLgQliZujOs4gBKZoKsfK9D00mHp6mx00oJgfcS00xA",
            ttffMs: 900,
            rebufferCount: 1,
            errorCount: 0,
            lastError: nil,
            reason: .ended,
            watchedMs: 30000
        )
        let line = TelemetryFormatter.line(summary.event)
        XCTAssertTrue(line.hasPrefix("event=video_qoe "))
        XCTAssertTrue(
            line.contains("content_id=2TwRLgQliZujOs4gBKZoKsfK9D00mHp6mx00oJgfcS00xA"),
            "the playback id is the QoE contract's content identity"
        )
        XCTAssertTrue(line.contains("ttff_ms=900"))
        XCTAssertTrue(line.contains("reason=ended"))
        XCTAssertFalse(line.contains("title"))
    }

    /// Without the swap clause every dub change and every showcase language
    /// hop would file itself as a stall, and the metric would be measuring the
    /// app's own behavior instead of the network's.
    func testRebufferGateIgnoresStartupAndSourceSwaps() {
        XCTAssertFalse(shouldCountRebuffer(hasStarted: false, isSourceSwapping: false))
        XCTAssertFalse(shouldCountRebuffer(hasStarted: true, isSourceSwapping: true))
        XCTAssertTrue(shouldCountRebuffer(hasStarted: true, isSourceSwapping: false))
    }
}
