import {
  RecommendationProfileState,
  RecommendationShadowEvaluationState,
  RecommendationShadowRunState,
  type PrismaClient,
} from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import type { CandidateNomination } from "../candidate"
import {
  claimNextShadowRun,
  completeShadowEvaluation,
  executeClaimedShadowRun,
  sampleProfileShadowEvaluationContexts,
  sampleShadowEvaluationContexts,
} from "./service"

const NOW = new Date("2026-08-25T10:00:00.000Z")
const EXPIRES = new Date("2026-09-20T10:00:00.000Z")

function liveItem(targetMediaId: string, position: number) {
  return {
    targetMediaId,
    position,
    presentation: {
      videoSlug: targetMediaId,
      videoTitle: targetMediaId,
      imageUrl: `https://images.example/${targetMediaId}.jpg`,
      sceneIndex: 0,
      description: "description",
      startSeconds: 0,
      endSeconds: 30,
      themes: ["hope"],
      demographics: [],
      spiritualContext: [],
      playbackId: `playback-${targetMediaId}`,
      audioLanguageSlug: "english",
    },
  }
}

function nomination(targetMediaId: string): CandidateNomination {
  const item = liveItem(targetMediaId, 0)
  return {
    nominationKey: `profile:1:${targetMediaId}`,
    targetMediaId,
    canonicalIdentity: {
      videoId: targetMediaId,
      videoCoreId: `core-${targetMediaId}`,
      videoTitle: targetMediaId,
      embeddingText: null,
    },
    presentation: {
      ...item.presentation,
      locale: "en",
      watchPlayable: true,
      localePublished: true,
    },
    action: { kind: "scene_start", startSeconds: 0 },
    source: {
      generator: "profile",
      generatorVersion: "profile-v1",
      rank: 1,
      score: 0.9,
      evidence: { interestOrdinal: 1, rawVector: "must-not-persist" },
      rejectionReason: null,
    },
  }
}

function claimedRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "shadow-run-1",
    evaluationId: "evaluation-1",
    requestId: "request-1",
    state: RecommendationShadowRunState.CLAIMED,
    generation: 3,
    claimId: "11111111-1111-4111-8111-111111111111",
    contextProjectionRef: "projection-1",
    contextProjectionVersion: "profile-interest-v1",
    contextProjectionDigest: "c".repeat(64),
    projectionProfileId: null,
    privacyGeneration: null,
    inputCapturedAt: new Date("2026-08-25T09:59:00.000Z"),
    expiresAt: EXPIRES,
    evaluation: {
      state: RecommendationShadowEvaluationState.ACTIVE,
      generation: 3,
      manifestId: "semantic-candidate-platform-v1",
      generatorVersion: "profile-v1",
      eligibilityVersion: "watch-playable-locale-v1",
    },
    request: {
      id: "request-1",
      state: "ISSUED",
      surfaceVersion: "watch-below-player-v1",
      seedMediaId: "seed-media",
      locale: "en",
      expectedItemCount: 2,
      items: [liveItem("video-a", 0), liveItem("video-b", 1)],
    },
    projectionProfile: null,
    ...overrides,
  }
}

describe("shadow evaluation service", () => {
  it("samples issued live contexts deterministically without reading viewer identity", async () => {
    const requests = [
      {
        id: "request-b",
        createdAt: new Date("2026-08-25T09:00:00.000Z"),
        expiresAt: EXPIRES,
        candidateRunId: "candidate-b",
      },
      {
        id: "request-a",
        createdAt: new Date("2026-08-25T08:00:00.000Z"),
        expiresAt: EXPIRES,
        candidateRunId: "candidate-a",
      },
    ]
    const tx = {
      recommendationShadowEvaluation: {
        findUnique: vi.fn().mockResolvedValue({
          id: "evaluation-1",
          state: RecommendationShadowEvaluationState.ACTIVE,
          generation: 3,
          samplingVersion: "stable-request-hash-v1",
          contextVersion: "recommendation-context-v1",
          eligibilityVersion: "watch-playable-locale-v1",
          retentionPolicyVersion: "request-root-29d-aggregate-365d-v1",
          windowStart: new Date("2026-08-24T00:00:00.000Z"),
          windowEnd: NOW,
          requestedSampleSize: 2,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: vi.fn().mockResolvedValue(requests),
      recommendationShadowRun: {
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
        count: vi.fn().mockResolvedValue(2),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (operation) => operation(tx)),
    } as unknown as PrismaClient

    await expect(
      sampleShadowEvaluationContexts(prisma, {
        evaluationId: "evaluation-1",
        expectedGeneration: 3,
        now: NOW,
      }),
    ).resolves.toEqual({ status: "sampled", sampledCount: 2, createdCount: 2 })
    const query = tx.$queryRaw.mock.calls[0]?.[0]
    expect(query.strings.join(" ")).not.toMatch(
      /sessionDigest|tokenDigest|profileVector|query|cohort/i,
    )
    expect(query.strings.join(" ")).toMatch(/ORDER BY md5/)
    const create = tx.recommendationShadowRun.createMany.mock.calls[0]?.[0]
    expect(create.data).toHaveLength(2)
    expect(create.data[0]).toMatchObject({
      samplingDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      contextProjectionVersion: "recommendation-context-v1",
      contextProjectionRef: expect.any(String),
      contextProjectionDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      projectionProfileId: null,
      privacyGeneration: null,
    })
  })

  it("binds profile shadow runs to the exact published privacy generation without exposing membership", async () => {
    const tx = {
      recommendationShadowEvaluation: {
        findUnique: vi.fn().mockResolvedValue({
          id: "evaluation-profile",
          state: RecommendationShadowEvaluationState.ACTIVE,
          generation: 2,
          samplingVersion: "stable-request-hash-v1",
          contextVersion: "multi-interest-profile-projection-v1",
          eligibilityVersion: "watch-playable-locale-v1",
          retentionPolicyVersion: "request-root-29d-aggregate-365d-v1",
          windowStart: new Date("2026-08-24T00:00:00.000Z"),
          windowEnd: NOW,
          requestedSampleSize: 1,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: "request-1",
          createdAt: new Date("2026-08-25T09:00:00.000Z"),
          expiresAt: EXPIRES,
          candidateRunId: "candidate-1",
          projectionId: "projection-1",
          projectionVersion: "multi-interest-profile-projection-v1",
          projectionDigest: "d".repeat(64),
          projectionPublishedAt: new Date("2026-08-25T08:59:00.000Z"),
          projectionProfileId: "private-profile-1",
          privacyGeneration: 7,
        },
      ]),
      recommendationShadowRun: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(1),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (operation) => operation(tx)),
    } as unknown as PrismaClient

    await expect(
      sampleProfileShadowEvaluationContexts(prisma, {
        evaluationId: "evaluation-profile",
        expectedGeneration: 2,
        now: NOW,
      }),
    ).resolves.toMatchObject({ status: "sampled", createdCount: 1 })

    const created =
      tx.recommendationShadowRun.createMany.mock.calls[0]![0].data[0]
    expect(created).toMatchObject({
      contextProjectionRef: "projection-1",
      contextProjectionVersion: "multi-interest-profile-projection-v1",
      contextProjectionDigest: "d".repeat(64),
      projectionProfileId: "private-profile-1",
      privacyGeneration: 7,
      inputCapturedAt: new Date("2026-08-25T08:59:00.000Z"),
    })
    expect(JSON.stringify(created)).not.toMatch(/tokenDigest|cookie|embedding/)
  })

  it("claims one pending run with an evaluation-generation fence", async () => {
    const tx = {
      recommendationShadowRun: {
        findFirst: vi.fn().mockResolvedValue({ id: "run-1", generation: 1 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (operation) => operation(tx)),
    } as unknown as PrismaClient

    const result = await claimNextShadowRun(prisma, {
      evaluationId: "evaluation-1",
      expectedGeneration: 3,
      now: NOW,
      claimId: "11111111-1111-4111-8111-111111111111",
    })

    expect(result).toMatchObject({ status: "claimed", runId: "run-1" })
    expect(tx.recommendationShadowRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          state: RecommendationShadowRunState.PENDING,
          evaluation: {
            state: RecommendationShadowEvaluationState.ACTIVE,
            generation: 3,
          },
        }),
      }),
    )
    expect(tx.recommendationShadowRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "run-1", generation: 1 }),
        data: expect.objectContaining({
          state: RecommendationShadowRunState.CLAIMED,
          heartbeatAt: NOW,
        }),
      }),
    )
  })

  it("publishes bounded counterfactual evidence without mutating live request items", async () => {
    const run = claimedRun()
    const tx = {
      recommendationShadowRun: {
        findUnique: vi.fn().mockResolvedValue(run),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      recommendationRequest: {
        findUnique: vi.fn().mockResolvedValue({
          state: "ISSUED",
          items: run.request.items,
        }),
      },
      recommendationShadowNomination: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const prisma = {
      recommendationShadowRun: {
        findUnique: vi.fn().mockResolvedValue(run),
      },
      $transaction: vi.fn(async (operation) => operation(tx)),
    } as unknown as PrismaClient
    const generator = vi.fn().mockResolvedValue({
      nominations: [nomination("video-b")],
      cohortQuality: 0.8,
      projectionCapturedAt: new Date("2026-08-25T09:59:00.000Z"),
    })

    const result = await executeClaimedShadowRun(prisma, {
      runId: "shadow-run-1",
      expectedRunGeneration: 3,
      expectedEvaluationGeneration: 3,
      claimId: "11111111-1111-4111-8111-111111111111",
      now: NOW,
      generator,
    })

    expect(result).toMatchObject({ status: "published", replay: false })
    expect(generator).toHaveBeenCalledWith(
      expect.not.objectContaining({ sessionDigest: expect.anything() }),
    )
    expect(tx.recommendationRequest.findUnique).toHaveBeenCalledTimes(1)
    expect(tx.recommendationShadowNomination.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          targetMediaId: "video-b",
          overlapsLive: true,
          provenance: { interestOrdinal: 1 },
          expiresAt: EXPIRES,
        }),
      ],
    })
    expect(tx.recommendationShadowRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: RecommendationShadowRunState.PUBLISHED,
          liveSlateUnchanged: true,
        }),
      }),
    )
  })

  it("returns an idempotent replay without invoking the generator", async () => {
    const generator = vi.fn()
    const prisma = {
      recommendationShadowRun: {
        findUnique: vi
          .fn()
          .mockResolvedValue(
            claimedRun({ state: RecommendationShadowRunState.PUBLISHED }),
          ),
      },
    } as unknown as PrismaClient

    await expect(
      executeClaimedShadowRun(prisma, {
        runId: "shadow-run-1",
        expectedRunGeneration: 3,
        expectedEvaluationGeneration: 3,
        claimId: "11111111-1111-4111-8111-111111111111",
        now: NOW,
        generator,
      }),
    ).resolves.toMatchObject({ status: "published", replay: true })
    expect(generator).not.toHaveBeenCalled()
  })

  it("fences a late claim when the evaluation generation changes before publish", async () => {
    const run = claimedRun()
    const tx = {
      recommendationShadowRun: {
        findUnique: vi.fn().mockResolvedValue({
          state: RecommendationShadowRunState.CLAIMED,
          generation: 3,
          claimId: "11111111-1111-4111-8111-111111111111",
          evaluation: {
            state: RecommendationShadowEvaluationState.ACTIVE,
            generation: 4,
          },
        }),
      },
      recommendationRequest: { findUnique: vi.fn() },
      recommendationShadowNomination: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
    }
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const prisma = {
      recommendationShadowRun: {
        findUnique: vi.fn().mockResolvedValue(run),
        updateMany,
      },
      $transaction: vi.fn(async (operation) => operation(tx)),
    } as unknown as PrismaClient
    const generator = vi.fn().mockResolvedValue({
      nominations: [nomination("video-b")],
      cohortQuality: 0.8,
      projectionCapturedAt: NOW,
    })

    await expect(
      executeClaimedShadowRun(prisma, {
        runId: "shadow-run-1",
        expectedRunGeneration: 3,
        expectedEvaluationGeneration: 3,
        claimId: "11111111-1111-4111-8111-111111111111",
        now: NOW,
        generator,
      }),
    ).resolves.toEqual({ status: "fenced", reason: "late_claim_fenced" })
    expect(tx.recommendationRequest.findUnique).not.toHaveBeenCalled()
    expect(tx.recommendationShadowNomination.createMany).not.toHaveBeenCalled()
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: RecommendationShadowRunState.FENCED,
          failureReason: "late_claim_fenced",
        }),
      }),
    )
  })

  it("fences and redacts a deleted profile generation before projection", async () => {
    const run = claimedRun({
      projectionProfileId: "profile-1",
      privacyGeneration: 4,
      projectionProfile: {
        state: RecommendationProfileState.TOMBSTONED,
        privacyGeneration: 4,
      },
    })
    const tx = {
      recommendationShadowNomination: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      recommendationShadowRun: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const prisma = {
      recommendationShadowRun: { findUnique: vi.fn().mockResolvedValue(run) },
      $transaction: vi.fn(async (operation) => operation(tx)),
    } as unknown as PrismaClient
    const generator = vi.fn()

    await expect(
      executeClaimedShadowRun(prisma, {
        runId: "shadow-run-1",
        expectedRunGeneration: 3,
        expectedEvaluationGeneration: 3,
        claimId: "11111111-1111-4111-8111-111111111111",
        now: NOW,
        generator,
      }),
    ).resolves.toEqual({
      status: "fenced",
      reason: "profile_generation_revoked",
    })
    expect(generator).not.toHaveBeenCalled()
    expect(tx.recommendationShadowRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectionProfileId: null,
          privacyGeneration: null,
          contextProjectionRef: null,
          contextProjectionDigest: null,
        }),
      }),
    )
  })

  it("writes one terminal decision with exact digest and no serving mutation", async () => {
    const evaluation = {
      id: "evaluation-1",
      state: RecommendationShadowEvaluationState.ACTIVE,
      generation: 3,
      requestedSampleSize: 10,
      expiresAt: new Date("2027-08-25T10:00:00.000Z"),
      decision: null,
      runs: Array.from({ length: 10 }, (_, index) => ({
        state: RecommendationShadowRunState.PUBLISHED,
        coverage: 0.8,
        overlap: 0.5,
        novelty: 0.5,
        diversity: 0.7,
        rejection: 0.1,
        latencyMs: 100 + index,
        cohortQuality: 0.8,
        inputFreshnessMs: 1_000,
        liveSlateDigest: "a".repeat(64),
        shadowSlateDigest: "b".repeat(64),
      })),
    }
    const tx = {
      recommendationShadowEvaluation: {
        findUnique: vi.fn().mockResolvedValue(evaluation),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      recommendationShadowDecision: {
        create: vi.fn().mockResolvedValue({ id: "decision-1" }),
      },
      recommendationServingControl: { update: vi.fn() },
      recommendationRequest: { update: vi.fn() },
      recommendationServedItem: { update: vi.fn() },
    }
    const prisma = {
      $transaction: vi.fn(async (operation) => operation(tx)),
    } as unknown as PrismaClient

    const result = await completeShadowEvaluation(prisma, {
      evaluationId: "evaluation-1",
      expectedGeneration: 3,
      now: NOW,
      minimumRuns: 10,
    })

    expect(result).toMatchObject({
      status: "decided",
      decision: "promote_to_experiment",
      decisionId: "decision-1",
    })
    expect(tx.recommendationShadowDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inputDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        reevaluationCondition: expect.any(String),
      }),
    })
    expect(tx.recommendationServingControl.update).not.toHaveBeenCalled()
    expect(tx.recommendationRequest.update).not.toHaveBeenCalled()
    expect(tx.recommendationServedItem.update).not.toHaveBeenCalled()
  })
})
