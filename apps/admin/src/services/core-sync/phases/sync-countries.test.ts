import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../core-client", () => ({ coreQuery: vi.fn() }))

import { coreQuery } from "../core-client"
import { syncCountries } from "./sync-countries"

const mockedCoreQuery = vi.mocked(coreQuery)

function createProgress() {
  return { setTotal: vi.fn(), increment: vi.fn() }
}

/**
 * Same pattern as sync-videos.test.ts: build a prisma stub whose
 * `$transaction(async tx => ...)` invokes the callback with a `tx`
 * proxy that delegates to the same mocked $queryRaw / $executeRaw,
 * so the existing per-statement mocks keep working after the
 * production code wrapped its two-statement sequence in a
 * transaction.
 */
function makePrismaStub({
  queryRaw,
  executeRaw,
  countryUpdateManyResult = { count: 0 },
}: {
  queryRaw: ReturnType<typeof vi.fn>
  executeRaw: ReturnType<typeof vi.fn>
  countryUpdateManyResult?: { count: number }
}) {
  const $transaction = vi.fn(
    async (
      fn: (tx: unknown) => Promise<unknown>,
      _options?: { timeout?: number; maxWait?: number },
    ) => fn({ $queryRaw: queryRaw, $executeRaw: executeRaw }),
  )
  return {
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
    $transaction,
    country: {
      updateMany: vi.fn().mockResolvedValue(countryUpdateManyResult),
    },
  }
}

describe("syncCountries", () => {
  beforeEach(() => {
    mockedCoreQuery.mockReset()
  })

  it("issues two bulk INSERT … ON CONFLICT statements (continents then countries) inside one $transaction, returning continent_ids via RETURNING", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        countries: [
          {
            id: "us",
            name: [{ value: "United States", language: { bcp47: "en" } }],
            population: 330_000_000,
            latitude: 37.0902,
            longitude: -95.7129,
            flagPngSrc: "https://flags/us.png",
            flagWebpSrc: "https://flags/us.webp",
            continent: {
              id: "north-america",
              name: [{ value: "North America", language: { bcp47: "en" } }],
            },
          },
          {
            id: "ca",
            name: [{ value: "Canada", language: { bcp47: "en" } }],
            population: 38_000_000,
            latitude: 56.1304,
            longitude: -106.3468,
            flagPngSrc: null,
            flagWebpSrc: null,
            // Same continent — must be deduped in the continent upsert.
            continent: {
              id: "north-america",
              name: [{ value: "North America", language: { bcp47: "en" } }],
            },
          },
        ],
      },
    } as never)

    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([
        { id: "admin-na-cuid", core_id: "north-america" },
      ])
    const executeRaw = vi.fn().mockResolvedValue(2)
    const prisma = makePrismaStub({ queryRaw, executeRaw })

    const stats = await syncCountries({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.updated).toBe(2)
    expect(stats.errors).toBe(0)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.$transaction.mock.calls[0]?.[1]).toEqual({
      timeout: 30_000,
      maxWait: 5_000,
    })

    // Continent INSERT
    expect(queryRaw).toHaveBeenCalledTimes(1)
    const continentArg = queryRaw.mock.calls[0]?.[0] as
      | { sql: string; values: unknown[] }
      | undefined
    expect(continentArg?.sql).toContain('INSERT INTO "continent"')
    expect(continentArg?.sql).toContain('ON CONFLICT ("core_id") DO UPDATE')
    expect(continentArg?.sql).toContain("RETURNING")

    // Country INSERT — referencing the just-returned continent_id.
    expect(executeRaw).toHaveBeenCalledTimes(1)
    const countryArg = executeRaw.mock.calls[0]?.[0] as
      | { sql: string; values: unknown[] }
      | undefined
    expect(countryArg?.sql).toContain('INSERT INTO "country"')
    expect(countryArg?.sql).toContain('"continent_id"')
    expect(countryArg?.sql).toContain('ON CONFLICT ("core_id") DO UPDATE')
    expect(countryArg?.values).toContain("admin-na-cuid")
  })

  it("skips the continent INSERT when no countries have a continent payload", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        countries: [
          {
            id: "xx",
            name: [{ value: "Nowhere", language: { bcp47: "en" } }],
            population: null,
            latitude: null,
            longitude: null,
            flagPngSrc: null,
            flagWebpSrc: null,
            continent: null,
          },
        ],
      },
    } as never)

    const queryRaw = vi.fn()
    const executeRaw = vi.fn().mockResolvedValue(1)
    const prisma = makePrismaStub({ queryRaw, executeRaw })

    const stats = await syncCountries({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.updated).toBe(1)
    expect(queryRaw).not.toHaveBeenCalled() // No continents → skip continent INSERT
    expect(executeRaw).toHaveBeenCalledTimes(1) // One country INSERT
  })

  it("rolls back the continent INSERT when the country INSERT fails (cross-statement atomicity)", async () => {
    // Step 1 (continent $queryRaw) resolves; step 2 (country
    // $executeRaw) rejects. The transaction wrapper guarantees the
    // continents do not commit independently of the failed countries.
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        countries: [
          {
            id: "us",
            name: [{ value: "United States", language: { bcp47: "en" } }],
            population: null,
            latitude: null,
            longitude: null,
            flagPngSrc: null,
            flagWebpSrc: null,
            continent: {
              id: "north-america",
              name: [{ value: "North America", language: { bcp47: "en" } }],
            },
          },
        ],
      },
    } as never)

    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([
        { id: "admin-na-cuid", core_id: "north-america" },
      ])
    const executeRaw = vi
      .fn()
      .mockRejectedValueOnce(new Error("country insert failed"))
    const prisma = makePrismaStub({ queryRaw, executeRaw })

    const stats = await syncCountries({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.errors).toBe(1)
    expect(stats.updated).toBe(0)
    expect(prisma.country.updateMany).not.toHaveBeenCalled()
    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(executeRaw).toHaveBeenCalledTimes(1)
  })

  it("increments errors on bulk SQL failure and skips soft-delete", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        countries: [
          {
            id: "us",
            name: [{ value: "United States", language: { bcp47: "en" } }],
            population: null,
            latitude: null,
            longitude: null,
            flagPngSrc: null,
            flagWebpSrc: null,
            continent: null,
          },
        ],
      },
    } as never)

    const queryRaw = vi.fn()
    const executeRaw = vi.fn().mockRejectedValue(new Error("connection reset"))
    const prisma = makePrismaStub({ queryRaw, executeRaw })

    const stats = await syncCountries({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.errors).toBe(1)
    expect(stats.updated).toBe(0)
    expect(prisma.country.updateMany).not.toHaveBeenCalled()
  })

  it("skips soft-delete when the first full-sync batch is empty", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: { countries: [] },
    } as never)

    const queryRaw = vi.fn()
    const executeRaw = vi.fn()
    const prisma = makePrismaStub({ queryRaw, executeRaw })

    const stats = await syncCountries({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.softDeleted).toBe(0)
    expect(executeRaw).not.toHaveBeenCalled()
    expect(prisma.country.updateMany).not.toHaveBeenCalled()
  })
})
