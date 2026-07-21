import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

vi.mock("@forge/admin-graphql", () => ({
  adminGraphql: (query: string) => query,
}))

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}))

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

vi.mock("@/lib/admin-client", () => ({
  default: {
    query: vi.fn(),
  },
}))

import client from "@/lib/admin-client"
import { headers } from "next/headers"

import {
  getSearchLanguageCatalogOptions,
  getSearchLanguageOptions,
} from "./search-language-actions"

const queryMock = vi.mocked(client.query)
const headersMock = vi.mocked(headers)
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

const englishLanguage = {
  id: "language-english",
  coreId: "529",
  name: { en: "English", native: "English" },
  bcp47: "en",
  slug: "english",
}

const spanishLanguage = {
  id: "language-spanish",
  coreId: "21028",
  name: { en: "Spanish, Castilian", es: "Español" },
  bcp47: "es-ES",
  slug: "spanish-castilian",
}

describe("getSearchLanguageOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    headersMock.mockResolvedValue(
      new Headers({
        "accept-language": "es-ES,es;q=0.9,en;q=0.8",
        "x-vercel-ip-country": "US",
      }),
    )
  })

  afterAll(() => {
    consoleError.mockRestore()
  })

  it("loads the catalog without request-specific header work", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        languages: [englishLanguage, spanishLanguage],
        countries: [],
      },
    })

    await expect(getSearchLanguageCatalogOptions()).resolves.toMatchObject([
      { englishName: "English", publicSlug: "english" },
      {
        englishName: "Spanish, Castilian",
        publicSlug: "spanish-castilian",
      },
    ])
    expect(headersMock).not.toHaveBeenCalled()
  })

  it("loads language metadata", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        languages: [englishLanguage, spanishLanguage],
        countries: [],
      },
    })

    await expect(getSearchLanguageOptions()).resolves.toMatchObject({
      ok: true,
      options: [
        {
          englishName: "English",
          publicSlug: "english",
        },
        {
          englishName: "Spanish, Castilian",
          publicSlug: "spanish-castilian",
        },
      ],
      countrySuggestion: null,
      recommendedLanguage: {
        englishName: "Spanish, Castilian",
        publicSlug: "spanish-castilian",
      },
      countryCode: "US",
      countryName: "United States",
    })
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it("builds facet-limited options, country suggestions, and a recommended language", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        languages: [englishLanguage, spanishLanguage],
        countries: [
          {
            id: "country-us",
            coreId: "US",
            name: { en: "United States" },
            flagPngSrc: "https://example.test/us.png",
            continent: { id: "continent-na", name: { en: "North America" } },
            countryLanguages: [
              {
                speakers: 300,
                primary: true,
                suggested: true,
                order: 1,
                language: englishLanguage,
              },
              {
                speakers: 100,
                order: 2,
                language: spanishLanguage,
              },
            ],
          },
        ],
      },
    })

    await expect(
      getSearchLanguageOptions({
        availableLanguageFacets: {
          English: 7,
          "Spanish, Castilian": 4,
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      countryCode: "US",
      countryName: "United States",
      options: [
        {
          englishName: "English",
          publicSlug: "english",
          regionNames: ["North America"],
          facetCount: 7,
        },
        {
          englishName: "Spanish, Castilian",
          publicSlug: "spanish-castilian",
          regionNames: ["North America"],
          facetCount: 4,
        },
      ],
      countrySuggestion: {
        countryName: "United States",
        flagPngSrc: "https://example.test/us.png",
        languages: [
          { englishName: "English" },
          { englishName: "Spanish, Castilian" },
        ],
      },
      recommendedLanguage: {
        englishName: "Spanish, Castilian",
        publicSlug: "spanish-castilian",
      },
    })
  })

  it("falls back to the browser language when there is no country language suggestion", async () => {
    headersMock.mockResolvedValueOnce(
      new Headers({
        "accept-language": "es-ES,es;q=0.9,en;q=0.8",
        "x-vercel-ip-country": "CA",
      }),
    )
    queryMock.mockResolvedValueOnce({
      data: {
        languages: [englishLanguage, spanishLanguage],
        countries: [],
      },
    })

    await expect(getSearchLanguageOptions()).resolves.toMatchObject({
      ok: true,
      recommendedLanguage: {
        englishName: "Spanish, Castilian",
        publicSlug: "spanish-castilian",
      },
    })
  })

  it("returns a safe error when admin language metadata fails", async () => {
    queryMock.mockResolvedValueOnce({
      data: undefined,
      error: new Error("secret token leaked in upstream diagnostics\nstack"),
    })

    await expect(getSearchLanguageOptions()).resolves.toMatchObject({
      ok: false,
      options: [],
      countrySuggestion: null,
      recommendedLanguage: null,
      error: {
        code: "SEARCH_LANGUAGE_METADATA_ERROR",
        message: "Language options are temporarily unavailable.",
      },
    })
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("[watch-search][language-metadata]"),
    )
  })
})
