import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { SearchResult } from "./search"

vi.mock("server-only", () => ({}))

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "accept-language": "pt-BR" })),
}))

vi.mock("./feature-flags", () => ({
  isWatchAlgoliaSearchEnabled: vi.fn(),
}))

vi.mock("./language-preference-server", () => ({
  readPreferredLanguageSlug: vi.fn(async () => null),
}))

vi.mock("./search-language-preference-server", () => ({
  readSearchLanguagePreferenceSlug: vi.fn(async () => null),
}))

vi.mock("./search", async () => {
  const actual = await vi.importActual<typeof import("./search")>("./search")
  return {
    ...actual,
    searchVideos: vi.fn(),
  }
})

vi.mock("./algolia-search", () => ({
  searchAlgoliaVideos: vi.fn(),
}))

vi.mock("./algolia-video-transform", () => ({
  transformAlgoliaVideoHits: vi.fn(),
}))

import { searchAlgoliaVideos } from "./algolia-search"
import { transformAlgoliaVideoHits } from "./algolia-video-transform"
import { isWatchAlgoliaSearchEnabled } from "./feature-flags"
import { readPreferredLanguageSlug } from "./language-preference-server"
import { runSearch } from "./search-actions"
import { searchVideos } from "./search"
import { readSearchLanguagePreferenceSlug } from "./search-language-preference-server"

const spanishOption = {
  coreId: "21028",
  englishName: "Spanish, Castilian",
  nativeName: "Español",
  bcp47: "es-ES",
  publicSlug: "spanish-castilian",
  regionNames: ["Europe"],
}

const semanticResult: SearchResult = {
  type: "video",
  id: "semantic-1",
  slug: "jesus",
  title: "JESUS",
  imageUrl: null,
  snippet: "",
  startSeconds: null,
  playbackId: null,
  score: 1,
  label: "FEATURE_FILM",
  durationSeconds: 7200,
  childCount: 0,
}

const algoliaResult: SearchResult = {
  ...semanticResult,
  id: "algolia-1",
  source: "algolia",
  languageSlug: "spanish-castilian",
}

describe("runSearch", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterAll(() => {
    consoleError.mockRestore()
  })

  it("keeps semantic search when the Algolia flag is off and passes the resolved locale", async () => {
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(false)
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [semanticResult],
      hasMore: false,
      query: "jesus",
      searchMode: "hybrid",
      latencyMs: 12,
    })

    const result = await runSearch({
      query: "jesus",
      limit: 5,
      offset: 10,
      languageSlug: "spanish-castilian",
      languageOptions: [spanishOption],
    })

    expect(searchVideos).toHaveBeenCalledWith("jesus", 5, 10, undefined, "es")
    expect(searchAlgoliaVideos).not.toHaveBeenCalled()
    expect(readSearchLanguagePreferenceSlug).not.toHaveBeenCalled()
    expect(readPreferredLanguageSlug).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      ok: true,
      resultSource: "semantic",
      resolvedLanguage: {
        publicSlug: "spanish-castilian",
        source: "explicit-selection",
      },
      results: [
        {
          ...semanticResult,
          languageSlug: "spanish-castilian",
        },
      ],
    })
  })

  it("redacts semantic upstream errors returned to the browser", async () => {
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(false)
    vi.mocked(searchVideos).mockRejectedValueOnce({
      code: "ADMIN_GRAPHQL_ERROR",
      message: "database password leaked in upstream diagnostic",
      retryAfterSeconds: "not-a-number",
    })

    await expect(runSearch({ query: "jesus" })).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        resultSource: "semantic",
        error: {
          code: "SEARCH_ERROR",
          message: "Search request failed",
        },
      }),
    )
  })

  it("uses Algolia when the flag is on and transforms hits with the selected language", async () => {
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(true)
    vi.mocked(searchAlgoliaVideos).mockResolvedValueOnce({
      ok: true,
      query: "jesus",
      latencyMs: 20,
      hits: [{ objectID: "variant-1", videoId: "video-1", slug: "jesus" }],
      hasMore: true,
      nbHits: 21,
      page: 0,
      offset: 0,
      nextOffset: 20,
      facets: {
        languageEnglishName: {
          "Spanish, Castilian": 10,
        },
      },
    })
    vi.mocked(transformAlgoliaVideoHits).mockReturnValueOnce([algoliaResult])

    const result = await runSearch({
      query: "jesus",
      limit: 20,
      offset: 0,
      languageEnglishNames: ["Spanish, Castilian"],
      languageOptions: [spanishOption],
    })

    expect(searchAlgoliaVideos).toHaveBeenCalledWith({
      query: "jesus",
      limit: 20,
      offset: 0,
      languageEnglishNames: ["Spanish, Castilian"],
    })
    expect(transformAlgoliaVideoHits).toHaveBeenCalledWith({
      hits: [{ objectID: "variant-1", videoId: "video-1", slug: "jesus" }],
      preferredLanguage: spanishOption,
      languageOptions: [spanishOption],
    })
    expect(result).toMatchObject({
      ok: true,
      resultSource: "algolia",
      searchMode: "hybrid",
      nextOffset: 20,
      results: [algoliaResult],
      languageFacets: {
        "Spanish, Castilian": 10,
      },
    })
  })

  it("caps selected language filters before calling Algolia", async () => {
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(true)
    vi.mocked(searchAlgoliaVideos).mockResolvedValueOnce({
      ok: true,
      query: "jesus",
      latencyMs: 20,
      hits: [],
      hasMore: false,
      nbHits: 0,
      page: 0,
      offset: 0,
      nextOffset: 0,
      facets: { languageEnglishName: {} },
    })
    vi.mocked(transformAlgoliaVideoHits).mockReturnValueOnce([])

    await runSearch({
      query: "jesus",
      languageEnglishNames: [
        " English ",
        "English",
        "x".repeat(120),
        "Spanish",
        "French",
        "German",
        "Italian",
        "Portuguese",
        "Arabic",
        "Hindi",
      ],
    })

    expect(searchAlgoliaVideos).toHaveBeenCalledWith(
      expect.objectContaining({
        languageEnglishNames: [
          "English",
          "x".repeat(100),
          "Spanish",
          "French",
          "German",
          "Italian",
          "Portuguese",
          "Arabic",
        ],
      }),
    )
  })

  it("keeps type-filtered searches on semantic search when the Algolia flag is on", async () => {
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(true)
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [],
      hasMore: false,
      query: "jesus",
      searchMode: "hybrid",
      latencyMs: 9,
      nextOffset: 0,
    })

    await runSearch({
      query: "jesus",
      type: "experience",
      limit: 5,
      offset: 10,
      routeLanguageSlug: "french",
    })

    expect(searchVideos).toHaveBeenCalledWith(
      "jesus",
      5,
      10,
      "experience",
      "fr",
    )
    expect(searchAlgoliaVideos).not.toHaveBeenCalled()
  })

  it("returns a safe failed result when the selected search path fails", async () => {
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(true)
    vi.mocked(searchAlgoliaVideos).mockResolvedValueOnce({
      ok: false,
      query: "jesus",
      latencyMs: 3,
      error: {
        code: "ALGOLIA_NOT_CONFIGURED",
        message: "Algolia search is not configured for this environment.",
      },
    })

    await expect(runSearch({ query: "jesus" })).resolves.toMatchObject({
      ok: false,
      resultSource: "algolia",
      results: [],
      error: {
        code: "ALGOLIA_NOT_CONFIGURED",
      },
    })
    expect(transformAlgoliaVideoHits).not.toHaveBeenCalled()
  })
})
