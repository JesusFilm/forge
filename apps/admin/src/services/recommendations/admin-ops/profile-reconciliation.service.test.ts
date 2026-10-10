import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { loadRecommendationProfileReconciliationOverview } from "./profile-reconciliation.service"

const NOW = new Date("2026-09-06T23:30:00.000Z")
const WINDOW = {
  preset: "24h" as const,
  start: new Date("2026-09-05T23:30:00.000Z"),
  end: NOW,
}

function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    ineligibleGenerations: 4n,
    affectedPointers: 4n,
    affectedContributions: 7n,
    rebuildCandidates: 4n,
    rebuildBacklog: 3n,
    replacementPublications: 5n,
    staleClaims: 3n,
    reclaimedRuns: 4n,
    terminalRuns: 0n,
    servingFences: 3n,
    affectedRequests: 3n,
    cleanHybridRequests: 8n,
    reasonCounts: { eligibility_revision_superseded: 4 },
    ...overrides,
  }
}

describe("Admin profile reconciliation overview", () => {
  it("returns bounded aggregate repair and serving evidence without identities", async () => {
    const queryRaw = vi.fn().mockResolvedValue([dbRow()])
    const result = await loadRecommendationProfileReconciliationOverview(
      { $queryRaw: queryRaw } as unknown as PrismaClient,
      WINDOW,
      NOW,
    )

    expect(result).toMatchObject({
      state: "repairing",
      suppressed: false,
      currentPointerInvariant: "violated",
      counts: {
        affectedPointers: 4,
        affectedContributions: 7,
        rebuildBacklog: 3,
        replacementPublications: 5,
        staleClaims: 3,
        reclaimedRuns: 4,
        servingFences: 3,
        affectedRequests: 3,
        cleanHybridRequests: 8,
      },
      reasonCodes: [
        { reasonCode: "eligibility_revision_superseded", count: 4 },
      ],
    })
    expect(JSON.stringify(result)).not.toMatch(
      /profileId|sessionDigest|sourceId|requestId|vector|history/i,
    )
    const query = queryRaw.mock.calls[0]?.[0]
    const sql = String(query.sql ?? query.text ?? query.strings)
    expect(sql).toContain("source_eligibility_revision")
    expect(sql).toContain("profile_lineage_ineligible")
    expect(sql).toContain("attempt_count")
    expect(sql).toContain("next_fact_sequence")
    expect(sql).toContain("recommendation_conflict")
    expect(sql).toContain("LIMIT 8")
  })

  it("suppresses overlapping small metrics even when their sum reaches the threshold", async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      dbRow({
        ineligibleGenerations: 3n,
        affectedPointers: 1n,
        affectedContributions: 3n,
        rebuildCandidates: 3n,
        rebuildBacklog: 1n,
        replacementPublications: 3n,
        staleClaims: 0n,
        reclaimedRuns: 3n,
        terminalRuns: 0n,
        servingFences: 1n,
        affectedRequests: 3n,
        cleanHybridRequests: 3n,
        reasonCounts: { eligibility_revision_superseded: 3 },
      }),
    ])

    await expect(
      loadRecommendationProfileReconciliationOverview(
        { $queryRaw: queryRaw } as unknown as PrismaClient,
        WINDOW,
        NOW,
      ),
    ).resolves.toMatchObject({
      state: "suppressed",
      suppressed: true,
      counts: null,
      reasonCodes: [],
    })
  })

  it("labels and hides a small cohort without relying on color", async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      dbRow({
        ineligibleGenerations: 1n,
        affectedPointers: 1n,
        affectedContributions: 1n,
        rebuildCandidates: 1n,
        rebuildBacklog: 0n,
        replacementPublications: 0n,
        staleClaims: 0n,
        reclaimedRuns: 0n,
        terminalRuns: 0n,
        servingFences: 0n,
        affectedRequests: 0n,
        cleanHybridRequests: 0n,
        reasonCounts: { eligibility_revision_missing: 1 },
      }),
    ])

    await expect(
      loadRecommendationProfileReconciliationOverview(
        { $queryRaw: queryRaw } as unknown as PrismaClient,
        WINDOW,
        NOW,
      ),
    ).resolves.toEqual({
      state: "suppressed",
      suppressed: true,
      currentPointerInvariant: "violated",
      counts: null,
      reasonCodes: [],
    })
  })

  it("proves the current-pointer invariant when repair is complete", async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      dbRow({
        ineligibleGenerations: 0n,
        affectedPointers: 0n,
        affectedContributions: 0n,
        rebuildCandidates: 0n,
        rebuildBacklog: 0n,
        replacementPublications: 5n,
        staleClaims: 0n,
        reclaimedRuns: 4n,
        terminalRuns: 0n,
        servingFences: 0n,
        affectedRequests: 0n,
        reasonCounts: {},
      }),
    ])

    await expect(
      loadRecommendationProfileReconciliationOverview(
        { $queryRaw: queryRaw } as unknown as PrismaClient,
        WINDOW,
        NOW,
      ),
    ).resolves.toMatchObject({
      state: "healthy",
      currentPointerInvariant: "clean",
    })
  })
})
