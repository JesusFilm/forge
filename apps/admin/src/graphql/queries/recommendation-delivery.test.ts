import { beforeEach, describe, expect, it, vi } from "vitest"

const deliverMock = vi.fn()
vi.mock("@/services/recommendations/delivery.service", () => ({
  createRecommendationDeliveryService: vi.fn(() => ({
    deliver: deliverMock,
  })),
}))
vi.mock("@/db/client", () => ({ prisma: {} }))

import { schema } from "@/graphql/schema"

function resolver() {
  return schema.getQueryType()!.getFields().semanticRecommendationDelivery!
    .resolve!
}

const args = {
  seedMediaId: "seed-video",
  locale: "en",
  audioLanguageSlug: "english",
  sessionDigest: "a".repeat(64),
}

beforeEach(() => {
  vi.clearAllMocks()
  deliverMock.mockResolvedValue({
    contractVersion: "semantic-recommendation-v1",
    surfaceVersion: "watch-below-player-v1",
    strategyVersion: "semantic-transcript-pgvector-v1",
    classifierVersion: "legacy-position-v0",
    requestId: null,
    result: "unavailable",
    reason: "control_disabled",
    expiresAt: null,
    items: [],
  })
})

describe("semanticRecommendationDelivery resolver", () => {
  it("exposes an additive nullable video runtime on delivery items", () => {
    const item = schema.getType("SemanticRecommendationDeliveryItem") as {
      getFields(): Record<string, { type: { toString(): string } }>
    }

    expect(item.getFields().durationSeconds?.type.toString()).toBe("Float")
  })

  it("admits only the non-fleet Web consumer bearer", async () => {
    await expect(
      resolver()(null, args, { user: null }, {} as never),
    ).rejects.toThrow("Web consumer authentication required")
    await expect(
      resolver()(
        null,
        args,
        { user: { role: "WORKFLOW_TRIGGER", id: null } },
        {} as never,
      ),
    ).rejects.toThrow("Web consumer authentication required")
    await expect(
      resolver()(
        null,
        args,
        {
          user: {
            role: "CONSUMER_BEARER",
            id: null,
            fleet: true,
            rateLimitBucketKey: "fleet-key",
          },
        },
        {} as never,
      ),
    ).rejects.toThrow("Web consumer authentication required")

    await resolver()(
      null,
      args,
      {
        user: {
          role: "CONSUMER_BEARER",
          id: null,
          fleet: false,
          rateLimitBucketKey: "web-key",
        },
      },
      {} as never,
    )
    expect(deliverMock).toHaveBeenCalledWith({
      ...args,
      consentReceiptDigest: null,
      profileTokenDigest: null,
      eligibleHuman: true,
      caller: {
        role: "CONSUMER_BEARER",
        id: null,
        fleet: false,
        rateLimitBucketKey: "web-key",
      },
    })
  })

  it("passes through a trusted machine exclusion from Web", async () => {
    await resolver()(
      null,
      { ...args, eligibleHuman: false },
      {
        user: {
          role: "CONSUMER_BEARER",
          id: null,
          fleet: false,
          rateLimitBucketKey: "web-key",
        },
      },
      {} as never,
    )

    expect(deliverMock).toHaveBeenCalledWith(
      expect.objectContaining({ eligibleHuman: false }),
    )
  })
})
