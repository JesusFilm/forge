import { describe, expect, it } from "vitest"

import type { DatadogTriageServiceProfile } from "../../config/env"

import type { TriageAnalysis } from "./analyze"
import type { TriageCandidate } from "./detect"
import {
  buildTriageTicketDraft,
  safeTriageText,
  safeTriageTitleText,
  triageDeepLink,
  triageIdempotencyKey,
  triageMarker,
  TRIAGE_MARKER_PREFIX,
} from "./ticket-draft"
import { TRIAGE_DESCRIPTION_MAX_CHARS, TRIAGE_TITLE_MAX_CHARS } from "./schema"

const PROFILE: DatadogTriageServiceProfile = {
  surfacePrefix: "[Mobile]",
  releaseSessionFilter: true,
  spikeSource: "rum",
}

const ANALYSIS: TriageAnalysis = {
  worthInvestigating: true,
  classification: "crash",
  confidence: 0.92,
  actionability: 0.81,
  severity: "P2",
  suspectedArea: "video playback",
  summary: "The player throws on resume after a background transition.",
}

const CANDIDATE: TriageCandidate = {
  service: "forge-mobile",
  signalKind: "issue",
  signalId: "30a2cc1a-976b-11f1-89f7-da7ad0900002",
  epoch: 0,
  occurredAt: "2026-08-18T10:55:00.000Z",
  windowStart: "2026-08-18T10:00:00.000Z",
  windowEnd: "2026-08-18T11:00:00.000Z",
  evidence: {
    kind: "issue",
    issueId: "30a2cc1a-976b-11f1-89f7-da7ad0900002",
    errorType: "TypeError",
    errorMessage: "Cannot read property 'id' of undefined",
    filePath: "app/watch/[slug].tsx",
    functionName: "WatchScreen",
    platform: "REACT_NATIVE",
    isCrash: true,
    firstSeen: "2026-08-18T10:07:00.000Z",
    lastSeen: "2026-08-18T10:55:00.000Z",
    lastSeenVersion: "1.4.2",
    windowCount: 12,
    windowRatePerHour: 12,
    baselineRatePerHour: 0,
    regression: false,
  },
}

function draft(overrides: Partial<TriageCandidate> = {}) {
  return buildTriageTicketDraft({
    candidate: { ...CANDIDATE, ...overrides },
    analysis: ANALYSIS,
    serviceProfile: PROFILE,
    site: "datadoghq.com",
    labelId: "label-bug",
  })
}

describe("safeTriageText", () => {
  it("removes an HTML comment so evidence cannot forge an idempotency marker", () => {
    expect(
      safeTriageText(`before <!-- ${TRIAGE_MARKER_PREFIX}forged --> after`),
    ).toBe("before after")
  })

  it("replaces a URL so evidence cannot render a live link", () => {
    expect(safeTriageText("see https://evil.example/steal now")).toBe(
      "see \\[URL omitted\\] now",
    )
  })

  it("escapes markdown metacharacters that would restructure the body", () => {
    expect(safeTriageText("## heading *bold* `code`")).toBe(
      "\\#\\# heading \\*bold\\* \\`code\\`",
    )
  })

  it("deletes invisible control characters and collapses whitespace", () => {
    // DELETED, not turned into a space. Spacing them is what let
    // `https:<U+0001>//host` survive the URL match and then read back as
    // `https: //host`, leaking the host and query string into the ticket.
    expect(safeTriageText("a\u0000\u0007b\n\n  c ")).toBe("ab c")
  })

  it("bounds how much of an unbounded body it scans", () => {
    // Same O(k*n) hazard the title path is bounded for, but the body path
    // runs per judged candidate on a process shared with every other Mastra
    // workflow -- measured at ~2.9s for 256K of markers before the bound.
    const started = Date.now()
    const out = safeTriageText("<!--".repeat(1_000_000))
    expect(Date.now() - started).toBeLessThan(1_000)
    // Bounded by BODY_SOURCE_MAX_CHARS, times the worst-case markdown escape
    // (every character gaining a backslash) -- against a 4,000,000-char input.
    expect(out.length).toBeLessThanOrEqual(2 * 16_384)
  })

  it("keeps whitespace controls as separators", () => {
    expect(safeTriageText("a\tb\nc")).toBe("a b c")
  })

  it.each([
    ["ZWSP", "\u200b"],
    ["SHY", "\u00ad"],
    ["BOM", "\ufeff"],
    ["U+0001", "\u0001"],
    ["DEL", "\u007f"],
    // Outside Cf|Cc. These are the ones that matter most: the survivor still
    // LOOKS like an ordinary link, unlike the visibly broken whitespace case.
    ["VS16", "\ufe0f"],
    ["HANGUL FILLER", "\u3164"],
    ["CGJ", "\u034f"],
  ])("omits a URL whose scheme is split by %s", (_label, invisible) => {
    const out = safeTriageText(
      `failed for https:${invisible}//internal-admin.example/a?token=sk_live_9f3`,
    )
    expect(out).not.toContain("internal-admin.example")
    expect(out).not.toContain("sk_live_9f3")
    expect(out).toContain("URL omitted")
  })

  it("strips a comment whose markers are split by an invisible character", () => {
    // Stripping comments BEFORE deleting invisibles let this re-form into a
    // live comment afterwards, forging the marker the dispatcher dedupes on.
    const forged = `<!\u200b-- ${TRIAGE_MARKER_PREFIX}forged --\u200b>`
    expect(safeTriageText(`before ${forged} after`)).toBe("before after")
  })
})

// Exported and used directly, so it carries its own contract. The draft path
// reduces each component to its first line too; these pin THIS function's
// behaviour rather than relying on that caller-side guard.
describe("safeTriageTitleText", () => {
  it("keeps only the first line with visible content", () => {
    expect(
      safeTriageTitleText("boom\n    at Frame (x.js:1:2)\n    at Other"),
    ).toBe("boom")
  })

  it("skips a leading line that is blank once invisibles are removed", () => {
    expect(safeTriageTitleText("\u200b\n   \nthe real message")).toBe(
      "the real message",
    )
  })

  it("removes structural characters instead of escaping them", () => {
    expect(safeTriageTitleText("a\\b|c `d` <e> @f [g]")).toBe("a b c d e f g")
  })

  it("keeps styling characters that only mangle identifiers when removed", () => {
    expect(safeTriageTitleText("react_stack_bottom_frame *x* #1")).toBe(
      "react_stack_bottom_frame *x* #1",
    )
  })

  it("omits a URL without leaving brackets the title path would strip", () => {
    expect(safeTriageTitleText("see https://evil.example/steal now")).toBe(
      "see (URL omitted) now",
    )
  })

  it("bounds how much of an unbounded message it scans", () => {
    // The comment scan is O(k·n) on many unclosed `<!--`; a 4 MiB Datadog
    // message must not turn one candidate into a multi-second stall. The
    // output bound is the SOURCE cap — the 200-char cut happens in the draft.
    const started = Date.now()
    const out = safeTriageTitleText("<!--".repeat(1_000_000))
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(out.length).toBeLessThanOrEqual(4096)
  })
})

describe("triageDeepLink", () => {
  it("builds the Error Tracking link shape observed live", () => {
    expect(
      triageDeepLink({
        site: "datadoghq.com",
        service: "forge-mobile",
        evidence: CANDIDATE.evidence,
        windowStart: CANDIDATE.windowStart,
        windowEnd: CANDIDATE.windowEnd,
      }),
    ).toBe(
      "https://app.datadoghq.com/error-tracking/issue/30a2cc1a-976b-11f1-89f7-da7ad0900002",
    )
  })

  it("honours the configured site", () => {
    expect(
      triageDeepLink({
        site: "datadoghq.eu",
        service: "forge-mobile",
        evidence: CANDIDATE.evidence,
        windowStart: CANDIDATE.windowStart,
        windowEnd: CANDIDATE.windowEnd,
      }),
    ).toContain("https://app.datadoghq.eu/error-tracking/issue/")
  })

  it("refuses to build a link from an id that fails its shape gate", () => {
    expect(
      triageDeepLink({
        site: "datadoghq.com",
        service: "forge-mobile",
        evidence: {
          kind: "issue",
          issueId: "../../admin?x=1",
          windowCount: 1,
          windowRatePerHour: 1,
          baselineRatePerHour: 0,
          regression: false,
        },
        windowStart: CANDIDATE.windowStart,
        windowEnd: CANDIDATE.windowEnd,
      }),
    ).toBeUndefined()
  })

  it("encodes the service into a spike's logs query", () => {
    const link = triageDeepLink({
      site: "datadoghq.com",
      service: "forge mobile&injected=1",
      evidence: {
        kind: "spike",
        spikeClass: "playback_error",
        windowCount: 30,
        windowRatePerHour: 30,
        baselineRatePerHour: 2,
      },
      windowStart: CANDIDATE.windowStart,
      windowEnd: CANDIDATE.windowEnd,
    })

    expect(link).toContain("query=service%3Aforge+mobile%26injected%3D1")
  })
})

describe("buildTriageTicketDraft", () => {
  it("follows the FGE title convention: bracketed surface then [P#]", () => {
    expect(draft().title).toBe(
      "[Mobile] [P2] TypeError: Cannot read property 'id' of undefined",
    )
  })

  it("uses the per-service prefix the profile supplies", () => {
    const admin = buildTriageTicketDraft({
      candidate: CANDIDATE,
      analysis: ANALYSIS,
      serviceProfile: {
        surfacePrefix: "[Admin]",
        releaseSessionFilter: false,
        spikeSource: "logs",
      },
      site: "datadoghq.com",
    })

    expect(admin.title.startsWith("[Admin] [P2] ")).toBe(true)
  })

  it("never cuts the description on an unpaired surrogate", () => {
    // The file already guards the title cut; the description cut skipped it,
    // and an unpaired surrogate goes over the wire as an invalid code unit.
    const built = draft({
      evidence: {
        ...CANDIDATE.evidence,
        errorType: "A" + "\u{1F600}".repeat(9000),
      } as never,
    })

    // Lone surrogate in either direction; `isWellFormed` would need an
    // ES2024 lib bump, which is a repo-wide call, not this test's.
    expect(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
        built.description,
      ),
    ).toBe(false)
  })

  it("keeps the marker even when the body fills the description bound", () => {
    // The marker is the LAST line and the description is tail-truncated, so
    // cutting the joined string dropped the one token findIssueByMarker
    // dedupes on -- and a lost marker means a duplicate ticket every hour.
    const built = draft({
      evidence: {
        ...CANDIDATE.evidence,
        errorType: "E".repeat(6000),
        functionName: "F".repeat(6000),
        errorMessage: "M".repeat(6000),
      } as never,
    })

    expect(built.description.length).toBeLessThanOrEqual(
      TRIAGE_DESCRIPTION_MAX_CHARS,
    )
    expect(built.description).toContain(triageMarker(built.idempotencyKey))
    expect(built.description.endsWith(triageMarker(built.idempotencyKey))).toBe(
      true,
    )
  })

  it("keeps the title inside Linear's field bound", () => {
    const long = draft({
      evidence: {
        ...CANDIDATE.evidence,
        errorMessage: "x".repeat(500),
      } as never,
    })

    expect(long.title.length).toBeLessThanOrEqual(TRIAGE_TITLE_MAX_CHARS)
  })

  // A Datadog error message is "first line, then stack trace". Titles used to
  // carry the whole thing, markdown-escaped and hard-cut at 200 — measured
  // against real production rows, every one was unreadable.
  it("takes only the first line, so the stack trace stays out of the title", () => {
    const built = draft({
      evidence: {
        ...CANDIDATE.evidence,
        errorType: "ReferenceError",
        errorMessage:
          "Property 'windowFade' doesn't exist\n    at ActivePlaybackHost (http://127.0.0.1:8090/x.bundle:1:2)\n    at renderWithHooks (http://127.0.0.1:8090/y.bundle:3:4)",
      } as never,
    })

    expect(built.title).toBe(
      "[Mobile] [P2] ReferenceError: Property 'windowFade' doesn't exist",
    )
  })

  it("leaves no markdown escapes in a plain-text title", () => {
    const built = draft({
      evidence: {
        ...CANDIDATE.evidence,
        errorType: "ReferenceError",
        // Carries every structural character the title removes, including the
        // backslash and pipe the older fixture happened to omit.
        errorMessage:
          "react_stack_bottom_frame *bold* #1 [x](y) <b>z</b> a\\b|c",
      } as never,
    })

    expect(built.title).not.toContain("\\")
    expect(built.title).not.toContain("[x]")
    expect(built.title).not.toContain("<b>")
    // `*`, `_` and `#` survive: they only style, and removing them would
    // mangle the identifiers a stack frame carries.
    expect(built.title).toContain("react_stack_bottom_frame")
    expect(built.title).toContain("*bold*")
    expect(built.title).toContain("#1")
  })

  it("splits on the line separators \\p{Cc} does not match", () => {
    const built = draft({
      evidence: {
        ...CANDIDATE.evidence,
        errorType: "TypeError",
        // U+2028 is Zl, so the control-character strip never sees it; without
        // it in the split class the second line survives as a space-joined tail.
        errorMessage: "boom happened at\u2028SecretFrame internalDetail",
      } as never,
    })

    expect(built.title).toBe("[Mobile] [P2] TypeError: boom happened at")
  })

  it("keeps the message when the error type or the message starts blank", () => {
    // Reducing the JOINED string instead of each part cut the title at the
    // seam and shipped a bare "TypeError:" with the message discarded.
    const built = draft({
      evidence: {
        ...CANDIDATE.evidence,
        errorType: "TypeError",
        errorMessage: "\r\nProperty 'windowFade' does not exist\n at Foo",
      } as never,
    })

    expect(built.title).toBe(
      "[Mobile] [P2] TypeError: Property 'windowFade' does not exist",
    )
  })

  it("does not let an invisible first line swallow the real message", () => {
    const built = draft({
      evidence: {
        ...CANDIDATE.evidence,
        errorType: undefined,
        errorMessage: "\u200b\nCannot read property 'id' of undefined",
      } as never,
    })

    expect(built.title).toBe(
      "[Mobile] [P2] Cannot read property 'id' of undefined",
    )
  })

  it("omits a URL whose scheme is broken by a zero-width character", () => {
    // The zero-width used to survive the URL match and then become a SPACE,
    // leaking the host and query string as readable text.
    const built = draft({
      evidence: {
        ...CANDIDATE.evidence,
        errorType: "FetchError",
        errorMessage:
          "failed for https:\u200b//internal-admin.example/api?token=sk_live_9f3",
      } as never,
    })

    expect(built.title).not.toContain("internal-admin.example")
    expect(built.title).not.toContain("sk_live_9f3")
    expect(built.title).toContain("(URL omitted)")
  })

  it("omits a userinfo URL whole, rather than splitting it on the @", () => {
    // Removing `@` before the URL match would cut the URL in two and leave the
    // host as plain text, so the replace must run first.
    const built = draft({
      evidence: {
        ...CANDIDATE.evidence,
        errorType: "FetchError",
        errorMessage: "failed for https://user@internal-admin.example/secret",
      } as never,
    })

    expect(built.title).not.toContain("internal-admin.example")
    expect(built.title).toBe(
      "[Mobile] [P2] FetchError: failed for (URL omitted)",
    )
  })

  it("cuts a long title on a word boundary, not mid-word", () => {
    const words = Array.from({ length: 500 }, (_, i) => `w${i}`).join(" ")
    const title = draft({
      evidence: { ...CANDIDATE.evidence, errorMessage: words } as never,
    }).title

    expect(title.length).toBeLessThanOrEqual(TRIAGE_TITLE_MAX_CHARS)
    expect(title.length).toBeGreaterThan(180)
    expect(title.endsWith("…")).toBe(true)
    expect(title.at(-2)).not.toBe(" ")
    // The kept text is a whole-word prefix of the subject.
    const body = title.slice("[Mobile] [P2] TypeError: ".length, -1)
    expect(`${words} `.startsWith(`${body} `)).toBe(true)
  })

  it("hard-cuts an unbroken tail rather than falling back to the early space", () => {
    // With `errorType` present there is always a space at the seam. Without
    // the lookback the cut would snap back to it and drop the whole message.
    const title = draft({
      evidence: {
        ...CANDIDATE.evidence,
        errorMessage: "q".repeat(500),
      } as never,
    }).title

    expect(title.length).toBe(TRIAGE_TITLE_MAX_CHARS)
    expect(title).toContain("qqqqqqqqqq")
  })

  it("never ends a title on an unpaired surrogate", () => {
    // `errorType` omitted on purpose: with it the pairs land off the cut and
    // the walk-back never fires, so the assertion would pass vacuously.
    const title = draft({
      evidence: {
        ...CANDIDATE.evidence,
        errorType: undefined,
        errorMessage: "🙏".repeat(200),
      } as never,
    }).title

    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u.test(title)).toBe(false)
  })

  it("falls back to the suspected area when sanitizing consumes everything", () => {
    const built = draft({
      evidence: {
        ...CANDIDATE.evidence,
        errorType: undefined,
        errorMessage: "<>|@`",
      } as never,
    })

    expect(built.title).toBe("[Mobile] [P2] video playback")
  })

  it("derives the idempotency key from the signal identity and epoch", () => {
    expect(draft().idempotencyKey).toBe(
      "datadog-triage:issue:30a2cc1a-976b-11f1-89f7-da7ad0900002:0",
    )
    expect(draft({ epoch: 3 }).idempotencyKey).toBe(
      "datadog-triage:issue:30a2cc1a-976b-11f1-89f7-da7ad0900002:3",
    )
  })

  it("embeds the marker the dispatcher searches Linear for", () => {
    const built = draft()

    expect(built.description).toContain(triageMarker(built.idempotencyKey))
  })

  it("carries the evidence a human needs to judge the claim", () => {
    const body = draft().description

    expect(body).toContain("**Occurrences in window:** 12 (12.00/hour)")
    expect(body).toContain("**Baseline before this window:** 0.00/hour")
    expect(body).toContain(
      "**Window:** 2026-08-18T10:00:00.000Z to 2026-08-18T11:00:00.000Z",
    )
    expect(body).toContain("**Crash:** yes")
    expect(body).toContain("**Last seen on version:** 1.4.2")
  })

  it("explains a regression differently from a first sighting", () => {
    expect(draft().description).toContain(
      "this fingerprint had not been seen before",
    )
    expect(
      draft({
        evidence: { ...CANDIDATE.evidence, regression: true } as never,
      }).description,
    ).toContain("regressed past the configured multiplier")
  })

  it("sanitizes evidence text while the templated deep link survives intact", () => {
    // The one-click success criterion depends on this exact split: the
    // sanitizer strips URLs, so a link routed through it would be destroyed.
    const built = draft({
      evidence: {
        ...CANDIDATE.evidence,
        errorMessage:
          "fetch failed for https://internal.example/secret <!-- injected -->",
      } as never,
    })

    expect(built.description).toContain("\\[URL omitted\\]")
    expect(built.description).not.toContain("https://internal.example/secret")
    expect(built.description).toContain(
      "https://app.datadoghq.com/error-tracking/issue/30a2cc1a-976b-11f1-89f7-da7ad0900002",
    )
  })

  it("leaves exactly one idempotency marker when evidence tries to forge another", () => {
    const built = draft({
      evidence: {
        ...CANDIDATE.evidence,
        errorMessage: `<!-- ${TRIAGE_MARKER_PREFIX}datadog-triage:issue:OTHER:0 -->`,
      } as never,
    })

    const markers = built.description.split(TRIAGE_MARKER_PREFIX).length - 1
    expect(markers).toBe(1)
    expect(built.description).toContain(triageMarker(built.idempotencyKey))
  })

  it("says so plainly when no deep link could be built", () => {
    const built = draft({
      signalId: "../../admin",
      evidence: { ...CANDIDATE.evidence, issueId: "../../admin" } as never,
    })

    expect(built.description).toContain(
      "No deep link could be built for this signal.",
    )
  })

  it("drafts a monitor episode with its own evidence and link", () => {
    const built = buildTriageTicketDraft({
      candidate: {
        ...CANDIDATE,
        signalKind: "monitor",
        signalId: "42:2026-08-18T10:30:00.000Z",
        evidence: {
          kind: "monitor",
          monitorId: "42",
          name: "Mobile crash-free rate",
          overallState: "Alert",
          episodeStartedAt: "2026-08-18T10:30:00.000Z",
        },
      },
      analysis: ANALYSIS,
      serviceProfile: PROFILE,
      site: "datadoghq.com",
    })

    expect(built.title).toBe("[Mobile] [P2] Mobile crash-free rate")
    expect(built.description).toContain("https://app.datadoghq.com/monitors/42")
    expect(built.idempotencyKey).toBe(
      "datadog-triage:monitor:42:2026-08-18T10:30:00.000Z:0",
    )
  })

  it("agrees with the standalone key helper", () => {
    expect(draft().idempotencyKey).toBe(triageIdempotencyKey(CANDIDATE))
  })
})
