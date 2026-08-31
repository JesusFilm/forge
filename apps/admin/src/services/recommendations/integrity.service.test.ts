import { describe, expect, it, vi } from "vitest"
import { RecommendationIntegrityService } from "./integrity.service"

const NOW = new Date("2026-08-25T12:00:00.000Z")
const EXPIRES = new Date("2026-09-23T12:00:00.000Z")

function fixture() {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    recommendationOutcomeRevision: {
      findUnique: vi.fn(),
    },
    recommendationContentAction: {
      findUnique: vi.fn(),
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => [{ sessionDigest: "a".repeat(64) }]),
    },
    recommendationPlaybackEpisode: {
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => [{ sessionDigest: "a".repeat(64) }]),
    },
    recommendationConflict: { count: vi.fn(async () => 0) },
    recommendationEvidenceAudit: {
      aggregate: vi.fn(async () => ({ _sum: { count: 0 } })),
    },
    recommendationEligibilityDecision: {
      findFirst: vi.fn(async (): Promise<{ revision: number } | null> => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }) => ({ id: "decision-1", ...data })),
    },
  }
  const prisma = {
    $transaction: vi.fn(async (callback) => callback(tx)),
  }
  return { prisma, tx }
}

describe("RecommendationIntegrityService", () => {
  it("classifies an immutable playback outcome through the current eligibility decision", async () => {
    const { prisma, tx } = fixture()
    tx.recommendationOutcomeRevision.findUnique.mockResolvedValue({
      id: "outcome-1",
      requestId: "request-1",
      episodeId: "episode-1",
      classifierVersion: "active-watch-proxy-v1",
      qualifiedView: true,
      viewQualityWeight: 0.8,
      createdAt: NOW,
      expiresAt: EXPIRES,
      supersededBy: null,
      episode: {
        id: "episode-1",
        sessionDigest: "a".repeat(64),
        mediaId: "media-1",
        capabilityJti: "episode-jti",
        createdAt: NOW,
        facts: [{ late: false }],
      },
    })

    await expect(
      new RecommendationIntegrityService({
        prisma: prisma as never,
        now: () => NOW,
        newId: () => "decision-1",
      }).classifyPlaybackOutcome("outcome-1"),
    ).resolves.toMatchObject({
      sourceKey: "playback_outcome:outcome-1",
      revision: 1,
      state: "eligible",
      eligibleScopes: ["profile"],
    })

    expect(tx.recommendationEligibilityDecision.create).toHaveBeenCalledOnce()
  })

  it("keeps machine actions inspectable but learning-ineligible", async () => {
    const { prisma, tx } = fixture()
    tx.recommendationContentAction.findUnique.mockResolvedValue({
      id: "action-1",
      sessionDigest: "b".repeat(64),
      targetMediaId: "media-1",
      actorClass: "MACHINE",
      actionClass: "MACHINE_DISPOSITION",
      actionDetail: "delivery_complete",
      occurredAt: NOW,
      receivedAt: NOW,
      expiresAt: EXPIRES,
      late: false,
      replayCount: 0,
      conflictCount: 0,
    })

    await expect(
      new RecommendationIntegrityService({
        prisma: prisma as never,
        now: () => NOW,
        newId: () => "decision-1",
      }).classifyContentAction("action-1"),
    ).resolves.toMatchObject({
      state: "excluded",
      reasonCodes: ["actor_class_machine"],
      eligibleScopes: [],
    })
    expect(tx.recommendationEligibilityDecision.create).toHaveBeenCalledOnce()
  })

  it("appends an excluded current decision for evidence owned by a rolled-back slate", async () => {
    const { prisma, tx } = fixture()
    tx.recommendationOutcomeRevision.findUnique.mockResolvedValue({
      id: "outcome-fenced",
      requestId: "request-fenced",
      episodeId: "episode-fenced",
      classifierVersion: "active-watch-proxy-v1",
      qualifiedView: true,
      viewQualityWeight: 0.9,
      createdAt: NOW,
      expiresAt: EXPIRES,
      supersededBy: null,
      request: {
        promotionSlateFence: {
          reasonCode: "promotion_rollback",
          fencedAt: NOW,
        },
      },
      episode: {
        id: "episode-fenced",
        sessionDigest: "c".repeat(64),
        mediaId: "media-fenced",
        capabilityJti: "episode-fenced-jti",
        createdAt: NOW,
        facts: [{ late: false }],
      },
    })

    await expect(
      new RecommendationIntegrityService({
        prisma: prisma as never,
        now: () => NOW,
        newId: () => "decision-fenced",
      }).classifyPlaybackOutcome("outcome-fenced"),
    ).resolves.toMatchObject({
      state: "excluded",
      reasonCodes: ["promotion_rollback"],
      eligibleScopes: [],
      contributionWeight: 0,
    })
  })

  it("appends a later policy recomputation and replaces the current marker", async () => {
    const { prisma, tx } = fixture()
    tx.recommendationContentAction.findUnique.mockResolvedValue({
      id: "action-1",
      sessionDigest: "a".repeat(64),
      targetMediaId: "media-1",
      actorClass: "HUMAN_ANONYMOUS",
      actionClass: "REPORTED_VALUE",
      actionDetail: "not_helpful",
      occurredAt: NOW,
      receivedAt: NOW,
      expiresAt: EXPIRES,
      late: false,
      replayCount: 0,
      conflictCount: 0,
    })
    tx.recommendationEligibilityDecision.findFirst.mockResolvedValue({
      revision: 2,
    })

    const decision = await new RecommendationIntegrityService({
      prisma: prisma as never,
      now: () => NOW,
      newId: () => "decision-3",
    }).classifyContentAction("action-1")

    expect(decision).toMatchObject({
      revision: 3,
      state: "eligible",
      reasonCodes: ["aggregate_distinct_support_pending"],
    })
    expect(
      tx.recommendationEligibilityDecision.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        sourceKey: "content_action:action-1",
        policyVersion: "recommendation-integrity-v1",
        isCurrent: true,
      },
      data: { isCurrent: false },
    })
  })

  it("retries a stale eligibility write without ever updating the outcome revision", async () => {
    const { prisma, tx } = fixture()
    tx.recommendationOutcomeRevision.findUnique.mockResolvedValue({
      id: "outcome-1",
      requestId: "request-1",
      episodeId: "episode-1",
      classifierVersion: "active-watch-proxy-v1",
      qualifiedView: true,
      viewQualityWeight: 0.8,
      createdAt: NOW,
      expiresAt: EXPIRES,
      supersededBy: null,
      episode: {
        id: "episode-1",
        sessionDigest: "a".repeat(64),
        mediaId: "media-1",
        capabilityJti: "episode-jti",
        createdAt: NOW,
        facts: [{ late: false }],
      },
    })
    prisma.$transaction
      .mockRejectedValueOnce({ code: "P2034" })
      .mockImplementationOnce(async (callback) => callback(tx))

    await expect(
      new RecommendationIntegrityService({
        prisma: prisma as never,
        now: () => NOW,
        newId: () => "decision-retry",
      }).classifyPlaybackOutcome("outcome-1"),
    ).resolves.toMatchObject({ id: "decision-retry", revision: 1 })

    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(
      tx.recommendationEligibilityDecision.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        sourceKey: "playback_outcome:outcome-1",
        policyVersion: "recommendation-integrity-v1",
        isCurrent: true,
      },
      data: { isCurrent: false },
    })
  })
})
