import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { PrecomputedComparison } from "@/services/recommendations/precomputed/contract"
import { PrecomputedComparisonView } from "./view"

type Ready = Extract<PrecomputedComparison, { state: "ready" }>
function comparison(): Ready {
  const sourceExcerpt =
    'Original source <script>alert("x")</script> & exact ending'
  return {
    state: "ready",
    history: null,
    generation: {
      id: "private",
      modelId: "gpt-6-astra",
      promptVersion: "shared-reading-v1",
      inputCutoff: new Date("2026-10-19T00:00:00Z"),
      inputMode: "content_only",
      inputSnapshotMode: "preflight_failed",
      acceptedCount: 8,
      privateImport: {
        scope: "private_pilot",
        declaredSourceCount: 4,
        eligibleTargetCount: 1031,
        fewerThanFiveReason: null,
        manifestKey: "private/frozen-manifest",
      },
    },
    usage: {
      callCount: 23,
      unknownUsageCallCount: 0,
      inputTokens: 3128769,
      outputTokens: 192191,
      cachedInputTokens: 0,
    },
    allAcceptedCount: 8,
    coverageGap: null,
    gaps: [],
    semanticBaseline: [],
    semanticBaselineState: "unavailable",
    anonymousBaseline: [],
    anonymousBaselineState: "missing_generation",
    experimental: Array.from({ length: 8 }, (_, index) => ({
      targetVideoId: "target-" + index,
      videoSlug: "target-" + index,
      videoTitle: "Distinct target " + index,
      playbackId: "private-playback-" + index,
      imageUrl: "https://example.com/image.jpg",
      kind: "direct",
      rank: index + 1,
      relationship: "shared-reading",
      reasonEnglish: "Connection <img src=x onerror=alert(1)> exact end",
      addedViewingValueEnglish:
        "Additional original value. ".repeat(50) + "VALUE_END_" + index,
      evidence: { basis: "metadata", fields: ["description"] },
      sharedReading: {
        version: "shared-reading-v1",
        sourceVideoId: "source",
        corpusDigest: "a".repeat(64),
        sourceEvidence: {
          basis: "transcript",
          passages: [
            { chunkId: "subtitle-private-source", excerpt: sourceExcerpt },
          ],
        },
        targetEvidence: {
          basis: "metadata",
          fields: [
            {
              field: "description",
              value: "Literal <b>metadata</b> & exact value",
            },
          ],
        },
        sourceReferences: [
          {
            chunkId: "subtitle-private-source",
            transcriptId: "original-edition",
            language: "en",
          },
        ],
        targetReferences: [],
        privateSourceArtifactKey: "private/frozen-source",
      },
    })),
  }
}
describe("independent full private evidence rendering", () => {
  it("renders all eight full explanations and both evidence sides while escaping content", () => {
    const html = renderToStaticMarkup(
      <PrecomputedComparisonView comparison={comparison()} />,
    )
    expect(html).toContain(
      "Original source &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; exact ending",
    )
    expect(html).toContain(
      "Connection &lt;img src=x onerror=alert(1)&gt; exact end",
    )
    expect(html).not.toContain("<script>")
    expect(html).not.toContain('<img src="x"')
    expect(html).toContain(
      "Literal &lt;b&gt;metadata&lt;/b&gt; &amp; exact value",
    )
    expect(html).toContain("explicit metadata evidence")
    expect(html).toContain("subtitle-private-source")
    expect(html).toContain("original-edition")
    expect(html).toContain("not database chunk IDs")
    for (let index = 0; index < 8; index++)
      expect(html).toContain("VALUE_END_" + index)
  })
  it("identifies the pilot honestly and displays shared physical totals on its comparison", () => {
    const html = renderToStaticMarkup(
      <PrecomputedComparisonView comparison={comparison()} />,
    )
    expect(html).toContain("Private pilot")
    expect(html).toContain("1031")
    expect(html).toContain("23 model calls")
    expect(html).toContain("3128769 input tokens")
    expect(html).toContain(
      "current database text freshness and historical/public qualification are not asserted",
    )
    expect(html).not.toContain("Full declared catalog")
  })
})
