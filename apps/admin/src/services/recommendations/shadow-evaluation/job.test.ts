import { beforeEach, describe, expect, it, vi } from "vitest"

const dispatchState = vi.hoisted(() => ({
  markRecommendationShadowEvaluationRuntimeStarted: vi.fn(),
  finishRecommendationShadowDispatch: vi.fn(),
}))
const service = vi.hoisted(() => ({
  sampleShadowEvaluationContexts: vi.fn(),
  sampleProfileShadowEvaluationContexts: vi.fn(),
  claimNextShadowRun: vi.fn(),
  heartbeatShadowRun: vi.fn(),
  executeClaimedShadowRun: vi.fn(),
  failClaimedShadowRun: vi.fn(),
  completeShadowEvaluation: vi.fn(),
}))

vi.mock("@/db/client", () => ({ prisma: {} }))
vi.mock("./dispatch", async (original) => ({
  ...(await original<typeof import("./dispatch")>()),
  ...dispatchState,
}))
vi.mock("./service", () => service)

import {
  createHybridPersonalizedShadowGenerator,
  HYBRID_PERSONALIZED_SHADOW_GENERATOR_KEY,
  runRecommendationShadowEvaluationJob,
  resolveShadowGenerator,
} from "./job"
import { COWATCH_SHADOW_GENERATOR_KEY } from "../cowatch/graph"

const input = {
  evaluationId: "evaluation-1",
  expectedGeneration: 4,
  generatorKey: "semantic-aa-v1",
  minimumRuns: 10,
}

beforeEach(() => {
  vi.clearAllMocks()
  dispatchState.markRecommendationShadowEvaluationRuntimeStarted.mockResolvedValue(
    true,
  )
  dispatchState.finishRecommendationShadowDispatch.mockResolvedValue(undefined)
  service.sampleShadowEvaluationContexts.mockResolvedValue({
    status: "sampled",
    sampledCount: 1,
    createdCount: 1,
  })
  service.sampleProfileShadowEvaluationContexts.mockResolvedValue({
    status: "sampled",
    sampledCount: 1,
    createdCount: 1,
  })
  service.claimNextShadowRun
    .mockResolvedValueOnce({
      status: "claimed",
      runId: "shadow-run-1",
      claimId: "11111111-1111-4111-8111-111111111111",
      generation: 2,
    })
    .mockResolvedValueOnce({ status: "empty" })
  service.heartbeatShadowRun.mockResolvedValue(true)
  service.executeClaimedShadowRun.mockResolvedValue({
    status: "published",
    replay: false,
  })
  service.completeShadowEvaluation.mockResolvedValue({
    status: "decided",
    decision: "promote_to_experiment",
    decisionId: "decision-1",
  })
})

describe("recommendation shadow evaluation job", () => {
  it("refuses an unpinned co-watch runtime before sampling", async () => {
    await expect(
      runRecommendationShadowEvaluationJob(
        {
          ...input,
          generatorKey: COWATCH_SHADOW_GENERATOR_KEY,
          ledgerRunId: "ledger-1",
        },
        "runtime-1",
      ),
    ).resolves.toMatchObject({
      status: "fenced",
      reason: "cowatch_dispatch_generation_unpinned",
    })
    expect(service.sampleProfileShadowEvaluationContexts).not.toHaveBeenCalled()
    expect(() => resolveShadowGenerator(COWATCH_SHADOW_GENERATOR_KEY)).toThrow(
      "unpinned",
    )
  })

  it("does no sampling or receipt write for a conflicting runtime", async () => {
    dispatchState.markRecommendationShadowEvaluationRuntimeStarted.mockResolvedValueOnce(
      false,
    )
    await expect(
      runRecommendationShadowEvaluationJob(
        { ...input, ledgerRunId: "ledger-1" },
        "conflicting-runtime",
      ),
    ).resolves.toMatchObject({
      status: "fenced",
      reason: "dispatch_runtime_conflict",
    })
    expect(service.sampleShadowEvaluationContexts).not.toHaveBeenCalled()
    expect(
      dispatchState.finishRecommendationShadowDispatch,
    ).not.toHaveBeenCalled()
  })

  it("heartbeats and generation-fences every claimed projection", async () => {
    await expect(
      runRecommendationShadowEvaluationJob(
        {
          ...input,
          ledgerRunId: "ledger-1",
        },
        "runtime-1",
      ),
    ).resolves.toMatchObject({
      status: "decided",
      processedRuns: 1,
      failedRuns: 0,
    })

    expect(service.heartbeatShadowRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId: "shadow-run-1",
        expectedRunGeneration: 2,
        expectedEvaluationGeneration: 4,
      }),
    )
    expect(service.executeClaimedShadowRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId: "shadow-run-1",
        expectedRunGeneration: 2,
        expectedEvaluationGeneration: 4,
      }),
    )
    expect(service.completeShadowEvaluation).toHaveBeenCalledAfter(
      service.executeClaimedShadowRun,
    )
    expect(
      dispatchState.finishRecommendationShadowDispatch,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ minimumRuns: input.minimumRuns }),
      "runtime-1",
      expect.objectContaining({
        summary: expect.stringContaining("promote_to_experiment"),
      }),
    )
  })

  it("does not execute a generator after a lost heartbeat fence", async () => {
    service.heartbeatShadowRun.mockResolvedValueOnce(false)

    await runRecommendationShadowEvaluationJob(input)

    expect(service.executeClaimedShadowRun).not.toHaveBeenCalled()
    expect(service.completeShadowEvaluation).toHaveBeenCalled()
  })

  it.each(["sampling", "completion"])(
    "retains the retry threshold when %s fences the evaluation",
    async (stage) => {
      service.claimNextShadowRun
        .mockReset()
        .mockResolvedValue({ status: "empty" })
      const result = {
        status: "fenced",
        reason: "evaluation_generation_changed",
      }
      if (stage === "sampling") {
        service.sampleShadowEvaluationContexts.mockResolvedValueOnce(result)
      } else {
        service.completeShadowEvaluation.mockResolvedValueOnce(result)
      }

      await expect(
        runRecommendationShadowEvaluationJob(
          {
            ...input,
            ledgerRunId: "ledger-1",
          },
          "runtime-1",
        ),
      ).resolves.toMatchObject({ status: "fenced", reason: result.reason })
      expect(
        dispatchState.finishRecommendationShadowDispatch,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ minimumRuns: input.minimumRuns }),
        "runtime-1",
        expect.objectContaining({
          details: expect.objectContaining({ reason: result.reason }),
        }),
      )
    },
  )

  it("records a bounded failure and continues to the terminal decision", async () => {
    service.executeClaimedShadowRun.mockRejectedValueOnce(
      new Error("raw viewer context must never appear here"),
    )
    service.failClaimedShadowRun.mockResolvedValueOnce(true)

    await expect(
      runRecommendationShadowEvaluationJob(input),
    ).resolves.toMatchObject({
      processedRuns: 0,
      failedRuns: 1,
    })
    expect(service.failClaimedShadowRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: "shadow_generator_failed" }),
    )
  })

  it("uses profile-bound contexts for the exact hybrid generator set", async () => {
    await runRecommendationShadowEvaluationJob({
      ...input,
      generatorKey: HYBRID_PERSONALIZED_SHADOW_GENERATOR_KEY,
    })

    expect(service.sampleProfileShadowEvaluationContexts).toHaveBeenCalledOnce()
    expect(service.sampleShadowEvaluationContexts).not.toHaveBeenCalled()
  })

  it("combines semantic and profile nominations in the hybrid shadow generator", async () => {
    const presentation = {
      videoSlug: "semantic-video",
      videoTitle: "Semantic video",
      imageUrl: "https://images.example/semantic.jpg",
      sceneIndex: 0,
      description: "description",
      startSeconds: 0,
      endSeconds: 30,
      themes: ["hope"],
      demographics: [],
      spiritualContext: [],
      playbackId: "playback-semantic",
      locale: "en",
      audioLanguageSlug: "english",
      watchPlayable: true,
      localePublished: true,
    }
    const profileGenerator = vi.fn(async () => ({
      nominations: [
        {
          nominationKey: "profile:1:profile-video",
          targetMediaId: "profile-video",
          canonicalIdentity: {
            videoId: "profile-video",
            videoCoreId: "profile-core",
            videoTitle: "Profile video",
            embeddingText: null,
          },
          presentation: {
            ...presentation,
            videoSlug: "profile-video",
            videoTitle: "Profile video",
            playbackId: "playback-profile",
          },
          action: { kind: "scene_start" as const, startSeconds: 0 },
          source: {
            generator: "multi-interest-profile",
            generatorVersion: "multi-interest-profile-candidate-v1",
            rank: 1,
            score: 0.9,
            evidence: {},
            rejectionReason: null,
          },
        },
      ],
      projectionCapturedAt: new Date("2026-08-25T00:00:00.000Z"),
      cohortQuality: 0.8,
    }))
    const generator = createHybridPersonalizedShadowGenerator(profileGenerator)

    await expect(
      generator({
        surface: "watch-below-player-v1",
        purpose: "watch",
        locale: "en",
        audioLanguageSlug: "english",
        seedMediaId: "seed-video",
        manifestId: "semantic-profile-hybrid-v1",
        contextProjection: {
          ref: "projection-1",
          version: "multi-interest-profile-projection-v1",
          digest: "d".repeat(64),
          privacyGeneration: 4,
        },
        liveItems: [
          { targetMediaId: "semantic-video", position: 0, presentation },
        ],
      }),
    ).resolves.toMatchObject({
      nominations: [
        { source: { generator: "semantic" } },
        { source: { generator: "multi-interest-profile" } },
      ],
      cohortQuality: 0.8,
    })
  })

  it.each(["profile_projection_unavailable", "profile_candidates_sparse"])(
    "keeps hybrid shadow profile absence source-local for %s",
    async (sourceFailureReason) => {
      const presentation = {
        videoSlug: "semantic-video",
        videoTitle: "Semantic video",
        imageUrl: "https://images.example/semantic.jpg",
        sceneIndex: 0,
        description: "description",
        startSeconds: 0,
        endSeconds: 30,
        themes: ["hope"],
        demographics: [],
        spiritualContext: [],
        playbackId: "playback-semantic",
        locale: "en",
        audioLanguageSlug: "english",
        watchPlayable: true,
        localePublished: true,
      }
      const generator = createHybridPersonalizedShadowGenerator(
        vi.fn(async () => ({
          nominations: [],
          projectionCapturedAt: null,
          cohortQuality: null,
          sourceFailureReason,
        })),
      )

      const result = await generator({
        surface: "watch-below-player-v1",
        purpose: "watch",
        locale: "en",
        audioLanguageSlug: "english",
        seedMediaId: "seed-video",
        manifestId: "semantic-profile-hybrid-v1",
        contextProjection: {
          ref: null,
          version: "multi-interest-profile-projection-v1",
          digest: null,
          privacyGeneration: null,
        },
        liveItems: [
          { targetMediaId: "semantic-video", position: 0, presentation },
        ],
      })

      expect(result).toMatchObject({
        nominations: [{ source: { generator: "semantic" } }],
        projectionCapturedAt: null,
        cohortQuality: null,
        sourceFailureReason,
      })
      expect(
        result.nominations.some(
          (nomination) =>
            nomination.source.generator === "profile-semantic-fallback",
        ),
      ).toBe(false)
    },
  )
})
