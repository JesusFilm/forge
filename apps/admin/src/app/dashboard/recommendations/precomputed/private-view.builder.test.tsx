import { performance } from "node:perf_hooks"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { PrecomputedComparison } from "@/services/recommendations/precomputed/contract"
import { PrecomputedComparisonView } from "./view"

type Ready = Extract<PrecomputedComparison, { state: "ready" }>
function ready(): Ready {
  const sourceEvidence = {
    basis: "transcript" as const,
    passages: Array.from({ length: 5 }, (_, i) => ({
      chunkId: "subtitle-source-" + i,
      excerpt: "Exact original source words. ".repeat(15) + i,
    })),
  }
  return {
    state: "ready",
    history: null,
    generation: {
      id: "private-pilot",
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
        manifestKey: "private/manifest.json",
      },
    },
    usage: {
      callCount: 23,
      unknownUsageCallCount: 0,
      inputTokens: 3128769,
      outputTokens: 192191,
      cachedInputTokens: 0,
    },
    experimental: Array.from({ length: 8 }, (_, i) => ({
      targetVideoId: "target-" + i,
      kind: "direct",
      rank: i + 1,
      relationship: "shared-reading",
      reasonEnglish:
        `Complete explanation ${i}. ` +
        "Precise additional meaning. ".repeat(35),
      addedViewingValueEnglish:
        `Distinct watching value ${i}. ` +
        "Full original watching value. ".repeat(35),
      evidence: { basis: "metadata", fields: ["description"] },
      videoSlug: "target-" + i,
      videoTitle: "Target " + i,
      playbackId: "play-" + i,
      imageUrl: "/image.jpg",
      sharedReading: {
        version: "shared-reading-v1",
        sourceVideoId: "source",
        corpusDigest: "a".repeat(64),
        sourceEvidence,
        sourceReferences: sourceEvidence.passages.map((p) => ({
          chunkId: p.chunkId,
          transcriptId: "original-transcript",
          language: "es",
        })),
        targetEvidence: {
          basis: "metadata",
          fields: [
            {
              field: "description",
              value: `Exact <script>untrusted</script> metadata ${i}`,
            },
          ],
        },
        targetReferences: [],
        privateSourceArtifactKey: "private/source.json",
      },
    })),
    allAcceptedCount: 8,
    coverageGap: null,
    gaps: [],
    semanticBaseline: [],
    semanticBaselineState: "unavailable",
    anonymousBaseline: [],
    anonymousBaselineState: "missing_generation",
  }
}
describe("private shared-reading server rendering", () => {
  it("renders all eight full cards and both sides with safe literal metadata and honest pilot scope", () => {
    const html = renderToStaticMarkup(
      <PrecomputedComparisonView comparison={ready()} />,
    )
    expect(html).toContain("Complete explanation 7")
    expect(html).toContain("Distinct watching value 7")
    expect(html).toContain("subtitle-source-4")
    expect(html).toContain("original-transcript")
    expect(html).toContain(
      "Exact &lt;script&gt;untrusted&lt;/script&gt; metadata 7",
    )
    expect(html).not.toContain("<script>")
    expect(html).toContain("Private pilot")
    expect(html).toContain("1031")
    expect(html).not.toContain("Fixture input")
    expect(html).not.toContain("up to six")
  })
  it("keeps the bounded eight-card review server rendered without a client/network stage", () => {
    const comparison = ready()
    renderToStaticMarkup(<PrecomputedComparisonView comparison={comparison} />)
    const start = performance.now()
    let largest = 0
    for (let i = 0; i < 5; i++)
      largest = Math.max(
        largest,
        Buffer.byteLength(
          renderToStaticMarkup(
            <PrecomputedComparisonView comparison={comparison} />,
          ),
        ),
      )
    expect(largest).toBeLessThan(96_000)
    expect((performance.now() - start) / 5).toBeLessThan(1000)
  })
  it("shows a saved zero-choice explanation separately from presentation availability", () => {
    const comparison = ready()
    comparison.experimental = []
    comparison.allAcceptedCount = 0
    comparison.coverageGap = "no_connections"
    comparison.generation.acceptedCount = 0
    comparison.generation.privateImport!.fewerThanFiveReason =
      "No adequately supported directional choice in this declared source pool."
    expect(
      renderToStaticMarkup(
        <PrecomputedComparisonView comparison={comparison} />,
      ),
    ).toContain("No adequately supported directional choice")
  })
})
