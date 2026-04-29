import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../core-client", () => ({
  coreQuery: vi.fn(),
}))

import { coreQuery } from "../core-client"
import { syncCountries } from "./sync-countries"

const mockedCoreQuery = vi.mocked(coreQuery)

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

    const tx = {
      language: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "language-1", coreId: "lang-en" }]),
      },
      continent: {
        upsert: vi.fn().mockResolvedValue({ id: "continent-1" }),
      },
      continentLocale: {
        upsert: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      country: {
        upsert: vi.fn().mockResolvedValue({ id: "country-1" }),
      },
      countryLocale: {
        upsert: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      countryLanguage: {
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
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
    expect(tx.country.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          languageCount: 2,
          languageHavingMediaCount: 1,
        }),
      }),
    )
    expect(tx.countryLanguage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          coreId: "cl-1",
          countryId: "country-1",
          languageId: "language-1",
          displaySpeakers: "50",
          primary: true,
          order: 1,
        }),
      }),
    )
    expect(tx.continentLocale.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          continentId: "continent-1",
          locale: "en",
          value: "North America",
        }),
      }),
    )
    expect(tx.countryLocale.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          countryId: "country-1",
          locale: "en",
          value: "United States",
        }),
      }),
    )
    expect(prisma.country.updateMany).toHaveBeenCalled()
  })
})
