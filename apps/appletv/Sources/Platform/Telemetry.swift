import Foundation
import os

// Telemetry: a thin, dependency-free event recorder behind a pluggable sink.
//
// This is the SEAM, not an integration. `dd-sdk-ios` is deliberately absent:
// the parity plan records its tvOS support as an unverified item, and a
// dependency added on a guess is harder to remove than one never added. When
// a vendor SDK is chosen it becomes one more `TelemetrySink` conformance and
// nothing above this file changes.
//
// ZERO PII IS A PRODUCT LAW, NOT A CONVENTION (parity plan, Finding 3): no
// user id, email, token, or viewer id may ever ride an event. That law is
// enforced STRUCTURALLY here — every string is sanitized inside
// `TelemetryEvent.init`, so there is no call path that records an unsanitized
// string, and a future call site cannot opt out by forgetting.

// MARK: - Values

/// One attribute on an event.
///
/// Two string cases, deliberately, because they carry opposite trust:
///
/// - `.text` is FREE-FORM (a player's error message, a failure reason). It may
///   have been composed by a framework out of URLs, headers, or response
///   bodies, so it runs the full redaction pass including a generic
///   long-opaque-run rule.
/// - `.identifier` is a value the app KNOWS is public catalog identity — a Mux
///   playback id, a content slug. It is checked against a strict character
///   allowlist and replaced wholesale when it fails, because the generic
///   long-run rule cannot coexist with a 46-character playback id.
///
/// Boundary worth stating: a bare 40-character opaque secret passed as
/// `.identifier` is indistinguishable from a playback id and would survive.
/// The mitigation is that no user-supplied or credential-derived string is
/// ever routed to `.identifier` — call sites pass playback ids and slugs.
enum TelemetryValue: Equatable {
    case text(String)
    case identifier(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
}

/// A recorded event. Sanitization happens in `init`, so an event value is
/// safe by construction — holding one is proof its payload was scrubbed.
struct TelemetryEvent: Equatable {
    let name: String
    let attributes: [String: TelemetryValue]

    init(name: String, attributes: [String: TelemetryValue] = [:]) {
        self.name = TelemetrySanitizer.symbol(name)
        var scrubbed: [String: TelemetryValue] = [:]
        for (key, value) in attributes {
            let safeKey = TelemetrySanitizer.symbol(key)
            // A key that sanitizes to nothing has no meaning downstream and
            // would silently collide with every other such key.
            guard !safeKey.isEmpty else { continue }
            scrubbed[safeKey] = TelemetrySanitizer.scrub(value)
        }
        self.attributes = scrubbed
    }
}

// MARK: - Sanitizer

enum TelemetrySanitizer {
    /// Long enough for a useful error message, short enough that a runaway
    /// string cannot turn one log line into a payload.
    static let maxLength = 200

    /// Public catalog identity: Mux playback ids run to 46 characters, so the
    /// cap sits just above them and well below any credential worth carrying.
    static let maxIdentifierLength = 48

    static let redactedText = "[redacted]"

    /// Ordered redaction for anything that could be a credential or a person.
    /// Order is load-bearing: the URL rule runs before the token rules so a
    /// signed query string is gone before anything tries to classify what was
    /// inside it.
    private static let piiRules: [(pattern: String, template: String)] = [
        // Query strings and fragments carry the secrets: `?token=…`,
        // `?user_code=WDJB-MJHT` on the device-grant verification URL. The
        // origin and path stay, because "which host failed" is the whole
        // diagnostic value of an error message.
        (#"(?i)(https?://[^\s?#]+)[?#]\S*"#, "$1?[redacted]"),
        (#"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"#, "[redacted-email]"),
        (#"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+"#, "Bearer [redacted-token]"),
        // A JWT is recognizable by shape alone, which is the point — an id
        // token embeds the viewer's email in its payload segment.
        (#"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*"#, "[redacted-token]"),
        (#"\b(?:jfp|sk|pk|ghp|xox[abprs])_[A-Za-z0-9_-]+"#, "[redacted-token]"),
        // RFC 8628 user code, as apps/auth issues and SignInView displays it.
        // The live code IS a credential for the seconds it is on screen — an
        // unredacted sign-in error string is the exemplar this rule exists for.
        (#"\b[A-Z0-9]{4}-[A-Z0-9]{4}\b"#, "[redacted-code]"),
    ]

    /// Backstop for token shapes nobody enumerated: 40 characters is above
    /// every human-authored word.
    ///
    /// Applied to `.text` ONLY, and that asymmetry is the whole reason
    /// `.identifier` exists as a separate case: a Mux playback id is itself a
    /// 46-character opaque run, so this rule cannot tell one from a secret.
    /// Free text gets the backstop and loses the odd id; catalog identity gets
    /// a strict allowlist instead.
    private static let opaqueRunRule = (
        pattern: #"\b[A-Za-z0-9_-]{40,}\b"#, template: "[redacted-token]"
    )

    /// Newlines first: a flat `key=value` log line is one line by contract, and
    /// an embedded newline both breaks the parse and can smuggle a response
    /// fragment past a reader skimming the first line.
    private static func collapseControlCharacters(_ raw: String) -> String {
        raw.replacingOccurrences(
            of: #"[\p{Cc}\p{Cf}]+"#, with: " ", options: .regularExpression
        )
    }

    private static func applyPIIRules(_ input: String) -> String {
        var value = input
        for rule in piiRules {
            value = value.replacingOccurrences(
                of: rule.pattern, with: rule.template, options: .regularExpression
            )
        }
        return value
    }

    /// Full redaction pass for free-form text.
    static func sanitize(_ raw: String) -> String {
        var value = applyPIIRules(collapseControlCharacters(raw))
        value = value.replacingOccurrences(
            of: opaqueRunRule.pattern,
            with: opaqueRunRule.template,
            options: .regularExpression
        )
        value = value.trimmingCharacters(in: .whitespaces)
        // Capping LAST, never first: truncating before redaction cuts a token
        // in half and leaves the half that no longer matches its own pattern —
        // `user@exa` survives a prefix-cap that a full email would not.
        if value.count > maxLength {
            value = String(value.prefix(maxLength))
        }
        return value
    }

    /// Public catalog identity, or nothing. An allowlist rather than a
    /// denylist because the set of legal shapes here is tiny and known: a
    /// slug, or a Mux playback id.
    static func sanitizeIdentifier(_ raw: String) -> String {
        guard raw.count <= maxIdentifierLength,
              raw.range(of: #"\A[A-Za-z0-9][A-Za-z0-9_.-]*\z"#, options: .regularExpression) != nil
        else {
            return redactedText
        }
        // The allowlist admits some credential shapes — a JWT and an RFC 8628
        // user code are both dots-and-dashes over alphanumerics — so the PII
        // rules still run. Without them the allowlist would be a bypass.
        let scrubbed = applyPIIRules(collapseControlCharacters(raw))
            .trimmingCharacters(in: .whitespaces)
        return scrubbed.isEmpty ? redactedText : scrubbed
    }

    /// Event and attribute names: lowercase snake/dot symbols only. These are
    /// constants at every call site, so anything else is a bug, not user data.
    static func symbol(_ raw: String) -> String {
        String(
            raw.lowercased().prefix(64).map { character in
                character.isLetter || character.isNumber || character == "_" || character == "."
                    ? character
                    : "_"
            }
        )
        .trimmingCharacters(in: CharacterSet(charactersIn: "_"))
    }

    static func scrub(_ value: TelemetryValue) -> TelemetryValue {
        switch value {
        case .text(let raw): return .text(sanitize(raw))
        case .identifier(let raw): return .identifier(sanitizeIdentifier(raw))
        case .int, .double, .bool: return value
        }
    }
}

// MARK: - Sinks

/// Where events go. One method, so a vendor SDK, a batching uploader, and a
/// test double are all the same amount of work.
protocol TelemetrySink: AnyObject {
    func record(_ event: TelemetryEvent)
}

/// The default. Telemetry that is not provisioned must cost nothing and, more
/// importantly, must not be a reason the app behaves differently.
final class NoopTelemetrySink: TelemetrySink {
    func record(_ event: TelemetryEvent) {}
}

/// Unified logging sink — visible in Console.app against a real Apple TV
/// without any backend at all, which is the only observability this app has
/// on device today.
final class OSLogTelemetrySink: TelemetrySink {
    private let logger: Logger

    init(
        subsystem: String = "org.jesusfilm.forgetv.native",
        category: String = "telemetry"
    ) {
        logger = Logger(subsystem: subsystem, category: category)
    }

    func record(_ event: TelemetryEvent) {
        // `.public` is correct BECAUSE the payload is already sanitized —
        // os_log redacts dynamic strings by default, which would render every
        // field as `<private>` and make the sink useless. The privacy
        // guarantee lives in `TelemetryEvent.init`, not in the log level.
        logger.log("\(TelemetryFormatter.line(event), privacy: .public)")
    }
}

/// `event=name key=value` plain-string format — the repo's convention, and
/// the one shape Railway's logsV2 does not silence (root CLAUDE.md).
enum TelemetryFormatter {
    static func line(_ event: TelemetryEvent) -> String {
        // Sorted so two records of the same event are diffable; dictionary
        // order is otherwise unspecified and shuffles between runs.
        let pairs = event.attributes.keys.sorted().map { key in
            "\(key)=\(render(event.attributes[key]!))"
        }
        return (["event=\(event.name)"] + pairs).joined(separator: " ")
    }

    private static func render(_ value: TelemetryValue) -> String {
        switch value {
        case .text(let string), .identifier(let string):
            // Quote only when needed, so the common case stays greppable.
            return string.contains(" ") ? "\"\(string)\"" : string
        case .int(let number): return String(number)
        case .double(let number): return String(format: "%.3f", number)
        case .bool(let flag): return flag ? "true" : "false"
        }
    }
}

// MARK: - Recorder

/// The app-wide recorder. A single mutable sink behind a lock rather than an
/// actor: recording must never suspend its caller — a telemetry `await` on the
/// playback path would put emission at the mercy of the same scheduler
/// pressure it exists to measure.
final class Telemetry: @unchecked Sendable {
    static let shared = Telemetry()

    private let lock = NSLock()
    private var sink: TelemetrySink

    init(sink: TelemetrySink = NoopTelemetrySink()) {
        self.sink = sink
    }

    func configure(sink: TelemetrySink) {
        lock.lock()
        defer { lock.unlock() }
        self.sink = sink
    }

    func record(_ event: TelemetryEvent) {
        lock.lock()
        let target = sink
        lock.unlock()
        // Outside the lock: a slow sink must not serialize every other caller.
        target.record(event)
    }

    func record(_ name: String, _ attributes: [String: TelemetryValue] = [:]) {
        record(TelemetryEvent(name: name, attributes: attributes))
    }
}

// MARK: - Signals

/// The signal set, mirroring the React Native app's: route views, playback
/// QoE, search, content actions. Named constants, never interpolated strings —
/// a variable part of an event NAME is unbounded cardinality, and it is also
/// how a user's search text ends up as a metric label.
enum TelemetrySignals {
    static let routeView = "route_view"
    static let videoQoE = "video_qoe"
    static let search = "watch_search"
    static let contentAction = "content_action"
    static let showcaseStart = "showcase_start"
    static let showcaseExit = "showcase_exit"
}

/// Route names are PATTERNS, not paths: `video/[slug]`, never `video/jesus`.
/// One facet per screen keeps view cardinality bounded, and — the reason it is
/// a rule rather than a nicety — a slug is content the viewer chose, so a
/// path-shaped view name turns a navigation log into a viewing history.
enum TelemetryRoute {
    static func name(for route: Route) -> String {
        switch route {
        case .video: return "video/[slug]"
        case .series: return "series/[slug]"
        case .experience: return "experience/[slug]"
        }
    }
}

extension Telemetry {
    func routeViewed(_ name: String) {
        record(TelemetrySignals.routeView, ["route": .text(name)])
    }

    func routeViewed(_ route: Route) {
        routeViewed(TelemetryRoute.name(for: route))
    }

    /// The search signal carries the query's SHAPE, never the query. A typed
    /// search string is user text by definition — the one field on this screen
    /// that can contain a name, an address, or a confession.
    func searchPerformed(queryLength: Int, resultCount: Int, latencyMs: Int?) {
        var attributes: [String: TelemetryValue] = [
            "query_length": .int(queryLength),
            "result_count": .int(resultCount),
            "outcome": .text(resultCount == 0 ? "no_result" : "completed"),
        ]
        if let latencyMs { attributes["latency_ms"] = .int(latencyMs) }
        record(TelemetrySignals.search, attributes)
    }

    /// A viewer acting on content: opening a card, starting playback, changing
    /// language. `contentID` is public catalog identity (slug or playback id).
    func contentAction(
        _ action: String,
        contentType: String,
        contentID: String?,
        position: Int? = nil
    ) {
        var attributes: [String: TelemetryValue] = [
            "action": .text(action),
            "content_type": .text(contentType),
        ]
        if let contentID { attributes["content_id"] = .identifier(contentID) }
        if let position { attributes["position"] = .int(position) }
        record(TelemetrySignals.contentAction, attributes)
    }

    func playbackQoE(_ summary: PlaybackQoESummary) {
        record(summary.event)
    }
}

// MARK: - Playback QoE

/// Why a playback session ended.
enum PlaybackQoEReason: String, Equatable {
    /// Played to its end (or to the end of its bounded window).
    case ended
    /// The viewer left, or the screen tore down mid-play.
    case abandoned
}

/// One session's summary. Numbers, enums, and public ids only — by
/// construction there is no field a title or a viewer identity could occupy.
struct PlaybackQoESummary: Equatable {
    let contentID: String?
    /// Time to first frame. Nil when playback never started.
    let ttffMs: Int?
    let rebufferCount: Int
    let errorCount: Int
    let lastError: String?
    let reason: PlaybackQoEReason
    let watchedMs: Int?

    var event: TelemetryEvent {
        var attributes: [String: TelemetryValue] = [
            "rebuffer_count": .int(rebufferCount),
            "error_count": .int(errorCount),
            "reason": .text(reason.rawValue),
        ]
        if let contentID { attributes["content_id"] = .identifier(contentID) }
        if let ttffMs { attributes["ttff_ms"] = .int(ttffMs) }
        if let lastError { attributes["last_error"] = .text(lastError) }
        if let watchedMs { attributes["watched_ms"] = .int(watchedMs) }
        return TelemetryEvent(name: TelemetrySignals.videoQoE, attributes: attributes)
    }
}

/// Accumulates one playback session, port of `apps/tv/src/lib/videoQoe.ts`.
/// Clock-injected and player-free, so every rule below is unit-testable
/// without AVFoundation.
final class PlaybackQoESession {
    private let contentID: String?
    private let now: () -> Date
    private let startedAt: Date

    private var ttffMs: Int?
    private var firstFrameRecorded = false
    private var rebufferCount = 0
    private var errorCount = 0
    private var lastError: String?
    private var lastPositionSeconds: TimeInterval = 0
    private var finalized = false

    init(contentID: String?, now: @escaping () -> Date = Date.init) {
        self.contentID = contentID
        self.now = now
        startedAt = now()
    }

    /// Records time-to-first-frame exactly once; later calls return nil. A
    /// stall that resolves must not overwrite the original TTFF — the metric
    /// is "how long until the viewer saw something", and it happens once.
    @discardableResult
    func firstFrame() -> Int? {
        guard !firstFrameRecorded else { return nil }
        firstFrameRecorded = true
        let elapsed = now().timeIntervalSince(startedAt) * 1000
        ttffMs = max(0, Int(elapsed.rounded()))
        return ttffMs
    }

    func rebuffered() {
        rebufferCount += 1
    }

    func failed(_ message: String? = nil) {
        errorCount += 1
        if let message, !message.isEmpty {
            // Sanitized at the boundary as well as in `TelemetryEvent.init`:
            // this value can be read back by a caller for its own logging, and
            // a raw player error can embed a signed Mux URL.
            lastError = TelemetrySanitizer.sanitize(message)
        }
    }

    func progressed(to seconds: TimeInterval) {
        guard seconds.isFinite, seconds >= 0 else { return }
        lastPositionSeconds = seconds
    }

    /// Returns the summary exactly once. Teardown paths overlap on tvOS —
    /// `onDisappear`, a scene-phase change, and a dismiss can all fire for one
    /// exit — so a second call must be silent rather than double-count.
    func finalize(_ reason: PlaybackQoEReason) -> PlaybackQoESummary? {
        guard !finalized else { return nil }
        finalized = true
        return PlaybackQoESummary(
            contentID: contentID,
            ttffMs: ttffMs,
            rebufferCount: rebufferCount,
            errorCount: errorCount,
            lastError: lastError,
            reason: reason,
            watchedMs: lastPositionSeconds > 0
                ? Int((lastPositionSeconds * 1000).rounded())
                : nil
        )
    }
}

/// A "loading" state is a genuine rebuffer only once playback has started and
/// we are not mid source-swap. Ported verbatim from RN: without the swap
/// clause, every dub change and every showcase hop would file itself as a
/// stall, and the metric would measure the app's own behavior.
func shouldCountRebuffer(hasStarted: Bool, isSourceSwapping: Bool) -> Bool {
    hasStarted && !isSourceSwapping
}
