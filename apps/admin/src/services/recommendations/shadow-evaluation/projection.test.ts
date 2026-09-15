import { describe, expect, it } from "vitest"
import type {
  CandidateNomination,
  RecommendationCandidateContext,
} from "../candidate"
import { decideShadowEvaluation, evaluateShadowProjection } from "./projection"

const context: RecommendationCandidateContext = {
  surface: "watch-below-player-v1",
  purpose: "watch",
  locale: "en",
  audioLanguageSlug: "english",
}

function nomination(
  targetMediaId: string,
  rank: number,
  score: number,
  overrides: Partial<CandidateNomination> = {},
): CandidateNomination {
  return {
    nominationKey: `profile:${rank}:${targetMediaId}`,
    targetMediaId,
    canonicalIdentity: {
      videoId: targetMediaId,
      videoCoreId: `core-${targetMediaId}`,
      videoTitle: `Video ${targetMediaId}`,
      embeddingText: null,
    },
    presentation: {
      videoSlug: targetMediaId,
      videoTitle: `Video ${targetMediaId}`,
      imageUrl: `https://images.example/${targetMediaId}.jpg`,
      sceneIndex: 0,
      description: "Bounded presentation",
      startSeconds: 0,
      endSeconds: 30,
      themes: rank % 2 === 0 ? ["hope"] : ["faith"],
      demographics: [],
      spiritualContext: [],
      playbackId: `playback-${targetMediaId}`,
      locale: "en",
      audioLanguageSlug: "english",
      watchPlayable: true,
      localePublished: true,
    },
    action: { kind: "scene_start", startSeconds: 0 },
    source: {
      generator: "multi-interest-profile",
      generatorVersion: "multi-interest-profile-v1",
      rank,
      score,
      evidence: { interestOrdinal: rank },
      rejectionReason: null,
    },
    ...overrides,
  }
}

describe("shadow candidate projection", () => {
  it("uses the common eligibility path and proves the live order is untouched", () => {
    const liveOrder = ["video-a", "video-b", "video-c"]
    const result = evaluateShadowProjection({
      context,
      liveOrder,
      nominations: [
        nomination("video-b", 1, 0.9),
        nomination("video-d", 2, 0.8),
        nomination("video-e", 3, 0.7, {
          presentation: {
            ...nomination("video-e", 3, 0.7).presentation,
            watchPlayable: false,
          },
        }),
      ],
      limit: 3,
      projectionCapturedAt: new Date("2026-08-25T09:59:00.000Z"),
      evaluatedAt: new Date("2026-08-25T10:00:00.000Z"),
      latencyMs: 42,
      cohortQuality: 0.8,
    })

    expect(liveOrder).toEqual(["video-a", "video-b", "video-c"])
    expect(result.liveUnchanged).toBe(true)
    expect(result.shadowOrder).toEqual(["video-b", "video-d"])
    expect(result.metrics).toMatchObject({
      overlap: 1 / 2,
      novelty: 1 / 2,
      latencyMs: 42,
      cohortQuality: 0.8,
      inputFreshnessMs: 60_000,
    })
    expect(result.metrics.coverage).toBeCloseTo(2 / 3)
    expect(result.metrics.rejection).toBeCloseTo(1 / 3)
    expect(
      result.nominations.find((row) => row.targetMediaId === "video-e"),
    ).toMatchObject({ eligible: false, reasonCodes: ["watch_restricted"] })
  })

  it("preserves bounded multi-source provenance after canonical deduplication", () => {
    const result = evaluateShadowProjection({
      context,
      liveOrder: ["video-a"],
      nominations: [
        nomination("video-a", 1, 0.9),
        nomination("video-a-alt", 2, 0.8, {
          canonicalIdentity: {
            videoId: "video-a-alt",
            videoCoreId: "core-video-a-square",
            videoTitle: "Video video-a (square)",
            embeddingText: null,
          },
        }),
      ],
      limit: 6,
      projectionCapturedAt: new Date("2026-08-25T10:00:00.000Z"),
      evaluatedAt: new Date("2026-08-25T10:00:00.000Z"),
      latencyMs: 1,
      cohortQuality: null,
    })

    expect(result.shadowOrder).toEqual(["video-a"])
    expect(result.contributions).toEqual([
      { generator: "multi-interest-profile", count: 2 },
    ])
    expect(result.nominations.filter((row) => row.eligible)).toHaveLength(2)
  })

  it("uses hybrid source-relative ranking and the pinned current-video composer without mutating live order", () => {
    const liveOrder = ["seed-video", "video-a"]
    const semantic = (targetMediaId: string, rank: number, score: number) =>
      nomination(targetMediaId, rank, score, {
        nominationKey: `semantic:${rank}:${targetMediaId}`,
        source: {
          generator: "semantic",
          generatorVersion: "semantic-transcript-candidate-v1",
          rank,
          score,
          evidence: {},
          rejectionReason: null,
        },
      })

    const result = evaluateShadowProjection({
      context,
      liveOrder,
      nominations: [
        semantic("seed-video", 1, 1),
        semantic("video-a", 2, 0.99),
        nomination("video-b", 1, 0.01),
      ],
      limit: 3,
      rankingMode: "hybrid",
      currentVideoId: "seed-video",
      projectionCapturedAt: new Date("2026-08-25T10:00:00.000Z"),
      evaluatedAt: new Date("2026-08-25T10:00:00.000Z"),
      latencyMs: 10,
      cohortQuality: 0.8,
    })

    expect(liveOrder).toEqual(["seed-video", "video-a"])
    expect(result.liveUnchanged).toBe(true)
    expect(result.shadowOrder).toEqual(["video-b", "video-a"])
    expect(result.shadowOrder).not.toContain("seed-video")
    expect(result.contributions).toEqual([
      { generator: "multi-interest-profile", count: 1 },
      { generator: "semantic", count: 2 },
    ])
  })

  it("records a conservative terminal decision with a required reevaluation condition", () => {
    expect(
      decideShadowEvaluation({
        metrics: {
          coverage: 0.1,
          overlap: 0,
          novelty: 1,
          diversity: 1,
          rejection: 0.9,
          latencyMs: 80,
          cohortQuality: null,
          inputFreshnessMs: 1_000,
        },
        processedRuns: 2,
        minimumRuns: 10,
      }),
    ).toEqual({
      decision: "inconclusive",
      reasonCode: "insufficient_shadow_samples",
      reevaluationCondition: "collect_at_least_10_processed_shadow_runs",
    })

    expect(
      decideShadowEvaluation({
        metrics: {
          coverage: 0.1,
          overlap: 0,
          novelty: 1,
          diversity: 1,
          rejection: 0.9,
          latencyMs: 80,
          cohortQuality: 0.7,
          inputFreshnessMs: 1_000,
        },
        processedRuns: 20,
        minimumRuns: 10,
      }).decision,
    ).toBe("retire")
  })
})
