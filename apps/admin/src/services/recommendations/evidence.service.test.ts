import { describe, expect, it, vi } from "vitest"
import { RecommendationTokenInvalidError } from "./token.service"
import { RecommendationEvidenceService } from "./evidence.service"
import { RecommendationBindingError } from "./errors"

const caller = {
  id: null,
  role: "CONSUMER_BEARER" as const,
  fleet: false,
  rateLimitBucketKey: "test-web-consumer-key",
}

function harness() {
  const rendered = new Map<string, { payloadDigest: string }>()
  const impressions = new Map<string, { payloadDigest: string }>()
  const conflicts: object[] = []
  const item = {
    id: "item-1",
    requestId: "request-1",
    capabilityJti: "jti-1",
    expiresAt: new Date("2026-09-17T03:00:00.000Z"),
    request: {
      id: "request-1",
      state: "ISSUED",
      manifestId: "semantic-transcript-pgvector-v1",
      sessionDigest: "a".repeat(64),
      expiresAt: new Date("2026-09-17T03:00:00.000Z"),
    },
  }
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => {
      conflicts.push({})
      return [{ attempts: 1 }]
    }),
    recommendationRenderedFact: {
      findUnique: vi.fn(async () => rendered.get(item.id) ?? null),
      create: vi.fn(async ({ data }: { data: { payloadDigest: string } }) => {
        rendered.set(item.id, data)
        return data
      }),
    },
    recommendationImpression: {
      findUnique: vi.fn(async () => impressions.get(item.id) ?? null),
      create: vi.fn(async ({ data }: { data: { payloadDigest: string } }) => {
        impressions.set(item.id, data)
        return data
      }),
    },
    recommendationExperimentExposure: {
      createMany: vi.fn(async () => ({ count: 1 })),
    },
    recommendationPromotionPointer: {
      findUnique: vi.fn(async () => ({
        activeManifestId: "semantic-experiment-aa-v1",
        lastKnownGoodManifestId: "semantic-transcript-pgvector-v1",
        stage: "BOUNDED",
        exposureCeilingBps: 5_000,
        generation: 2,
      })),
    },
    recommendationPromotionEvent: {
      createMany: vi.fn(async () => ({ count: 1 })),
    },
    recommendationEvidenceAudit: { create: vi.fn(async () => ({})) },
  }
  const prisma = {
    recommendationServedItem: { findUnique: vi.fn(async () => item) },
    recommendationEvidenceAudit: { create: vi.fn(async () => ({})) },
    $queryRaw: vi.fn(
      async (): Promise<Array<{ attempts: number | null }>> => [
        { attempts: 1 },
      ],
    ),
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
      work(tx),
    ),
  }
  const verifyDeliveryCapability = vi.fn(async () => ({
    iat: 1_776_654_000,
    exp: 1_776_654_600,
  }))
  const service = new RecommendationEvidenceService({
    prisma: prisma as never,
    tokenService: { verifyDeliveryCapability },
    now: () => new Date("2026-04-20T03:00:00.000Z"),
  })
  return { service, conflicts, item, prisma, tx, verifyDeliveryCapability }
}

const validInput = {
  caller,
  contractVersion: "recommendation-evidence-v1",
  capability: "opaque-token",
  requestId: "request-1",
  itemId: "item-1",
  sessionDigest: "a".repeat(64),
  events: [
    {
      eventId: "render-1",
      kind: "render" as const,
      occurredAt: "2026-04-20T03:00:00.000Z",
      payload: {},
    },
  ],
}

describe("RecommendationEvidenceService", () => {
  it("rejects a profile-linked delivery capability after its privacy generation is fenced", async () => {
    const { service, item, verifyDeliveryCapability } = harness()
    Object.assign(item.request, {
      experimentAssignment: {
        id: "assignment-profile",
        profileId: "profile-1",
        privacyGeneration: 4,
        state: "FENCED",
        expiresAt: new Date("2026-09-01T00:00:00.000Z"),
        profile: {
          state: "TOMBSTONED",
          tokenDigest: null,
          privacyGeneration: 4,
          expiresAt: new Date("2027-02-21T00:00:00.000Z"),
        },
      },
    })

    await expect(service.record(validInput)).rejects.toBeInstanceOf(
      RecommendationBindingError,
    )
    expect(verifyDeliveryCapability).not.toHaveBeenCalled()
  })

  it("creates one actual exposure only for an accepted eligible impression", async () => {
    const { service, item, tx, verifyDeliveryCapability } = harness()
    Object.assign(item.request, {
      experimentAssignment: {
        id: "assignment-1",
        experimentId: "semantic-aa-v1",
        configurationDigest: "b".repeat(64),
        assignmentProbability: 0.5,
        generation: 1,
        arm: "CHALLENGER",
        state: "ACTIVE",
        experiment: {
          experimentVersion: "semantic-aa-v1",
          generation: 1,
          configurationDigest: "b".repeat(64),
          controlManifestId: "semantic-transcript-pgvector-v1",
          challengerManifestId: "semantic-experiment-aa-v1",
        },
      },
    })
    const impression = {
      ...validInput,
      events: [
        {
          ...validInput.events[0]!,
          eventId: "impression-1",
          kind: "impression" as const,
          payload: { visibilityPolicy: "watch-below-player-v1" },
        },
      ],
    }
    await expect(service.record(impression)).resolves.toEqual([
      { eventId: "impression-1", status: "accepted" },
    ])
    expect(verifyDeliveryCapability).toHaveBeenCalledWith(
      "opaque-token",
      expect.objectContaining({
        assignmentId: "assignment-1",
        experimentArm: "challenger",
        effectiveManifestId: "semantic-experiment-aa-v1",
      }),
    )
    expect(tx.recommendationExperimentExposure.createMany).toHaveBeenCalledWith(
      {
        data: [
          expect.objectContaining({
            assignmentId: "assignment-1",
            requestId: "request-1",
            itemId: "item-1",
            arm: "CHALLENGER",
            effectiveManifestId: "semantic-experiment-aa-v1",
          }),
        ],
        skipDuplicates: true,
      },
    )
    expect(tx.recommendationPromotionEvent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          eventType: "FIRST_ELIGIBLE_EXPOSURE",
          pointerGeneration: 2,
          toManifestId: "semantic-experiment-aa-v1",
        }),
      ],
      skipDuplicates: true,
    })

    await service.record(impression)
    expect(
      tx.recommendationExperimentExposure.createMany,
    ).toHaveBeenCalledTimes(1)
  })

  it("preserves a rolled-back stored slate without granting it new exposure credit", async () => {
    const { service, item, tx } = harness()
    Object.assign(item.request, {
      promotionSlateFence: { reasonCode: "promotion_rollback" },
      experimentAssignment: {
        id: "assignment-1",
        experimentId: "semantic-aa-v1",
        configurationDigest: "b".repeat(64),
        assignmentProbability: 0.5,
        generation: 1,
        arm: "CHALLENGER",
        state: "ACTIVE",
        experiment: {
          experimentVersion: "semantic-aa-v1",
          generation: 1,
          configurationDigest: "b".repeat(64),
          controlManifestId: "semantic-transcript-pgvector-v1",
          challengerManifestId: "semantic-experiment-aa-v1",
        },
      },
    })
    await service.record({
      ...validInput,
      events: [
        {
          ...validInput.events[0]!,
          eventId: "post-rollback-impression",
          kind: "impression",
          payload: { visibilityPolicy: "watch-below-player-v1" },
        },
      ],
    })
    expect(tx.recommendationImpression.create).toHaveBeenCalled()
    expect(
      tx.recommendationExperimentExposure.createMany,
    ).not.toHaveBeenCalled()
    expect(tx.recommendationPromotionEvent.createMany).not.toHaveBeenCalled()
  })

  it("accepts an identical replay and quarantines a conflicting replay", async () => {
    const { service, conflicts, tx } = harness()

    expect(await service.record(validInput)).toEqual([
      { eventId: "render-1", status: "accepted" },
    ])
    expect(tx.$executeRaw).toHaveBeenCalledOnce()
    expect(tx.$executeRaw).toHaveBeenCalledBefore(
      tx.recommendationRenderedFact.findUnique,
    )
    expect(await service.record(validInput)).toEqual([
      { eventId: "render-1", status: "replay" },
    ])
    expect(
      await service.record({
        ...validInput,
        events: [{ ...validInput.events[0]!, payload: { changed: true } }],
      }),
    ).toEqual([{ eventId: "render-1", status: "conflict" }])
    expect(conflicts).toHaveLength(1)
    // Tagged template plus all seven function parameters, including the
    // generated conflict id required by migration 0052.
    expect(tx.$queryRaw.mock.calls[0]).toHaveLength(8)
  })

  it("rejects bounds, bindings, and verifier failures before business writes", async () => {
    const oversized = harness()
    await expect(
      oversized.service.record({
        ...validInput,
        events: [
          {
            ...validInput.events[0]!,
            payload: { value: "x".repeat(8 * 1024) },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_input" })
    expect(
      oversized.prisma.recommendationServedItem.findUnique,
    ).not.toHaveBeenCalled()

    const invalidContract = harness()
    await expect(
      invalidContract.service.record({
        ...validInput,
        contractVersion: "wrong-contract",
      }),
    ).rejects.toThrow()
    expect(
      invalidContract.prisma.recommendationServedItem.findUnique,
    ).not.toHaveBeenCalled()
    expect(invalidContract.prisma.$transaction).not.toHaveBeenCalled()

    const missingItem = harness()
    missingItem.prisma.recommendationServedItem.findUnique.mockResolvedValueOnce(
      null as never,
    )
    await expect(missingItem.service.record(validInput)).rejects.toMatchObject({
      code: "invalid_binding",
    })
    expect(missingItem.verifyDeliveryCapability).not.toHaveBeenCalled()
    expect(missingItem.prisma.$queryRaw).not.toHaveBeenCalled()
    expect(missingItem.prisma.$transaction).not.toHaveBeenCalled()

    const rejectedToken = harness()
    rejectedToken.verifyDeliveryCapability.mockRejectedValueOnce(
      new RecommendationTokenInvalidError(),
    )
    await expect(
      rejectedToken.service.record(validInput),
    ).rejects.toBeInstanceOf(RecommendationTokenInvalidError)
    expect(rejectedToken.prisma.$queryRaw).not.toHaveBeenCalled()
    expect(rejectedToken.prisma.$transaction).not.toHaveBeenCalled()
  })

  it("commits sanitized rejection signals without accepting invalid evidence", async () => {
    const timestamp = harness()
    await expect(
      timestamp.service.record({
        ...validInput,
        events: [
          {
            ...validInput.events[0]!,
            occurredAt: "2026-04-20T04:00:01.000Z",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_input" })
    expect(timestamp.prisma.$queryRaw).toHaveBeenCalledOnce()
    expect(timestamp.prisma.$transaction).not.toHaveBeenCalled()
    expect(
      timestamp.prisma.recommendationEvidenceAudit.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "COMMITTED_REJECTION",
        reasonCode: "delivery_timestamp_invalid",
      }),
    })

    const visibility = harness()
    await expect(
      visibility.service.record({
        ...validInput,
        events: [
          {
            ...validInput.events[0]!,
            kind: "impression",
            payload: { visibilityPolicy: "wrong-policy" },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_input" })
    expect(visibility.prisma.$transaction).not.toHaveBeenCalled()
    expect(
      visibility.prisma.recommendationEvidenceAudit.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reasonCode: "delivery_visibility_policy_invalid",
      }),
    })
  })

  it("enforces an atomic event-attempt budget before replay or conflict writes", async () => {
    const exhausted = harness()
    exhausted.prisma.$queryRaw.mockResolvedValueOnce([{ attempts: null }])

    await expect(exhausted.service.record(validInput)).rejects.toMatchObject({
      code: "invalid_binding",
    })
    expect(exhausted.prisma.$queryRaw.mock.calls[0]).toHaveLength(6)
    expect(exhausted.prisma.$transaction).not.toHaveBeenCalled()
    // The SQL function owns one deterministic saturating rejection row; the
    // service must not append a fresh audit row after the cap is exhausted.
    expect(
      exhausted.prisma.recommendationEvidenceAudit.create,
    ).not.toHaveBeenCalled()
  })
})
