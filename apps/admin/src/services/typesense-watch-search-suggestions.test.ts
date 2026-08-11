import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  MAX_CONCURRENT_WATCH_SEARCH_SUGGESTIONS,
  MAX_WATCH_SEARCH_SUGGESTION_LANGUAGE_SLUG_CODE_POINTS,
  MAX_WATCH_SEARCH_SUGGESTION_PREFIX_CODE_POINTS,
  TypesenseWatchSearchSuggestionsService,
} from "./typesense-watch-search-suggestions"

const findFirstMock = vi.fn()
const multiSearchMock = vi.fn()
const warnMock = vi.fn()

function createService() {
  return new TypesenseWatchSearchSuggestionsService(
    {
      language: { findFirst: findFirstMock },
    } as never,
    { multiSearch: multiSearchMock } as never,
    { warn: warnMock },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("TypesenseWatchSearchSuggestionsService", () => {
  it.each(["", " ", "j", "!?"])(
    "returns no suggestions for ineligible prefix %j without downstream work",
    async (query) => {
      const result = await createService().suggest({
        query,
        languageSlug: "english",
      })

      expect(result).toEqual([])
      expect(findFirstMock).not.toHaveBeenCalled()
      expect(multiSearchMock).not.toHaveBeenCalled()
    },
  )

  it("caps input before lookup and sends one localized title-only request", async () => {
    const overlongQuery = `${"j".repeat(MAX_WATCH_SEARCH_SUGGESTION_PREFIX_CODE_POINTS)}extra`
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchMock.mockResolvedValue([
      {
        found: 1,
        out_of: 1,
        page: 1,
        search_time_ms: 2,
        grouped_hits: [
          {
            group_key: ["canonical-1"],
            found: 1,
            hits: [
              {
                document: {
                  canonicalVideoId: "canonical-1",
                  title_en: ["Unrelated", overlongQuery.slice(0, 200)],
                  title_fallback: ["Fallback"],
                },
              },
            ],
          },
        ],
      },
    ])

    const result = await createService().suggest({
      query: overlongQuery,
      languageSlug: "english",
    })

    expect(findFirstMock).toHaveBeenCalledWith({
      where: { deletedAt: null, slug: "english" },
      select: { bcp47: true },
    })
    expect(multiSearchMock).toHaveBeenCalledWith([
      expect.objectContaining({
        collection: "watch_search_lexical",
        q: overlongQuery.slice(0, 200),
        query_by: "title_en,title_fallback",
        filter_by: "languageIdentity:=[`slug:english`]",
        include_fields: "canonicalVideoId,title_en,title_fallback",
        per_page: 25,
        group_by: "canonicalVideoId",
        group_limit: 1,
        prefix: true,
        num_typos: "0,0",
        prioritize_exact_match: true,
        text_match_type: "max_weight",
      }),
    ])
    expect(result).toEqual([overlongQuery.slice(0, 200)])
  })

  it("uses only the fallback title field for an unsupported tokenizer locale", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "haw" })
    multiSearchMock.mockResolvedValue([
      {
        found: 1,
        out_of: 1,
        page: 1,
        search_time_ms: 1,
        grouped_hits: [
          {
            group_key: ["canonical-1"],
            found: 1,
            hits: [
              {
                document: {
                  canonicalVideoId: "canonical-1",
                  title_fallback: ["Jesus Film"],
                },
              },
            ],
          },
        ],
      },
    ])

    await expect(
      createService().suggest({ query: "je", languageSlug: "hawaiian" }),
    ).resolves.toEqual(["Jesus Film"])

    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null, slug: "hawaiian" } }),
    )
    expect(multiSearchMock).toHaveBeenCalledWith([
      expect.objectContaining({
        query_by: "title_fallback",
        filter_by: "languageIdentity:=[`slug:hawaiian`]",
        include_fields: "canonicalVideoId,title_fallback",
        num_typos: "0",
      }),
    ])
  })

  it("reuses the resolved locale while the language slug stays active", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchMock.mockResolvedValue([
      {
        found: 0,
        out_of: 0,
        page: 1,
        search_time_ms: 1,
        grouped_hits: [],
      },
    ])
    const service = createService()

    await service.suggest({ query: "je", languageSlug: "english" })
    await service.suggest({ query: "jes", languageSlug: "english" })

    expect(findFirstMock).toHaveBeenCalledTimes(1)
    expect(multiSearchMock).toHaveBeenCalledTimes(2)
  })

  it("coalesces identical in-flight suggestions and language lookup", async () => {
    const pendingSearch = new Promise<never>(() => undefined)
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchMock.mockReturnValue(pendingSearch)
    const service = createService()

    void service.suggest({ query: "je", languageSlug: "english" })
    void service.suggest({ query: "je", languageSlug: "english" })

    await vi.waitFor(() => {
      expect(findFirstMock).toHaveBeenCalledTimes(1)
      expect(multiSearchMock).toHaveBeenCalledTimes(1)
    })
  })

  it("retries language lookup after an in-flight failure", async () => {
    findFirstMock
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce({ bcp47: "en" })
    multiSearchMock.mockResolvedValue([
      {
        found: 0,
        out_of: 0,
        page: 1,
        search_time_ms: 1,
        grouped_hits: [],
      },
    ])
    const service = createService()

    await expect(
      service.suggest({ query: "je", languageSlug: "english" }),
    ).resolves.toEqual([])
    await expect(
      service.suggest({ query: "jes", languageSlug: "english" }),
    ).resolves.toEqual([])

    expect(findFirstMock).toHaveBeenCalledTimes(2)
    expect(multiSearchMock).toHaveBeenCalledTimes(1)
  })

  it("fails empty above the service concurrency bulkhead", async () => {
    const releases: Array<(value: unknown) => void> = []
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(resolve)
        }),
    )
    const service = createService()
    const requests = Array.from(
      { length: MAX_CONCURRENT_WATCH_SEARCH_SUGGESTIONS + 1 },
      (_, index) =>
        service.suggest({ query: `je${index}`, languageSlug: "english" }),
    )

    await expect(requests.at(-1)).resolves.toEqual([])
    await vi.waitFor(() => {
      expect(multiSearchMock).toHaveBeenCalledTimes(
        MAX_CONCURRENT_WATCH_SEARCH_SUGGESTIONS,
      )
    })

    const emptyResult = {
      found: 0,
      out_of: 0,
      page: 1,
      search_time_ms: 1,
      grouped_hits: [],
    }
    for (const release of releases) release([emptyResult])
    await expect(Promise.all(requests)).resolves.toHaveLength(
      MAX_CONCURRENT_WATCH_SEARCH_SUGGESTIONS + 1,
    )
    expect(findFirstMock).toHaveBeenCalledTimes(1)
  })

  it("returns stable unique raw titles capped at five", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchMock.mockResolvedValue([
      {
        found: 7,
        out_of: 7,
        page: 1,
        search_time_ms: 1,
        grouped_hits: [
          [
            "Jesus",
            "JESUS",
            "Jesus Wept",
            "Jesus Lives",
            "Jesus Film",
            "Jesus Messiah",
            "Jesus Before Pilate",
          ].map((title, index) => ({
            group_key: [`canonical-${index}`],
            found: 1,
            hits: [
              {
                document: {
                  canonicalVideoId: `canonical-${index}`,
                  title_en: [title],
                  title_fallback: [],
                },
              },
            ],
          })),
        ].flat(),
      },
    ])

    await expect(
      createService().suggest({ query: "je", languageSlug: "english" }),
    ).resolves.toEqual([
      "Jesus",
      "Jesus Wept",
      "Jesus Lives",
      "Jesus Film",
      "Jesus Messiah",
    ])
  })

  it("filters by exact public language identity when slugs share a locale", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "ko" })
    multiSearchMock.mockResolvedValue([
      {
        found: 1,
        out_of: 1,
        page: 1,
        search_time_ms: 1,
        grouped_hits: [
          {
            group_key: ["canonical-1"],
            found: 1,
            hits: [
              {
                document: {
                  canonicalVideoId: "canonical-1",
                  title_ko: ["Jesus Korean Sign Language"],
                  title_fallback: [],
                },
              },
            ],
          },
        ],
      },
    ])

    await expect(
      createService().suggest({
        query: "je",
        languageSlug: "korean-sign-language",
      }),
    ).resolves.toEqual(["Jesus Korean Sign Language"])

    expect(multiSearchMock).toHaveBeenCalledWith([
      expect.objectContaining({
        query_by: "title_ko,title_fallback",
        filter_by: "languageIdentity:=[`slug:korean-sign-language`]",
        include_fields: "canonicalVideoId,title_ko,title_fallback",
      }),
    ])
  })

  it("rejects an oversized public language slug before cache or Prisma work", async () => {
    const oversizedSlug = "s".repeat(
      MAX_WATCH_SEARCH_SUGGESTION_LANGUAGE_SLUG_CODE_POINTS + 1,
    )

    await expect(
      createService().suggest({ query: "je", languageSlug: oversizedSlug }),
    ).resolves.toEqual([])

    expect(findFirstMock).not.toHaveBeenCalled()
    expect(multiSearchMock).not.toHaveBeenCalled()
  })

  it("fails empty when language or Typesense is unavailable", async () => {
    findFirstMock.mockResolvedValueOnce(null)
    await expect(
      createService().suggest({ query: "je", languageSlug: "missing" }),
    ).resolves.toEqual([])
    expect(multiSearchMock).not.toHaveBeenCalled()

    findFirstMock.mockResolvedValueOnce({ bcp47: "en" })
    multiSearchMock.mockRejectedValueOnce(new Error("offline"))
    await expect(
      createService().suggest({ query: "je", languageSlug: "english" }),
    ).resolves.toEqual([])
    expect(warnMock).toHaveBeenCalledWith(
      "[watch-search-suggestions] event=typesense_unavailable",
    )
  })
})
