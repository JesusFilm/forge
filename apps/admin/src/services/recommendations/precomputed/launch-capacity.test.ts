import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import {
  attestPrecomputedLaunchCapacity,
  calculateLaunchCapacity,
} from "./launch-capacity"

describe("verified live launch capacity", () => {
  it("uses the measured seven-day visit sample for a doubled 29-day retention projection", () => {
    const result = calculateLaunchCapacity({
      verifiedVisits: 700,
      measuredFootprintBytes: 700_000,
      projectedBytes: 6_000_000,
      availableBytes: 12_000_000_000,
      reserveBytes: 5_000_000_000,
      reservedBuildBytes: 1_000_000_000,
      observedDbGrowthBytes: 100_000_000,
      recentTerminalProjectedBytes: 200_000_000,
    })
    expect(result.minimumProjectedBytes).toBe(5_800_000)
    expect(result.availableAfterReserveBytes).toBe(5_800_000_000)
    expect(result.status).toBe("passed")
  })

  it("refuses an underestimated projection or physical headroom", () => {
    const input = {
      verifiedVisits: 700,
      measuredFootprintBytes: 700_000,
      projectedBytes: 5_799_999,
      availableBytes: 5_500_000_000,
      reserveBytes: 5_000_000_000,
      reservedBuildBytes: 0,
      observedDbGrowthBytes: 0,
      recentTerminalProjectedBytes: 0,
    }
    expect(calculateLaunchCapacity(input).status).toBe("insufficient")
    expect(
      calculateLaunchCapacity({ ...input, projectedBytes: 600_000_000 }).status,
    ).toBe("insufficient")
  })

  it("appends a distinct receipt without rewriting the completed generation's build evidence", async () => {
    const now = new Date("2026-10-07T12:00:00.000Z")
    const create = vi.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        ...data,
        observedDbBytes: 1_000_000n,
        projectedBytes: 100_000_000n,
        availableAfterReserveBytes: 7_000_000_000n,
      }),
    )
    const update = vi.fn()
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ held: "1" }])
      .mockResolvedValueOnce([
        {
          observed_db_bytes: 1_000_000n,
          cluster_system_id: "123",
          baseline_visit_bytes: 700_000n,
          baseline_request_bytes: 0n,
          ordinary_row_bytes: 100_000n,
          ordinary_physical_bytes: 800_000n,
          ordinary_heap_bytes: 200_000n,
          request_rows: 900n,
        },
      ])
      .mockResolvedValueOnce([
        {
          active_bytes: 0n,
          recent_terminal_bytes: 0n,
        },
      ])
    const tx = {
      $queryRaw: query,
      recommendationPrecomputedGeneration: {
        findUnique: vi.fn().mockResolvedValue({
          status: "complete",
          protocolVersion: 2,
          capacityPreflight: { status: "passed", projectedBytes: 1_000_000 },
        }),
        update,
      },
      recommendationPrecomputedBaselineRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: "00000000-0000-4000-8000-000000000001",
          startsAt: new Date("2026-09-29T00:00:00.000Z"),
          endsAt: new Date("2026-10-06T00:00:00.000Z"),
          stoppedAt: null,
          finalReportDigest: "a".repeat(64),
          finalReport: {
            isFinal: true,
            eligibleVisits: 700,
            linkedDeliveryRequests: 700,
            evidenceBasis: "verified_incumbent_baseline",
          },
        }),
      },
      recommendationPrecomputedLaunchCapacityReceipt: { create },
    }
    const prisma = {
      $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    } as unknown as PrismaClient
    const measurement = {
      measuredAt: "2026-10-07T11:55:00.000Z",
      clusterSystemId: "123",
      observedDbBytes: 1_000_000,
      availableBytes: 12_000_000_000,
      reserveBytes: 5_000_000_000,
      projectedBytes: 100_000_000,
      sampleSourceCount: 700,
      sampleBytes: 4_000_000,
      source: "operator_verified_pgdata_df" as const,
    }
    const result = await attestPrecomputedLaunchCapacity(prisma, {
      generationId: "generation-1",
      operator: { id: "operator-1", role: "ADMIN" },
      now,
      measurement,
    })
    expect(result).toMatchObject({
      generationId: "generation-1",
      status: "passed",
      projectedBytes: "100000000",
    })
    expect(create).toHaveBeenCalledOnce()
    expect(update).not.toHaveBeenCalled()
    expect(create.mock.calls[0]?.[0].data.measurement).toMatchObject({
      allTrafficRequestRows: 900,
      linkedDeliveryRequests: 700,
      projectionAssumptions: { walDirectlyMeasured: false },
    })

    query
      .mockReset()
      .mockResolvedValueOnce([{ held: "1" }])
      .mockResolvedValueOnce([
        {
          observed_db_bytes: 1_000_000n,
          cluster_system_id: "123",
          baseline_visit_bytes: 700_000n,
          baseline_request_bytes: 0n,
          ordinary_row_bytes: 100_000n,
          ordinary_physical_bytes: 800_000n,
          ordinary_heap_bytes: 200_000n,
          request_rows: 900n,
        },
      ])
    // The thin baseline relation alone cannot qualify when the retained
    // ordinary request/delivery/evidence footprint is larger.
    await expect(
      attestPrecomputedLaunchCapacity(prisma, {
        generationId: "generation-1",
        operator: { id: "operator-1", role: "ADMIN" },
        now,
        measurement: { ...measurement, sampleBytes: 700_000 },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" })
    expect(create).toHaveBeenCalledOnce()
  })
})
