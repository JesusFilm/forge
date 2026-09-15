import { beforeEach, describe, expect, it, vi } from "vitest"

const start = vi.hoisted(() => vi.fn())
const workflowRun = vi.hoisted(() => ({ update: vi.fn() }))
const workflowLog = vi.hoisted(() => ({
  createWorkflowRunLog: vi.fn(),
  attachWorkflowRuntimeRunId: vi.fn(),
  markWorkflowRunFailed: vi.fn(),
  markWorkflowRunRuntimeStarted: vi.fn(),
  markWorkflowRunStarted: vi.fn(),
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

vi.mock("workflow/api", () => ({ start }))
vi.mock("@/db/client", () => ({ prisma: { workflowRun } }))
vi.mock("@/services/workflow-run-log.service", () => workflowLog)
vi.mock("./service", () => service)

import {
  createHybridPersonalizedShadowGenerator,
  dispatchRecommendationShadowEvaluation,
  HYBRID_PERSONALIZED_SHADOW_GENERATOR_KEY,
  runRecommendationShadowEvaluationJob,
} from "./job"
import { runRecommendationShadowEvaluation } from "@/workflows/recommendationShadowEvaluation"

const input = {
  evaluationId: "evaluation-1",
  expectedGeneration: 4,
  generatorKey: "semantic-aa-v1",
  minimumRuns: 10,
}

beforeEach(() => {
  vi.clearAllMocks()
  workflowLog.createWorkflowRunLog.mockResolvedValue({ id: "ledger-1" })
  workflowLog.attachWorkflowRuntimeRunId.mockResolvedValue(undefined)
  workflowLog.markWorkflowRunStarted.mockResolvedValue(undefined)
  workflowLog.markWorkflowRunFailed.mockResolvedValue(undefined)
  workflowRun.update.mockResolvedValue({})
  start.mockResolvedValue({ runId: "runtime-1" })
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
  it("creates business-observable workflow truth before durable dispatch", async () => {
    await expect(
      dispatchRecommendationShadowEvaluation(input),
    ).resolves.toEqual({
      queued: true,
      ledgerRunId: "ledger-1",
      runId: "runtime-1",
    })

    expect(workflowLog.createWorkflowRunLog).toHaveBeenCalledBefore(start)
    expect(start).toHaveBeenCalledWith(runRecommendationShadowEvaluation, [
      { ...input, ledgerRunId: "ledger-1" },
    ])
    expect(workflowLog.attachWorkflowRuntimeRunId).toHaveBeenCalledWith(
      "ledger-1",
      "runtime-1",
    )
  })

  it("keeps an already-started shadow evaluation queued when attachment fails", async () => {
    workflowLog.attachWorkflowRuntimeRunId.mockRejectedValueOnce(
      new Error("attachment unavailable"),
    )

    await expect(
      dispatchRecommendationShadowEvaluation(input),
    ).resolves.toEqual({
      queued: true,
      ledgerRunId: "ledger-1",
      runId: "runtime-1",
    })
    expect(workflowLog.markWorkflowRunFailed).not.toHaveBeenCalled()
  })

  it("marks shadow dispatch failed when workflow start fails", async () => {
    start.mockRejectedValueOnce(new Error("runtime unavailable"))

    await expect(dispatchRecommendationShadowEvaluation(input)).rejects.toThrow(
      "runtime unavailable",
    )
    expect(workflowLog.markWorkflowRunFailed).toHaveBeenCalledOnce()
  })

  it("attributes an operator-triggered dispatch to the authenticated actor", async () => {
    await dispatchRecommendationShadowEvaluation(input, {
      actorId: "admin-1",
    })

    expect(workflowLog.createWorkflowRunLog).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "manual",
        actorId: "admin-1",
        subjectId: "evaluation-1",
      }),
    )
  })

  it("heartbeats and generation-fences every claimed projection", async () => {
    await expect(
      runRecommendationShadowEvaluationJob({
        ...input,
        ledgerRunId: "ledger-1",
      }),
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
    expect(workflowRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ledger-1" },
        data: expect.objectContaining({
          summary: expect.stringContaining("promote_to_experiment"),
        }),
      }),
    )
  })

  it("does not execute a generator after a lost heartbeat fence", async () => {
    service.heartbeatShadowRun.mockResolvedValueOnce(false)

    await runRecommendationShadowEvaluationJob(input)

    expect(service.executeClaimedShadowRun).not.toHaveBeenCalled()
    expect(service.completeShadowEvaluation).toHaveBeenCalled()
  })

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
