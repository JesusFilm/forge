import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { loadRecommendationPrivacyHealth } from "./privacy.service"

describe("recommendation privacy health", () => {
  it("returns a non-linkable retired profile view without reading old rows", async () => {
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
        active: 0,
        tombstoned: 0,
        expired: 0,
        pendingErasure: 0,
        failedErasure: 0,
      },
      transitions: { grant: 0, reset: 0, withdraw: 0, delete: 0, expire: 0 },
      staleWorkerRejections: 0,
      lastDeletionDrillAt: null,
      latestTransition: null,
    })
    expect(prisma.recommendationProfile.count).not.toHaveBeenCalled()
    expect(prisma.recommendationProfile.aggregate).not.toHaveBeenCalled()
    expect(
      prisma.recommendationConsentTransition.groupBy,
    ).not.toHaveBeenCalled()
    expect(
      prisma.recommendationConsentTransition.findFirst,
    ).not.toHaveBeenCalled()
    expect(JSON.stringify(health)).not.toMatch(
      /profileId|session|cookie|token|digest|auditId|history/i,
    )
  })
})
