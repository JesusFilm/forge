import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../core-client", () => ({ coreQuery: vi.fn() }))

import { coreQuery } from "../core-client"
import { syncCountries } from "./sync-countries"

const mockedCoreQuery = vi.mocked(coreQuery)

function createProgress() {
  return { setTotal: vi.fn(), increment: vi.fn() }
}

describe("syncCountries", () => {
  beforeEach(() => {
    mockedCoreQuery.mockReset()
  })

  it("issues two bulk INSERT … ON CONFLICT statements (continents then countries) and returns continent_ids via RETURNING", async () => {
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

    const prisma = {
      $queryRaw: queryRaw,
      $executeRaw: executeRaw,
      $transaction: vi.fn(),
      country: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    }

    const stats = await syncCountries({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.updated).toBe(2)
    expect(stats.errors).toBe(0)
    expect(prisma.$transaction).not.toHaveBeenCalled()

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
    const prisma = {
      $queryRaw: queryRaw,
      $executeRaw: executeRaw,
      $transaction: vi.fn(),
      country: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    }

    const stats = await syncCountries({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.updated).toBe(1)
    expect(queryRaw).not.toHaveBeenCalled() // No continents → skip continent INSERT
    expect(executeRaw).toHaveBeenCalledTimes(1) // One country INSERT
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

    const prisma = {
      $queryRaw: vi.fn(),
      $executeRaw: vi.fn().mockRejectedValue(new Error("connection reset")),
      $transaction: vi.fn(),
      country: { updateMany: vi.fn() },
    }

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

    const prisma = {
      $queryRaw: vi.fn(),
      $executeRaw: vi.fn(),
      $transaction: vi.fn(),
      country: { updateMany: vi.fn() },
    }

    const stats = await syncCountries({
      prisma: prisma as never,
      progress: createProgress(),
    })

    expect(stats.softDeleted).toBe(0)
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
    expect(prisma.country.updateMany).not.toHaveBeenCalled()
  })
})
