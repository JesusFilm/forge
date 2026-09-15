import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { runRecommendationProfileReconciliationBatch } from "./reconciliation.service"

const NOW = new Date("2026-09-06T23:30:00.000Z")

function sqlText(value: unknown): string {
  if (
    typeof value === "object" &&
    value != null &&
    "strings" in value &&
    Array.isArray(value.strings)
  ) {
    return value.strings.join("?")
  }
  return String(value)
}

function createHarness(input: {
  lock?: boolean
  pointers?: Array<Record<string, unknown>>
  staleRuns?: Array<Record<string, unknown>>
  sources?: Array<Record<string, unknown>>
}) {
  const executeRaw = vi.fn().mockResolvedValue(2)
  const queryRaw = vi.fn().mockImplementation((sql) => {
    const text = sqlText(sql)
    if (text.includes("pg_try_advisory_xact_lock")) {
      return [{ acquired: input.lock ?? true }]
    }
    if (text.includes("FROM recommendation_profile_projection_pointer")) {
      return input.pointers ?? []
    }
    if (text.includes("SELECT DISTINCT ON")) return input.sources ?? []
    if (text.includes("FROM recommendation_profile_projection_run")) {
      return input.staleRuns ?? []
    }
    throw new Error(`Unexpected SQL: ${text}`)
  })
  const transaction = vi.fn(async (work) =>
    work({ $queryRaw: queryRaw, $executeRaw: executeRaw }),
  )
  return {
    prisma: { $transaction: transaction } as unknown as PrismaClient,
    queryRaw,
    executeRaw,
  }
}

describe("profile eligibility reconciliation", () => {
  it("reclassifies affected lineage, queues replacement builds, and recovers stale runs", async () => {
    const harness = createHarness({
      pointers: [
        {
          scope: "durable",
          profileId: "profile-1",
          privacyGeneration: 4,
          sessionDigest: null,
          generationId: "generation-1",
          pointerGeneration: 7,
        },
      ],
      staleRuns: [{ id: "run-1", generation: 3 }],
      sources: [
        { sourceType: "playback_outcome", sourceId: "outcome-1" },
        { sourceType: "selection", sourceId: "selection-1" },
      ],
    })
    const classifyOutcome = vi.fn().mockResolvedValue({})
    const classifySelection = vi.fn().mockResolvedValue({})
    const dispatchProjection = vi.fn().mockResolvedValue({ queued: true })
    const redispatchRun = vi.fn().mockResolvedValue({ queued: true })

    await expect(
      runRecommendationProfileReconciliationBatch(
        {
          ...harness,
          classifyOutcome,
          classifySelection,
          dispatchProjection,
          redispatchRun,
        },
        NOW,
      ),
    ).resolves.toEqual({
      locked: false,
      affectedPointers: 1,
      classificationsAttempted: 2,
      classificationsFailed: 0,
      rebuildsQueued: 1,
      staleRuns: 1,
      staleRunsQueued: 1,
      attemptsExhausted: 2,
      dispatchFailures: 0,
    })
    expect(classifyOutcome).toHaveBeenCalledWith("outcome-1")
    expect(classifySelection).toHaveBeenCalledWith("selection-1")
    expect(dispatchProjection).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "profile-1",
        sessionDigest: null,
        reconciliationCause: "eligibility_revision",
      }),
    )
    expect(redispatchRun).toHaveBeenCalledWith({
      runId: "run-1",
      expectedGeneration: 3,
      now: NOW,
    })

    const queries = harness.queryRaw.mock.calls
      .map(([sql]) => sqlText(sql))
      .join("\n")
    expect(queries).toContain("LIMIT ?")
    expect(queries).toContain("source_eligibility_revision")
    expect(queries).toContain("lease_expires_at")
  })

  it("does no work when another bounded batch owns the advisory lock", async () => {
    const harness = createHarness({ lock: false })
    const dispatchProjection = vi.fn()

    await expect(
      runRecommendationProfileReconciliationBatch(
        { ...harness, dispatchProjection },
        NOW,
      ),
    ).resolves.toMatchObject({ locked: true, affectedPointers: 0 })
    expect(harness.executeRaw).not.toHaveBeenCalled()
    expect(dispatchProjection).not.toHaveBeenCalled()
  })
})
