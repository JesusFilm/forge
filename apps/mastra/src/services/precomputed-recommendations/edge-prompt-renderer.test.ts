import { describe, expect, it } from "vitest"

import {
  decodeEdgePrompt,
  renderEdgePrompt,
  type EdgePromptDocument,
} from "./edge-prompt-renderer"

describe("edge prompt rendering", () => {
  it("refuses an unencoded semantic field before any model call", () => {
    const withNewField: EdgePromptDocument = {
      members: [
        {
          source: { metadata: { videoId: "source" }, profile: null },
          candidates: [],
          historical: null,
        },
      ],
      spanOffers: [],
      spanOfferCoverage: [],
    }
    Object.assign(withNewField.members[0]!, {
      futureSemanticField: "must not disappear",
    })
    expect(() => renderEdgePrompt(withNewField)).toThrowError(
      "edge_prompt_not_lossless",
    )
  })

  it("retains every pair-bound offer and fact while measuring a smaller prompt", () => {
    const sourceExcerpt =
      "A source passage with enough repeated context to matter in every comparison."
    const sourcePassage = {
      videoId: "source",
      chunkId: "source-chunk",
      startChar: 0,
      endChar: sourceExcerpt.length,
      textSha256: "a".repeat(64),
      excerpt: sourceExcerpt,
      language: "en",
    }
    const targets = Array.from({ length: 6 }, (_, index) => `target-${index}`)
    const metadata = (videoId: string) => ({
      videoId,
      title: `Title ${videoId}`,
      description: `Description ${videoId}`,
      keywords: ["faith"],
      bibleCitations: [],
      parentVideoIds: [],
      childVideoIds: [],
    })
    const definitions = {
      navigation: "A repeated long definition of qualified referrer navigation",
      exposure: "Missing exposure is not negative evidence",
    }
    const input: EdgePromptDocument = {
      members: [
        {
          source: {
            metadata: metadata("source"),
            profile: { themes: ["faith"] },
          },
          candidates: targets.map((targetVideoId, poolRank) => ({
            poolRank,
            metadata: metadata(targetVideoId),
            profile: { themes: ["faith", targetVideoId] },
          })),
          historical: {
            definitions,
            sourceEngagement: { videoKey: "source", views: 4 },
            candidates: targets.map((targetVideoId) => ({
              targetVideoId,
              engagement: { views: 2 },
              consecutivePlayback: null,
              referrerNavigation: 1,
            })),
          },
        },
      ],
      spanOffers: targets.map((targetVideoId, index) => ({
        spanId: index.toString(16).padStart(32, "0"),
        sourceVideoId: "source",
        targetVideoId,
        ...sourcePassage,
      })),
      spanOfferCoverage: targets.map((targetVideoId) => ({
        sourceVideoId: "source",
        targetVideoId,
        policy: "balanced_verified_anchors_v1",
        sourceAvailable: 1,
        targetAvailable: 0,
        offered: 1,
      })),
    }

    const rendered = renderEdgePrompt(input)
    expect(rendered.legacyPrompt).toBe(JSON.stringify(input))
    expect(decodeEdgePrompt(JSON.parse(rendered.prompt))).toEqual(input)
    expect(rendered.byteReport.legacyBytes).toBe(
      Buffer.byteLength(JSON.stringify(input), "utf8"),
    )
    expect(rendered.byteReport.compactBytes).toBe(
      Buffer.byteLength(rendered.prompt, "utf8"),
    )
    expect(rendered.byteReport.savedBytes).toBeGreaterThan(0)
    expect(rendered.byteReport.offerCount).toBe(6)
    expect(rendered.byteReport.uniquePassageCount).toBe(1)
  })
})
