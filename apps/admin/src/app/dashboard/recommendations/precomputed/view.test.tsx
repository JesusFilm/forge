import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PrecomputedComparisonView } from "./view"

describe("private recommendation comparison", () => {
  it("shows an honest empty state without fabricating cards", () => {
    const html = renderToStaticMarkup(
      <PrecomputedComparisonView
        comparison={{
          state: "ready",
          history: null,
          experimental: [],
          semanticBaseline: [],
          semanticBaselineState: "unavailable",
          anonymousBaseline: [],
          anonymousBaselineState: "missing_generation",
          allAcceptedCount: 0,
          coverageGap: "no_connections",
          gaps: [],
          usage: {
            callCount: 0,
            unknownUsageCallCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
          },
          generation: {
            id: "fixture-one",
            modelId: "fixture",
            promptVersion: "v1",
            inputCutoff: new Date("2026-10-05T00:00:00Z"),
            inputMode: "fixture",
            inputSnapshotMode: "fixture",
            acceptedCount: 0,
          },
        }}
      />,
    )
    expect(html).toContain("No accepted connections")
    expect(html).toContain("Current semantic retrieval unavailable")
    expect(html).not.toContain("<img")
  })

  it("renders direct and alternative reasons, Spanish evidence, metadata-only labels, and gaps", () => {
    const html = renderToStaticMarkup(
      <PrecomputedComparisonView
        comparison={{
          state: "ready",
          history: null,
          generation: {
            id: "fixture-two",
            modelId: "fixture",
            promptVersion: "v1",
            inputCutoff: new Date("2026-10-05T00:00:00Z"),
            inputMode: "content_only",
            inputSnapshotMode: "observed_fenced",
            acceptedCount: 3,
          },
          usage: {
            callCount: 2,
            unknownUsageCallCount: 1,
            inputTokens: 50,
            outputTokens: 20,
            cachedInputTokens: 0,
          },
          allAcceptedCount: 3,
          coverageGap: null,
          semanticBaselineState: "available",
          anonymousBaselineState: "available",
          anonymousBaseline: [
            {
              videoId: "contextual",
              videoSlug: "contextual",
              videoTitle: "Curated recovery",
              imageUrl: "https://example.com/curated.jpg",
            },
          ],
          semanticBaseline: [
            {
              videoId: "control",
              videoSlug: "control",
              videoTitle: "Current candidate",
              imageUrl: null,
              sceneIndex: 0,
              description: "Current",
              startSeconds: 0,
              endSeconds: null,
              similarity: 0.8,
              themes: [],
              demographics: [],
              spiritualContext: [],
              playbackId: "control-playback",
            },
          ],
          experimental: [
            {
              targetVideoId: "direct",
              videoSlug: "direct",
              videoTitle: "Direct film",
              playbackId: "p1",
              imageUrl: "https://example.com/one.jpg",
              kind: "direct",
              rank: 1,
              relationship: "more_like_this",
              reasonEnglish: "A similar account of hope and restoration.",
              evidence: {
                basis: "transcript",
                passages: [
                  {
                    chunkId: "spanish-1",
                    videoId: "direct",
                    language: "es",
                    excerpt: "Una historia de esperanza",
                  },
                ],
              },
            },
            {
              targetVideoId: "alternative",
              videoSlug: "alternative",
              videoTitle: "Broader film",
              playbackId: "p2",
              imageUrl: "https://example.com/two.jpg",
              kind: "alternative",
              rank: 1,
              relationship: "unexpected_connection",
              reasonEnglish:
                "A complementary story about change and belonging.",
              evidence: { basis: "metadata", fields: ["title"] },
            },
          ],
          gaps: [
            { targetVideoId: "missing-audio", reason: "audio_unavailable" },
          ],
        }}
      />,
    )
    expect(html).toContain("Current candidate")
    expect(html).toContain("Curated recovery")
    expect(html).toContain("A similar account of hope and restoration")
    expect(html).toContain("Una historia de esperanza")
    expect(html).toContain('lang="es"')
    expect(html).toContain("Metadata only")
    expect(html).toContain("missing-audio")
    expect(html).toContain("3 accepted choices stored")
    expect(html).toContain("Observed current rows checked against cutoff")
    expect(html).toContain("1 calls with unreported usage")
  })

  it("does not display a failed generation as ready", () => {
    const html = renderToStaticMarkup(
      <PrecomputedComparisonView
        comparison={{
          state: "failed",
          experimental: [],
          semanticBaseline: [],
          coverageGap: null,
          failureCode: "provider_invalid_output",
          usage: {
            callCount: 1,
            unknownUsageCallCount: 1,
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
          },
        }}
      />,
    )
    expect(html).toContain("Generation failed")
    expect(html).toContain("provider_invalid_output")
    expect(html).toContain("unreported usage")
    expect(html).not.toContain("Experimental saved choices")
  })

  it("flags a historical qualification gap in the failed Admin comparison", () => {
    const html = renderToStaticMarkup(
      <PrecomputedComparisonView
        comparison={{
          state: "failed",
          failureCode: "analytics_transition_missing_session_identity",
          history: null,
          experimental: [],
          semanticBaseline: [],
          coverageGap: null,
          usage: {
            callCount: 0,
            unknownUsageCallCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
          },
        }}
      />,
    )
    expect(html).toContain("Ordered transitions unavailable")
    expect(html).toContain("missing session identity")
  })

  it("labels fixture history, unknown bot filtering, mapping gaps and query usage", () => {
    const comparison = {
      state: "ready",
      generation: {
        id: "history-fixture",
        modelId: "gpt-6-astra",
        promptVersion: "v1",
        inputCutoff: new Date("2026-10-05T00:00:00Z"),
        inputMode: "historical_fixture",
        inputSnapshotMode: "observed_fenced",
        acceptedCount: 0,
      },
      history: {
        provider: "fixture",
        status: "complete",
        queryId: "test-query-v1",
        rangeStart: "2020-01-01",
        rangeEnd: "2026-10-04",
        cutoff: "2026-10-05T00:00:00.000Z",
        identity: "core_id",
        botFiltering: "unknown",
        measurement: "observed_events",
        overlap: "unknown",
        rowCount: 4,
        mappedRows: 3,
        unmappedRows: 1,
        catalogCandidates: 2,
        inspectedCandidates: 1,
        unmappedCandidates: 1,
        pageCount: 3,
        queryExecutionCount: 2,
        queryUsageDigest: "a".repeat(64),
        resultDigest: "b".repeat(64),
        unmappedDigest: "c".repeat(64),
        bytesProcessed: 4096,
        costQualification: "usage_only",
      },
      usage: {
        callCount: 1,
        unknownUsageCallCount: 0,
        inputTokens: 20,
        outputTokens: 10,
        cachedInputTokens: 0,
      },
      experimental: [],
      allAcceptedCount: 0,
      coverageGap: "no_connections",
      gaps: [],
      semanticBaseline: [],
      semanticBaselineState: "unavailable",
      anonymousBaseline: [],
      anonymousBaselineState: "missing_generation",
    } satisfies Parameters<typeof PrecomputedComparisonView>[0]["comparison"]
    const html = renderToStaticMarkup(
      <PrecomputedComparisonView comparison={comparison} />,
    )
    expect(html).toContain("controlled fixture")
    expect(html).toContain("Bot filtering unknown")
    expect(html).toContain("1 lacked a verified legacy mapping")
    expect(html).toContain("processed bytes 4096")
    expect(html).toContain(
      "warehouse aggregates were observed during this build",
    )
    expect(html).toContain("Watch scope and transition capability unknown")

    const qualifiedHtml = renderToStaticMarkup(
      <PrecomputedComparisonView
        comparison={{
          ...comparison,
          history: {
            ...comparison.history,
            qualification: {
              sourceTable: "fixture.events.watch",
              observedStart: "2020-01-01",
              observedEnd: "2026-10-04",
              watchScope: {
                version: "jesusfilm-watch-v1",
                hosts: ["jesusfilm.org", "www.jesusfilm.org"],
                pathRule: "watch-route-and-children",
                totalEvents: 12,
                includedEvents: 7,
                missingUrlEvents: 1,
                malformedUrlEvents: 1,
                excludedHostEvents: 1,
                excludedPathEvents: 2,
              },
              videoIdCoverage: {
                eventName: "videostarts",
                inScopeEvents: 4,
                withIdEvents: 3,
                mappedEvents: null,
              },
              engagement: {
                definitionVersion: "watch-videostarts-v1",
                botBasis: "unverified",
                overlapIdentity: "unknown",
              },
              transitions: {
                status: "available",
                definitionVersion: "consecutive-videostarts-v1",
                continuity: "all_video_starts",
                sessionIdentity: "verified",
                ordering: "timestamp_and_sequence",
                botBasis: "unverified",
                overlapIdentity: "unknown",
              },
            },
          },
        }}
      />,
    )
    expect(qualifiedHtml).toContain("fixture.events.watch")
    expect(qualifiedHtml).toContain(
      'Source <code class="break-all">fixture.events.watch</code>',
    )
    expect(qualifiedHtml).toContain("jesusfilm-watch-v1")
    expect(qualifiedHtml).toContain("7/12 events in scope")
    expect(qualifiedHtml).toContain("3/4 Watch videostarts with video ID")
    expect(qualifiedHtml).toContain("mapped event coverage unknown")
    expect(qualifiedHtml).toContain("consecutive-videostarts-v1")
  })
})
