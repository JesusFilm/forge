import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { RecommendationRequestDetailData } from "@/services/recommendations/admin-ops"
import { RecommendationRequestDetailPanel } from "./request-detail-panel"

const NOW = new Date("2026-08-27T00:00:00.000Z")

function hybridDetail(): RecommendationRequestDetailData {
  const contributors = [
    {
      generator: "semantic",
      generatorVersion: "semantic-transcript-candidate-v1",
      rank: 2,
    },
    {
      generator: "multi-interest-profile",
      generatorVersion: "multi-interest-profile-candidate-v1",
      rank: 1,
    },
    {
      generator: "semantic",
      generatorVersion: "semantic-transcript-candidate-v1",
      rank: 8,
    },
  ]
  return {
    id: "request-current",
    contractVersion: "semantic-recommendation-v1",
    surfaceVersion: "watch-below-player-v1",
    strategyVersion: "semantic-profile-hybrid-v1",
    classifierVersion: "active-watch-proxy-v1",
    seedMediaId: "seed-video",
    locale: "en",
    expectedItemCount: 6,
    state: "issued",
    result: "served",
    fallbackReason: null,
    retrievalLatencyMs: 420,
    responseBytes: 4096,
    createdAt: NOW,
    issuedAt: NOW,
    manifest: {
      id: "semantic-profile-hybrid-v1",
      strategyVersion: "semantic-profile-hybrid-v1",
      contractVersion: "semantic-recommendation-v1",
      surfaceVersion: "watch-below-player-v1",
      generator: "hybrid",
      maxItems: 6,
    },
    controlReadiness: null,
    experiment: null,
    personalization: {
      lane: "profile_challenger",
      executionMode: "hybrid_personalized",
      effectiveManifestId: "semantic-profile-hybrid-v1",
      reasonCode: null,
      projectionScope: "durable",
      projectionVersion: "multi-interest-profile-projection-v1",
      projectionGeneration: 7,
      interestCount: 2,
      sessionIntentPresent: false,
      retrievalLatencyMs: 38,
      feedbackSourceRequestIds: ["prior-qualified-request"],
    },
    candidateExecution: {
      purpose: "watch",
      requestedCount: 6,
      composedCount: 6,
      shortfallReason: null,
      versions: {
        context: "recommendation-context-v1",
        generator: "semantic-profile-hybrid-generators-v1",
        union: "canonical-video-union-v1",
        eligibility: "watch-playable-locale-v1",
        ranker: "source-rank-hybrid-ranker-v1",
        composer: "recent-video-refill-composer-v1",
      },
      parity: {
        candidateEligibility: "not_evaluated",
        ranker: "not_evaluated",
      },
      counts: {
        nominated: 12,
        canonicalized: 12,
        deduplicated: 10,
        rejected: 4,
        scored: 8,
        ordered: 8,
        composed: 6,
      },
      evidenceComplete: true,
      fallbackReason: null,
      stages: [
        {
          stage: "ordered",
          ordinal: 0,
          candidateKey: "target-video",
          targetMediaId: "target-video",
          sourceGenerator: null,
          sourceRank: null,
          sourceScore: null,
          sourceCount: 2,
          sourceSummaries: [],
          contributors,
          normalizedScore: null,
          rrfScore: 1.02,
          deterministicScore: 1.03,
          finalPosition: 3,
          reasonCodes: ["deterministic_score_desc_target_media_id_asc"],
        },
        {
          stage: "composed",
          ordinal: 0,
          candidateKey: "target-video",
          targetMediaId: "target-video",
          sourceGenerator: null,
          sourceRank: null,
          sourceScore: null,
          sourceCount: 2,
          sourceSummaries: [],
          contributors,
          normalizedScore: null,
          rrfScore: null,
          deterministicScore: 1.03,
          finalPosition: 0,
          reasonCodes: [
            "playable_localized_deduplicated",
            "refill_after_suppression",
          ],
        },
      ],
      suppressions: [
        {
          targetMediaId: "recent-video",
          orderedPosition: 0,
          reasonCodes: ["recently_watched"],
          contributors: [contributors[0]!],
        },
      ],
    },
    shadowComparisons: [],
    items: [
      {
        id: "served-item",
        position: 0,
        targetMediaId: "target-video",
        canonicalHref: "/watch/target-video.html",
        candidateGenerator: "multi-interest-profile",
        provenance: { sceneIndex: 2, similarity: 0.87 },
        presentation: {
          videoTitle: "Target video",
          audioLanguageSlug: "english",
        },
        renderedAt: NOW,
        impressionAt: NOW,
        selectedAt: NOW,
        visibilityPolicy: "watch-below-player-v1",
        explanation: null,
        composition: {
          orderedPosition: 3,
          finalPosition: 0,
          movement: -3,
          refill: true,
          reasonCodes: ["refill_after_suppression"],
          contributors,
        },
      },
    ],
    lifecycleEvents: [],
    episodes: [],
    contentActions: [],
    audits: [],
    conflicts: [],
  }
}

describe("RecommendationRequestDetailPanel", () => {
  it("orders hybrid proof from summary through final slate, ancestry, and lifecycle", () => {
    const html = renderToStaticMarkup(
      <RecommendationRequestDetailPanel detail={hybridDetail()} />,
    )

    expect(html).toContain(
      "Semantic context and consented profile signals contributed to one hybrid slate.",
    )
    expect(html).toContain("6 / 6")
    expect(html).toContain("Dual-source")
    expect(html).toContain("source rank 8")
    expect(html).toContain("Refill after suppression")
    expect(html).toContain("Recently Watched")
    expect(html).toContain("generation 7")
    expect(html).toContain("prior-qualified-request")
    expect(html.indexOf("Delivery summary")).toBeLessThan(
      html.indexOf("Final served slate"),
    )
    expect(html.indexOf("Final served slate")).toBeLessThan(
      html.indexOf("Personalization decision"),
    )
    expect(html.indexOf("Personalization decision")).toBeLessThan(
      html.indexOf("Lifecycle timeline"),
    )
    expect(html).not.toMatch(
      /profileId|sessionId|watchHistory|profileVector|cookieValue/i,
    )
  })
})
