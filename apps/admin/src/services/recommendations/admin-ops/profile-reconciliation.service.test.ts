import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { loadRecommendationProfileReconciliationOverview } from "./profile-reconciliation.service"

describe("Admin profile reconciliation overview", () => {
  it("does not query or expose retired profile reconciliation state", async () => {
    const queryRaw = vi.fn()
    const result = await loadRecommendationProfileReconciliationOverview(
      { $queryRaw: queryRaw } as unknown as PrismaClient,
      {
        preset: "24h",
        start: new Date("2026-09-05T23:30:00.000Z"),
        end: new Date("2026-09-06T23:30:00.000Z"),
      },
      new Date("2026-09-06T23:30:00.000Z"),
    )

    expect(result).toBeNull()
    expect(queryRaw).not.toHaveBeenCalled()
  })
})
