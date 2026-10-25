import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { loadRecommendationPrivacyHealth } from "./privacy.service"

describe("recommendation privacy health", () => {
  it("returns aggregate and one non-linkable transition detail without identity material", async () => {
    const prisma = {
      recommendationProfile: {
        count: vi
          .fn()
          .mockResolvedValueOnce(4)
          .mockResolvedValueOnce(2)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(0),
        aggregate: vi.fn().mockResolvedValue({
          _sum: { staleWorkerRejections: 3 },
          _max: { deletionDrillAt: new Date("2026-08-25T11:00:00.000Z") },
        }),
      },
      recommendationConsentTransition: {
        groupBy: vi.fn().mockResolvedValue([
          { kind: "GRANT", _count: { _all: 5 } },
          { kind: "WITHDRAW", _count: { _all: 2 } },
        ]),
        findFirst: vi.fn().mockResolvedValue({
          kind: "WITHDRAW",
          fromGeneration: 2,
          toGeneration: null,
          erasureState: "PENDING",
          occurredAt: new Date("2026-08-25T11:30:00.000Z"),
        }),
      },
    }

    const health = await loadRecommendationPrivacyHealth(
      prisma as unknown as PrismaClient,
      {
        start: new Date("2026-08-24T12:00:00.000Z"),
        end: new Date("2026-08-25T12:00:00.000Z"),
      },
    )

    expect(health).toEqual({
      profiles: {
        active: 4,
        tombstoned: 2,
        expired: 1,
        pendingErasure: 1,
        failedErasure: 0,
      },
      transitions: { grant: 5, reset: 0, withdraw: 2, delete: 0, expire: 0 },
      staleWorkerRejections: 3,
      lastDeletionDrillAt: new Date("2026-08-25T11:00:00.000Z"),
      latestTransition: {
        kind: "withdraw",
        fromGeneration: 2,
        toGeneration: null,
        erasureState: "pending",
        occurredAt: new Date("2026-08-25T11:30:00.000Z"),
      },
    })
    expect(JSON.stringify(health)).not.toMatch(
      /profileId|session|cookie|token|digest|auditId|history/i,
    )
  })
})
