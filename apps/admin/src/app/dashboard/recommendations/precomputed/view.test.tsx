import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PrecomputedComparisonView } from "./view"

describe("private recommendation comparison", () => {
  it("shows an honest empty state without fabricating cards", () => {
    const html = renderToStaticMarkup(
      <PrecomputedComparisonView
        comparison={{
          state: "ready",
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
})
