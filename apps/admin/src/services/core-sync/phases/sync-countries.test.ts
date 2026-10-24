import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../core-client", () => ({
  coreQuery: vi.fn(),
}))
vi.mock("./sync-languages", () => ({
  syncLanguages: vi.fn(),
}))

import { coreQuery } from "../core-client"
import { syncLanguages } from "./sync-languages"
import { syncCountries } from "./sync-countries"

const mockedCoreQuery = vi.mocked(coreQuery)
const mockedSyncLanguages = vi.mocked(syncLanguages)

const progress = { setTotal: vi.fn(), increment: vi.fn() }

describe("syncCountries", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("writes country, continent, and country-language metadata", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        countries: [
          {
            id: "country-us",
            name: [{ value: "United States", language: { bcp47: "en" } }],
            population: 100,
            latitude: 1,
            longitude: 2,
            flagPngSrc: "flag.png",
            flagWebpSrc: "flag.webp",
            languageCount: 2,
            languageHavingMediaCount: 1,
            continent: {
              id: "continent-na",
              name: [{ value: "North America", language: { bcp47: "en" } }],
            },
            countryLanguages: [
              {
                id: "cl-1",
                speakers: 50,
                displaySpeakers: "50",
                primary: true,
                suggested: false,
                order: 1,
                language: { id: "lang-en" },
              },
            ],
          },
        ],
      },
    } as never)

    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      language: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "language-1", coreId: "lang-en" }]),
      },
      country: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      countryLocale: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      countryLanguage: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }

    const stats = await syncCountries({
      prisma: prisma as never,
      progress,
      since: "2026-04-01T00:00:00.000Z",
    })

    expect(stats.errors).toBe(0)
    expect(stats.updated).toBe(1)
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(5)
    expect(prisma.$executeRaw.mock.calls.join("\n")).toContain(
      'INSERT INTO "country"',
    )
    expect(prisma.$executeRaw.mock.calls.join("\n")).toContain(
      'INSERT INTO "country_language"',
    )
    expect(prisma.country.updateMany).toHaveBeenCalled()
  })

  it("runs a full language fallback when country languages reference missing incremental languages", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        countries: [
          {
            id: "country-br",
            name: [{ value: "Brazil", language: { bcp47: "en" } }],
            population: 100,
            latitude: 1,
            longitude: 2,
            flagPngSrc: "flag.png",
            flagWebpSrc: "flag.webp",
            languageCount: 1,
            languageHavingMediaCount: 1,
            continent: null,
            countryLanguages: [
              {
                id: "cl-rikbaktsa",
                speakers: 50,
                displaySpeakers: "50",
                primary: true,
                suggested: false,
                order: 1,
                language: { id: "1869" },
              },
            ],
          },
        ],
      },
    } as never)
    mockedSyncLanguages.mockResolvedValueOnce({
      created: 0,
      updated: 2318,
      softDeleted: 0,
      errors: 0,
    })

    const prisma = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      language: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ id: "language-rkb", coreId: "1869" }]),
      },
      country: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      countryLocale: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      countryLanguage: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }

    const stats = await syncCountries({
      prisma: prisma as never,
      progress,
      since: "2026-07-21T20:40:06.451Z",
    })

    expect(stats.errors).toBe(0)
    expect(stats.updated).toBe(1)
    expect(mockedSyncLanguages).toHaveBeenCalledWith({
      prisma,
      progress: expect.objectContaining({
        setTotal: expect.any(Function),
        increment: expect.any(Function),
      }),
    })
    expect(prisma.language.findMany).toHaveBeenCalledTimes(2)
    expect(prisma.$executeRaw.mock.calls.join("\n")).toContain(
      'INSERT INTO "country_language"',
    )
  })
})
