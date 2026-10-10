import { Prisma, type PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import {
  loadAnonymousWatchExposureBreakdown,
  loadWatchExposureBreakdown,
} from "./watch-exposure.service"

describe("Watch exposure inspection", () => {
  it("binds registry scope values in both anonymous cohort and ranked queries", async () => {
    const filter = {
      surface: "watch-home' OR TRUE --",
      block: "hero",
      presentation: "hero-card",
      placement: "hero-primary",
      policyVersion: "watch-exposure-v2",
    }
    const query = vi.fn().mockResolvedValue([])
    const execute = vi.fn()
    const prisma = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ $executeRawUnsafe: execute, $queryRaw: query }),
    } as unknown as PrismaClient
    await loadAnonymousWatchExposureBreakdown(prisma, "24h", filter)
    const [strings, ...values] = query.mock.calls[0]
    const sql = Prisma.sql(strings, ...values)
    expect(sql.text).not.toContain(filter.surface)
    for (const value of Object.values(filter)) {
      expect(
        sql.values.filter((parameter) => parameter === value),
      ).toHaveLength(2)
    }
    expect(execute).toHaveBeenCalledWith(
      "SET LOCAL statement_timeout = '3000ms'",
    )
  })

  it("binds signed registry mapping and rejects unmatched identities", async () => {
    const query = vi.fn().mockResolvedValue([])
    const prisma = { $queryRaw: query } as unknown as PrismaClient
    const filter = {
      surface: "watch-home",
      block: "for-you",
      presentation: "recommendation-list",
      placement: "primary",
      policyVersion: "watch-for-you-v1",
    }
    await loadWatchExposureBreakdown(prisma, "24h", filter)
    const [strings, ...values] = query.mock.calls[0]
    expect(Prisma.sql(strings, ...values).values).toContain("watch-for-you-v1")
    await loadWatchExposureBreakdown(prisma, "24h", {
      ...filter,
      placement: "",
    })
    const [unmatchedStrings, ...unmatchedValues] = query.mock.calls[1]
    expect(Prisma.sql(unmatchedStrings, ...unmatchedValues).text).toContain(
      "AND FALSE",
    )
    await loadWatchExposureBreakdown(prisma, "24h", {
      ...filter,
      policyVersion: "watch-below-player-v1",
    })
    const [wrongPolicyStrings, ...wrongPolicyValues] = query.mock.calls[2]
    expect(Prisma.sql(wrongPolicyStrings, ...wrongPolicyValues).text).toContain(
      "AND FALSE",
    )
  })

  it("reports served-only V2 manifests without inventing rendered or eligible facts", async () => {
    const query = vi.fn().mockResolvedValue([
      {
        surface: "watch-home",
        block: "hero",
        presentation: "hero-card",
        placement: "primary",
        policyVersion: "watch-exposure-v2",
        position: 0,
        served: 3n,
        rendered: 0n,
        eligible: 0n,
        selected: 0n,
        eligibleSelected: 0n,
        repeats: 0n,
        duplicates: 0n,
        acceptedAttempts: 0n,
        occlusionAware: 0n,
        visibilityUnknown: 0n,
      },
    ])
    const prisma = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ $executeRawUnsafe: vi.fn(), $queryRaw: query }),
    } as unknown as PrismaClient
    const result = await loadAnonymousWatchExposureBreakdown(prisma)
    expect(result.rows[0]).toMatchObject({
      served: 3,
      rendered: 0,
      eligible: 0,
      selected: 0,
      ctr: null,
      duplicateRate: null,
    })
  })

  it("keeps For You separate and excludes early selections from eligible CTR", async () => {
    const query = vi.fn().mockResolvedValue([
      {
        surfaceVersion: "watch-for-you-v1",
        position: 0,
        served: 10n,
        rendered: 9n,
        eligible: 4n,
        selected: 3n,
        eligibleSelected: 2n,
        selectionWithoutImpression: 1n,
        occlusionAware: 1n,
        visibilityUnknown: 3n,
      },
      {
        surfaceVersion: "watch-below-player-v1",
        position: 1,
        served: 2n,
        rendered: 2n,
        eligible: 0n,
        selected: 1n,
        eligibleSelected: 0n,
        selectionWithoutImpression: 1n,
        occlusionAware: 0n,
        visibilityUnknown: 0n,
      },
    ])
    const rows = await loadWatchExposureBreakdown(
      { $queryRaw: query } as unknown as PrismaClient,
      "7d",
    )
    expect(rows[0]).toMatchObject({
      surface: "watch-home",
      block: "for-you",
      served: 10,
      selected: 3,
      eligibleSelected: 2,
      ctr: 0.5,
      selectionWithoutImpression: 1,
      occlusionAware: 1,
      visibilityUnknown: 3,
    })
    expect(rows[1]).toMatchObject({
      surface: "watch-video",
      block: "below-player",
      ctr: null,
      selectionWithoutImpression: 1,
    })
  })

  it("shows anonymous served as unknown and keeps repeats apart from transport duplicates", async () => {
    const query = vi.fn().mockResolvedValue([
      {
        surface: "watch-search",
        block: "results",
        presentation: "result-list",
        placement: "search-results",
        policyVersion: "watch-exposure-v1",
        position: 0,
        rendered: 5n,
        eligible: 2n,
        selected: 2n,
        eligibleSelected: 1n,
        repeats: 3n,
        duplicates: 1n,
        acceptedAttempts: 10n,
        occlusionAware: 0n,
        visibilityUnknown: 2n,
      },
    ])
    const transaction = vi.fn(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ $executeRawUnsafe: vi.fn(), $queryRaw: query }),
    )
    const result = await loadAnonymousWatchExposureBreakdown({
      $transaction: transaction,
    } as unknown as PrismaClient)
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 4000,
    })
    expect(result.truncated).toBe(false)
    expect(result.rows[0]).toMatchObject({
      served: null,
      repeats: 3,
      duplicateRate: 1 / 11,
      ctr: 0.5,
      selectionWithoutImpression: 1,
      visibilityUnknown: 2,
    })
    query.mockResolvedValueOnce(
      Array.from({ length: 129 }, (_, position) => ({
        surface: "watch-search",
        block: "results",
        presentation: "result-list",
        placement: "search-results",
        policyVersion: "watch-exposure-v1",
        position,
        rendered: 1n,
        eligible: 0n,
        selected: 0n,
        eligibleSelected: 0n,
        repeats: 0n,
        duplicates: 0n,
        acceptedAttempts: 1n,
        occlusionAware: 0n,
        visibilityUnknown: 0n,
      })),
    )
    const truncated = await loadAnonymousWatchExposureBreakdown({
      $transaction: transaction,
    } as unknown as PrismaClient)
    expect(truncated.truncated).toBe(true)
    expect(truncated.rows).toHaveLength(128)
  })
})
