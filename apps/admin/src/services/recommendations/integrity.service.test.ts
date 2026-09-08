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
    recommendationSelection: {
      findUnique: vi.fn(),
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => [
        { request: { sessionDigest: "a".repeat(64) } },
      ]),
    },
    recommendationImpression: { findUnique: vi.fn() },
    recommendationConflict: { count: vi.fn(async () => 0) },
    recommendationEvidenceAudit: {
      aggregate: vi.fn(async () => ({ _sum: { count: 0 } })),
    },
    recommendationEligibilityDecision: {
      findFirst: vi.fn(
        async (): Promise<Record<string, unknown> | null> => null,
      ),
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
      revision: 1,
      inputDigest: "1".repeat(64),
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
        state: "FINALIZED",
        finalizedAt: NOW,
        transportReplayCount: 0,
        transportReplayReceipts: [],
        replayCount: 0,
        conflictCount: 0,
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
      revision: 1,
      inputDigest: "2".repeat(64),
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
        state: "FINALIZED",
        finalizedAt: NOW,
        transportReplayCount: 0,
        transportReplayReceipts: [],
        replayCount: 0,
        conflictCount: 0,
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
      revision: 1,
      inputDigest: "3".repeat(64),
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
        state: "FINALIZED",
        finalizedAt: NOW,
        transportReplayCount: 0,
        transportReplayReceipts: [],
        replayCount: 0,
        conflictCount: 0,
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

  it("uses episode-owned conflict evidence for standalone playback", async () => {
    const { prisma, tx } = fixture()
    tx.recommendationOutcomeRevision.findUnique.mockResolvedValue({
      id: "standalone-outcome",
      requestId: null,
      episodeId: "standalone-episode",
      classifierVersion: "active-watch-proxy-v1",
      revision: 1,
      inputDigest: "4".repeat(64),
      qualifiedView: true,
      viewQualityWeight: 0.8,
      createdAt: NOW,
      expiresAt: EXPIRES,
      supersededBy: null,
      episode: {
        id: "standalone-episode",
        sessionDigest: "d".repeat(64),
        mediaId: "media-1",
        capabilityJti: "standalone-jti",
        state: "FINALIZED",
        finalizedAt: NOW,
        transportReplayCount: 0,
        transportReplayReceipts: [],
        replayCount: 0,
        conflictCount: 1,
        createdAt: NOW,
        facts: [{ late: false }],
      },
    })

    await expect(
      new RecommendationIntegrityService({
        prisma: prisma as never,
        now: () => NOW,
        newId: () => "standalone-decision",
      }).classifyPlaybackOutcome("standalone-outcome"),
    ).resolves.toMatchObject({
      state: "quarantined",
      reasonCodes: expect.arrayContaining(["conflicting_evidence"]),
      eligibleScopes: [],
    })
  })

  it("replays an identical immutable classification digest without appending", async () => {
    const { prisma, tx } = fixture()
    tx.recommendationContentAction.findUnique.mockResolvedValue({
      id: "action-replay",
      sessionDigest: "a".repeat(64),
      targetMediaId: "media-1",
      actorClass: "HUMAN_ANONYMOUS",
      actionClass: "HUMAN_ACTION",
      actionDetail: null,
      occurredAt: NOW,
      receivedAt: NOW,
      expiresAt: EXPIRES,
      late: false,
      replayCount: 0,
      conflictCount: 0,
      request: null,
    })
    const service = new RecommendationIntegrityService({
      prisma: prisma as never,
      now: () => NOW,
      newId: () => "decision-replay",
    })

    const first = await service.classifyContentAction("action-replay")
    tx.recommendationEligibilityDecision.findFirst.mockResolvedValue({
      id: first.id,
      revision: first.revision,
      inputDigest: first.inputDigest,
      state: "ELIGIBLE",
      reasonCodes: first.reasonCodes,
      eligibleScopes: first.eligibleScopes,
      contributionWeight: first.contributionWeight,
      evidenceWatermark: first.evidenceWatermark,
    })

    await expect(
      service.classifyContentAction("action-replay"),
    ).resolves.toEqual(first)
    expect(tx.recommendationEligibilityDecision.create).toHaveBeenCalledOnce()
    expect(
      tx.recommendationEligibilityDecision.updateMany,
    ).toHaveBeenCalledOnce()
  })

  it("keeps a navigation-only selection excluded until an impression commits", async () => {
    const { prisma, tx } = fixture()
    tx.recommendationSelection.findUnique.mockResolvedValue({
      id: "selection-1",
      requestId: "request-1",
      itemId: "item-1",
      capabilityJti: "selection-jti",
      eventId: "selection-event",
      payloadDigest: "5".repeat(64),
      attributionEligibleAt: null,
      occurredAt: NOW,
      receivedAt: NOW,
      expiresAt: EXPIRES,
      request: {
        sessionDigest: "a".repeat(64),
        promotionSlateFence: null,
      },
      item: { targetMediaId: "media-1" },
    })
    tx.recommendationImpression.findUnique.mockResolvedValue(null)

    await expect(
      new RecommendationIntegrityService({
        prisma: prisma as never,
        now: () => NOW,
        newId: () => "selection-decision",
      }).classifySelection("selection-1"),
    ).resolves.toMatchObject({
      state: "excluded",
      reasonCodes: ["eligible_impression_required"],
      eligibleScopes: [],
    })
    expect(tx.recommendationEligibilityDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceType: "SELECTION",
        selectionId: "selection-1",
      }),
    })
  })

  it("admits a selection only after the matching Watch impression commits", async () => {
    const { prisma, tx } = fixture()
    tx.recommendationSelection.findUnique.mockResolvedValue({
      id: "selection-eligible",
      requestId: "request-1",
      itemId: "item-1",
      capabilityJti: "selection-jti",
      eventId: "selection-event",
      payloadDigest: "8".repeat(64),
      attributionEligibleAt: NOW,
      occurredAt: NOW,
      receivedAt: NOW,
      expiresAt: EXPIRES,
      request: {
        sessionDigest: "a".repeat(64),
        promotionSlateFence: null,
      },
      item: { targetMediaId: "media-1" },
    })
    tx.recommendationImpression.findUnique.mockResolvedValue({
      id: "impression-1",
      capabilityJti: "impression-jti",
      eventId: "impression-event",
      payloadDigest: "9".repeat(64),
      visibilityPolicy: "watch-below-player-v1",
      receivedAt: NOW,
      expiresAt: EXPIRES,
    })

    await expect(
      new RecommendationIntegrityService({
        prisma: prisma as never,
        now: () => NOW,
        newId: () => "selection-decision",
      }).classifySelection("selection-eligible"),
    ).resolves.toMatchObject({
      state: "eligible",
      eligibleScopes: ["profile"],
    })
    expect(tx.recommendationEligibilityDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ selectionId: "selection-eligible" }),
    })
  })

  it("fails closed when a selection impression uses another visibility policy", async () => {
    const { prisma, tx } = fixture()
    tx.recommendationSelection.findUnique.mockResolvedValue({
      id: "selection-wrong-surface",
      requestId: "request-1",
      itemId: "item-1",
      capabilityJti: "selection-jti",
      eventId: "selection-event",
      payloadDigest: "a".repeat(64),
      attributionEligibleAt: NOW,
      occurredAt: NOW,
      receivedAt: NOW,
      expiresAt: EXPIRES,
      request: {
        sessionDigest: "a".repeat(64),
        promotionSlateFence: null,
      },
      item: { targetMediaId: "media-1" },
    })
    tx.recommendationImpression.findUnique.mockResolvedValue({
      id: "impression-other-surface",
      capabilityJti: "impression-jti",
      eventId: "impression-event",
      payloadDigest: "b".repeat(64),
      visibilityPolicy: "another-surface-v1",
      receivedAt: NOW,
      expiresAt: EXPIRES,
    })

    await expect(
      new RecommendationIntegrityService({
        prisma: prisma as never,
        now: () => NOW,
        newId: () => "selection-decision",
      }).classifySelection("selection-wrong-surface"),
    ).resolves.toMatchObject({
      state: "excluded",
      reasonCodes: ["eligible_impression_required"],
      eligibleScopes: [],
    })
  })

  it("quarantines a selection when its required impression later conflicts", async () => {
    const { prisma, tx } = fixture()
    tx.recommendationSelection.findUnique.mockResolvedValue({
      id: "selection-conflicted-impression",
      requestId: "request-1",
      itemId: "item-1",
      capabilityJti: "selection-jti",
      eventId: "selection-event",
      payloadDigest: "c".repeat(64),
      attributionEligibleAt: NOW,
      occurredAt: NOW,
      receivedAt: NOW,
      expiresAt: EXPIRES,
      request: {
        sessionDigest: "a".repeat(64),
        promotionSlateFence: null,
      },
      item: { targetMediaId: "media-1" },
    })
    tx.recommendationImpression.findUnique.mockResolvedValue({
      id: "impression-conflicted",
      capabilityJti: "impression-jti",
      eventId: "impression-event",
      payloadDigest: "d".repeat(64),
      visibilityPolicy: "watch-below-player-v1",
      receivedAt: NOW,
      expiresAt: EXPIRES,
    })
    tx.recommendationConflict.count.mockResolvedValueOnce(1)

    await expect(
      new RecommendationIntegrityService({
        prisma: prisma as never,
        now: () => NOW,
        newId: () => "selection-decision",
      }).classifySelection("selection-conflicted-impression"),
    ).resolves.toMatchObject({
      state: "quarantined",
      reasonCodes: ["conflicting_evidence"],
      eligibleScopes: [],
    })
    expect(tx.recommendationConflict.count).toHaveBeenCalledWith({
      where: {
        OR: [
          { capabilityJti: "selection-jti", eventId: "selection-event" },
          { capabilityJti: "impression-jti", eventId: "impression-event" },
        ],
      },
    })
  })

  it("fails closed when a legacy replay verdict lacks exact receipts", async () => {
    const { prisma, tx } = fixture()
    tx.recommendationEligibilityDecision.findFirst
      .mockResolvedValueOnce({ reasonCodes: ["replay_velocity_exceeded"] })
      .mockResolvedValueOnce({ revision: 1 })
    tx.recommendationOutcomeRevision.findUnique.mockResolvedValue({
      id: "legacy-outcome",
      requestId: "request-1",
      episodeId: "legacy-episode",
      classifierVersion: "active-watch-proxy-v1",
      revision: 1,
      inputDigest: "6".repeat(64),
      qualifiedView: true,
      viewQualityWeight: 0.8,
      createdAt: NOW,
      expiresAt: EXPIRES,
      supersededBy: null,
      request: null,
      episode: {
        id: "legacy-episode",
        sessionDigest: "a".repeat(64),
        mediaId: "media-1",
        capabilityJti: "legacy-jti",
        state: "FINALIZED",
        finalizedAt: NOW,
        transportReplayCount: 4,
        transportReplayReceipts: [],
        replayCount: 0,
        conflictCount: 0,
        createdAt: NOW,
        facts: [{ late: false }],
      },
    })

    await expect(
      new RecommendationIntegrityService({
        prisma: prisma as never,
        now: () => NOW,
        newId: () => "legacy-decision",
      }).classifyPlaybackOutcome("legacy-outcome"),
    ).resolves.toMatchObject({
      state: "excluded",
      reasonCodes: ["legacy_transport_receipt_evidence_missing"],
    })
  })

  it("re-evaluates a legacy replay verdict only when exact receipts cover the transport count", async () => {
    const { prisma, tx } = fixture()
    tx.recommendationEligibilityDecision.findFirst
      .mockResolvedValueOnce({ reasonCodes: ["replay_velocity_exceeded"] })
      .mockResolvedValueOnce({ revision: 1 })
    tx.recommendationOutcomeRevision.findUnique.mockResolvedValue({
      id: "legacy-outcome-covered",
      requestId: "request-1",
      episodeId: "legacy-episode-covered",
      classifierVersion: "active-watch-proxy-v1",
      revision: 1,
      inputDigest: "7".repeat(64),
      qualifiedView: true,
      viewQualityWeight: 0.8,
      createdAt: NOW,
      expiresAt: EXPIRES,
      supersededBy: null,
      request: null,
      episode: {
        id: "legacy-episode-covered",
        sessionDigest: "a".repeat(64),
        mediaId: "media-1",
        capabilityJti: "legacy-jti-covered",
        state: "FINALIZED",
        finalizedAt: NOW,
        transportReplayCount: 2,
        transportReplayReceipts: [{ id: "receipt-1" }, { id: "receipt-2" }],
        replayCount: 0,
        conflictCount: 0,
        createdAt: NOW,
        facts: [{ late: false }],
      },
    })

    await expect(
      new RecommendationIntegrityService({
        prisma: prisma as never,
        now: () => NOW,
        newId: () => "legacy-covered-decision",
      }).classifyPlaybackOutcome("legacy-outcome-covered"),
    ).resolves.toMatchObject({
      state: "eligible",
      eligibleScopes: ["profile"],
    })
  })
})
