import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  MAX_CONCURRENT_WATCH_SEARCH_SUGGESTIONS,
  MAX_WATCH_SEARCH_QUERY_SUGGESTIONS,
  MAX_WATCH_SEARCH_SUGGESTION_LANGUAGE_SLUG_CODE_POINTS,
  MAX_WATCH_SEARCH_SUGGESTION_PREFIX_CODE_POINTS,
  TypesenseWatchSearchSuggestionsService,
} from "./typesense-watch-search-suggestions"

const findFirstMock = vi.fn()
const videoFindManyMock = vi.fn()
const multiSearchMock = vi.fn()
const warnMock = vi.fn()

function createService() {
  return createServiceWithPrisma({
    language: { findFirst: findFirstMock },
    video: { findMany: videoFindManyMock },
  })
}

function createServiceWithPrisma(prisma: unknown) {
  return new TypesenseWatchSearchSuggestionsService(
    prisma as never,
    { multiSearch: multiSearchMock } as never,
    { warn: warnMock },
  )
}

function contentSuggestion(
  title: string,
  description: string | null = null,
  matchSource: "title" | "description" = "title",
  id = `video-${title}`,
) {
  return {
    kind: "content",
    title,
    description,
    matchSource,
    id,
    slug: id
      .replace(/^video-/, "")
      .toLocaleLowerCase()
      .replace(/\s+/g, "-"),
    label: "FEATURE_FILM",
    childCount: 0,
  }
}

function querySuggestion(title: string) {
  return {
    kind: "query",
    title,
    description: null,
    matchSource: "title",
    id: null,
    slug: null,
    label: null,
    childCount: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  videoFindManyMock.mockImplementation(
    ({ where }: { where: { id: { in: string[] } } }) =>
      Promise.resolve(
        where.id.in.map((id) => ({
          id,
          slug: id
            .replace(/^video-/, "")
            .toLocaleLowerCase()
            .replace(/\s+/g, "-"),
          label: "FEATURE_FILM",
          _count: { children: 0 },
        })),
      ),
  )
})

afterEach(() => vi.useRealTimers())

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

  it("caps input before lookup and sends one title-dominant localized request", async () => {
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
                  videoId: "video-long",
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
        query_by: "title_en,title_fallback,metadata_en,metadata_fallback",
        query_by_weights: "8,4,2,1",
        filter_by: "languageIdentity:=[`slug:english`]",
        include_fields:
          "videoId,canonicalVideoId,title_en,title_fallback,metadata_en,metadata_fallback",
        per_page: 25,
        group_by: "canonicalVideoId",
        group_limit: 1,
        prefix: true,
        num_typos: "0,0,0,0",
        prioritize_exact_match: true,
        text_match_type: "max_weight",
      }),
    ])
    expect(result).toEqual([
      querySuggestion(overlongQuery.slice(0, 200)),
      contentSuggestion(
        overlongQuery.slice(0, 200),
        null,
        "title",
        "video-long",
      ),
    ])
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
                  videoId: "video-jesus-film",
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
    ).resolves.toEqual([
      querySuggestion("Jesus"),
      contentSuggestion("Jesus Film", null, "title", "video-jesus-film"),
    ])

    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null, slug: "hawaiian" } }),
    )
    expect(multiSearchMock).toHaveBeenCalledWith([
      expect.objectContaining({
        query_by: "title_fallback,metadata_fallback",
        query_by_weights: "8,2",
        filter_by: "languageIdentity:=[`slug:hawaiian`]",
        include_fields:
          "videoId,canonicalVideoId,title_fallback,metadata_fallback",
        num_typos: "0,0",
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
    const prisma = {
      language: { findFirst: findFirstMock },
      video: { findMany: videoFindManyMock },
    }

    void createServiceWithPrisma(prisma).suggest({
      query: "je",
      languageSlug: "english",
    })
    void createServiceWithPrisma(prisma).suggest({
      query: "je",
      languageSlug: "english",
    })

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
    const prisma = {
      language: { findFirst: findFirstMock },
      video: { findMany: videoFindManyMock },
    }
    const requests = Array.from(
      { length: MAX_CONCURRENT_WATCH_SEARCH_SUGGESTIONS + 1 },
      (_, index) =>
        createServiceWithPrisma(prisma).suggest({
          query: `je${index}`,
          languageSlug: "english",
        }),
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

  it("returns stable unique direct matches within the configured caps", async () => {
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
                  videoId: `video-${index}`,
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

    const result = await createService().suggest({
      query: "je",
      languageSlug: "english",
    })

    expect(result[0]).toEqual(querySuggestion("Jesus"))
    expect(
      result.filter((row) => row.kind === "query").length,
    ).toBeLessThanOrEqual(MAX_WATCH_SEARCH_QUERY_SUGGESTIONS)
    expect(result.filter((row) => row.kind === "content")).toHaveLength(6)
    expect(
      result.filter((row) => row.kind === "content").map((row) => row.title),
    ).toEqual([
      "Jesus",
      "Jesus Wept",
      "Jesus Lives",
      "Jesus Film",
      "Jesus Messiah",
      "Jesus Before Pilate",
    ])
  })

  it("filters by exact public language identity when slugs share a locale", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "ko" })
    multiSearchMock.mockResolvedValueOnce([
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
                  videoId: "video-korean",
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
    multiSearchMock.mockImplementationOnce(async (searches: unknown[]) =>
      searches.map(() => ({
        found: 1,
        out_of: 1,
        page: 1,
        search_time_ms: 1,
        hits: [{ document: { id: "validated" } }],
      })),
    )

    const result = await createService().suggest({
      query: "je",
      languageSlug: "korean-sign-language",
    })
    expect(result.slice(0, 3).map((row) => row.title)).toEqual([
      "Jesus",
      "Jesus Korean Sign",
      "Jesus Korean Sign Language",
    ])
    expect(result.at(-1)).toEqual(
      contentSuggestion(
        "Jesus Korean Sign Language",
        null,
        "title",
        "video-korean",
      ),
    )

    expect(multiSearchMock).toHaveBeenCalledWith([
      expect.objectContaining({
        query_by: "title_ko,title_fallback,metadata_ko,metadata_fallback",
        filter_by: "languageIdentity:=[`slug:korean-sign-language`]",
        include_fields:
          "videoId,canonicalVideoId,title_ko,title_fallback,metadata_ko,metadata_fallback",
      }),
    ])
  })

  it("returns description matches after title matches with localized context", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchMock.mockResolvedValueOnce([
      {
        found: 2,
        out_of: 2,
        page: 1,
        search_time_ms: 1,
        grouped_hits: [
          {
            group_key: ["canonical-description"],
            found: 1,
            hits: [
              {
                document: {
                  videoId: "video-life",
                  canonicalVideoId: "canonical-description",
                  title_en: ["The Life of Christ"],
                  metadata_en: [
                    "Discover the story of Jesus and His ministry.",
                  ],
                },
              },
            ],
          },
          {
            group_key: ["canonical-title"],
            found: 1,
            hits: [
              {
                document: {
                  videoId: "video-jesus-film",
                  canonicalVideoId: "canonical-title",
                  title_en: ["Jesus Film"],
                  metadata_en: ["A feature film."],
                },
              },
            ],
          },
        ],
      },
    ])
    multiSearchMock.mockImplementationOnce(async (searches: unknown[]) =>
      searches.map(() => ({
        found: 1,
        out_of: 1,
        page: 1,
        search_time_ms: 1,
        hits: [{ document: { id: "validated" } }],
      })),
    )

    const result = await createService().suggest({
      query: "jes",
      languageSlug: "english",
    })
    expect(result[0]).toEqual(querySuggestion("Jesus"))
    expect(result.filter((row) => row.kind === "content")).toEqual([
      contentSuggestion(
        "Jesus Film",
        "A feature film.",
        "title",
        "video-jesus-film",
      ),
      contentSuggestion(
        "The Life of Christ",
        "Discover the story of Jesus and His ministry.",
        "description",
        "video-life",
      ),
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

  it("validates ranked phrases in one bounded batch and preserves positive order", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchMock.mockResolvedValueOnce([
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
                  videoId: "video-1",
                  canonicalVideoId: "canonical-1",
                  title_en: ["Jesus Heals the Blind Man"],
                  metadata_en: ["Jesus brings sight and hope"],
                },
              },
            ],
          },
        ],
      },
    ])
    multiSearchMock.mockImplementationOnce(
      async (searches: Array<{ q: string }>) =>
        searches.map((search, index) => ({
          found: index === 1 ? 0 : 1,
          out_of: 1,
          page: 1,
          search_time_ms: 1,
          hits:
            index === 1 ? [] : [{ document: { id: `validated-${search.q}` } }],
        })),
    )

    const result = await createService().suggest({
      query: "jes",
      languageSlug: "english",
    })

    const queryTitles = result
      .filter((row) => row.kind === "query")
      .map((row) => row.title)
    const validationCall = multiSearchMock.mock.calls[1]
    expect(queryTitles).not.toContain(validationCall?.[0]?.[1]?.q)
    expect(queryTitles).toEqual(
      validationCall?.[0]
        ?.filter((_request: unknown, index: number) => index !== 1)
        .map((request: { q: string }) => request.q),
    )
    expect(validationCall?.[1]).toEqual({ timeoutMs: 750 })
    expect(validationCall?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collection: "watch_search_lexical",
          q: "Jesus",
          query_by: "title_en,title_fallback,metadata_en,metadata_fallback",
          query_by_weights: "8,4,2,1",
          filter_by: "languageIdentity:=[`slug:english`]",
          page: 1,
          per_page: 1,
          prefix: false,
          num_typos: "0,0,0,0",
          drop_tokens_threshold: 0,
          include_fields: "id",
        }),
      ]),
    )
    expect(validationCall?.[0]).toHaveLength(
      result.filter((row) => row.kind === "query").length + 1,
    )
  })

  it("reuses positive phrase verdicts across service instances and revalidates after expiry", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-12T12:00:00.000Z"))
    const prisma = {
      language: { findFirst: findFirstMock },
      video: { findMany: videoFindManyMock },
    }
    const typesense = { multiSearch: multiSearchMock }
    const createSharedService = () =>
      new TypesenseWatchSearchSuggestionsService(
        prisma as never,
        typesense as never,
        { warn: warnMock },
      )
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchMock.mockImplementation(
      async (searches: Array<{ per_page?: number }>) =>
        searches[0]?.per_page === 25
          ? [
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
                          videoId: "video-1",
                          canonicalVideoId: "canonical-1",
                          title_en: ["Jesus Film"],
                        },
                      },
                    ],
                  },
                ],
              },
            ]
          : searches.map(() => ({
              found: 1,
              out_of: 1,
              page: 1,
              search_time_ms: 1,
              hits: [{ document: { id: "validated" } }],
            })),
    )

    await createSharedService().suggest({
      query: "je",
      languageSlug: "english",
    })
    await createSharedService().suggest({
      query: "jes",
      languageSlug: "english",
    })
    expect(multiSearchMock).toHaveBeenCalledTimes(3)

    vi.setSystemTime(new Date("2026-08-12T12:01:01.000Z"))
    await createSharedService().suggest({
      query: "jesu",
      languageSlug: "english",
    })
    expect(multiSearchMock).toHaveBeenCalledTimes(5)
  })

  it("caches negative verdicts but does not cache validation failures", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    let validationAttempts = 0
    multiSearchMock.mockImplementation(
      async (searches: Array<{ per_page?: number }>) => {
        if (searches[0]?.per_page === 25) {
          return [
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
                        videoId: "video-1",
                        canonicalVideoId: "canonical-1",
                        title_en: ["Jesus Film"],
                      },
                    },
                  ],
                },
              ],
            },
          ]
        }
        validationAttempts += 1
        if (validationAttempts === 1) {
          return searches.map(() => ({
            found: 0,
            out_of: 0,
            page: 1,
            search_time_ms: 1,
            hits: [],
          }))
        }
        throw new Error("validation offline")
      },
    )
    const service = createService()

    await expect(
      service.suggest({ query: "je", languageSlug: "english" }),
    ).resolves.toEqual([
      contentSuggestion("Jesus Film", null, "title", "video-1"),
    ])
    await service.suggest({ query: "jes", languageSlug: "english" })
    expect(validationAttempts).toBe(1)

    const freshService = createService()
    await expect(
      freshService.suggest({ query: "jesu", languageSlug: "english" }),
    ).resolves.toEqual([
      contentSuggestion("Jesus Film", null, "title", "video-1"),
    ])
    await freshService.suggest({ query: "jesus", languageSlug: "english" })
    expect(validationAttempts).toBe(3)
    expect(warnMock).toHaveBeenCalledWith(
      "[watch-search-suggestions] event=phrase_validation_unavailable",
    )
  })

  it.each([
    ["wrong result count", []],
    [
      "malformed result",
      [
        {
          found: Number.NaN,
          out_of: 0,
          page: 1,
          search_time_ms: 1,
          hits: [],
        },
      ],
    ],
  ])("preserves direct matches for a %s", async (_label, validationResult) => {
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchMock
      .mockResolvedValueOnce([
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
                    videoId: "video-1",
                    canonicalVideoId: "canonical-1",
                    title_en: ["Jesus Film"],
                  },
                },
              ],
            },
          ],
        },
      ])
      .mockResolvedValueOnce(validationResult)

    await expect(
      createService().suggest({ query: "je", languageSlug: "english" }),
    ).resolves.toEqual([
      contentSuggestion("Jesus Film", null, "title", "video-1"),
    ])
    expect(warnMock).toHaveBeenCalledWith(
      "[watch-search-suggestions] event=phrase_validation_unavailable",
    )
  })

  it("times out validation, preserves direct matches, and retries cleanly", async () => {
    vi.useFakeTimers()
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    const candidateResult = {
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
                videoId: "video-1",
                canonicalVideoId: "canonical-1",
                title_en: ["Jesus Film"],
              },
            },
          ],
        },
      ],
    }
    let validationAttempts = 0
    multiSearchMock.mockImplementation(
      (
        searches: Array<{ per_page?: number }>,
        options?: { timeoutMs?: number },
      ) => {
        if (searches[0]?.per_page === 25)
          return Promise.resolve([candidateResult])
        validationAttempts += 1
        if (validationAttempts > 1) {
          return Promise.resolve(
            searches.map(() => ({
              found: 1,
              out_of: 1,
              page: 1,
              search_time_ms: 1,
              hits: [{ document: { id: "validated" } }],
            })),
          )
        }
        return new Promise((_resolve, reject) => {
          setTimeout(
            () => reject(new Error("validation timed out")),
            options?.timeoutMs,
          )
        })
      },
    )
    const prisma = {
      language: { findFirst: findFirstMock },
      video: { findMany: videoFindManyMock },
    }
    const first = createServiceWithPrisma(prisma).suggest({
      query: "je",
      languageSlug: "english",
    })
    await vi.advanceTimersByTimeAsync(750)
    await expect(first).resolves.toEqual([
      contentSuggestion("Jesus Film", null, "title", "video-1"),
    ])
    await expect(
      createServiceWithPrisma(prisma).suggest({
        query: "jes",
        languageSlug: "english",
      }),
    ).resolves.toEqual([
      querySuggestion("Jesus"),
      contentSuggestion("Jesus Film", null, "title", "video-1"),
    ])
    expect(validationAttempts).toBe(2)
  })

  it("recovers phrase and content suggestions when one multi-word query token is unmatched", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchMock.mockResolvedValueOnce([
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
                  videoId: "video-story-of-jesus",
                  canonicalVideoId: "canonical-1",
                  title_en: ["The Story of Jesus for Children"],
                },
              },
            ],
          },
        ],
      },
    ])
    multiSearchMock.mockImplementationOnce(async (searches: unknown[]) =>
      searches.map(() => ({
        found: 1,
        out_of: 1,
        page: 1,
        search_time_ms: 1,
        hits: [{ document: { id: "validated" } }],
      })),
    )

    const result = await createService().suggest({
      query: "Jesus for kids",
      languageSlug: "english",
    })

    expect(multiSearchMock.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        q: "Jesus for kids",
        prefix: true,
        drop_tokens_threshold: 1,
      }),
    ])
    expect(multiSearchMock.mock.calls[1]?.[0]).toEqual([
      expect.objectContaining({
        q: "Jesus for Children",
        prefix: false,
        per_page: 1,
        drop_tokens_threshold: 0,
      }),
    ])
    expect(result).toEqual([
      querySuggestion("Jesus for Children"),
      contentSuggestion(
        "The Story of Jesus for Children",
        null,
        "title",
        "video-story-of-jesus",
      ),
    ])
  })

  it.each([
    ["apostrophes", "children's hope lessons", "Children's Hope"],
    ["hyphens", "faith-filled stories kids", "Faith-Filled Stories"],
  ])(
    "uses phrase token boundaries for relaxed title coverage with %s",
    async (_label, query, title) => {
      findFirstMock.mockResolvedValue({ bcp47: "en" })
      multiSearchMock.mockResolvedValueOnce([
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
                    videoId: "video-token-boundary",
                    canonicalVideoId: "canonical-1",
                    title_en: [title],
                  },
                },
              ],
            },
          ],
        },
      ])
      const result = await createService().suggest({
        query,
        languageSlug: "english",
      })

      expect(result.filter((row) => row.kind === "content")).toEqual([
        contentSuggestion(title, null, "title", "video-token-boundary"),
      ])
    },
  )

  it("ranks strict title matches ahead of relaxed matches across candidate groups", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchMock.mockResolvedValueOnce([
      {
        found: 2,
        out_of: 2,
        page: 1,
        search_time_ms: 1,
        grouped_hits: [
          {
            group_key: ["canonical-relaxed"],
            found: 1,
            hits: [
              {
                document: {
                  videoId: "video-relaxed",
                  canonicalVideoId: "canonical-relaxed",
                  title_en: ["The Story of Jesus for Children"],
                },
              },
            ],
          },
          {
            group_key: ["canonical-strict"],
            found: 1,
            hits: [
              {
                document: {
                  videoId: "video-strict",
                  canonicalVideoId: "canonical-strict",
                  title_en: ["Jesus for Kids"],
                },
              },
            ],
          },
        ],
      },
    ])
    multiSearchMock.mockImplementationOnce(async (searches: unknown[]) =>
      searches.map(() => ({
        found: 1,
        out_of: 1,
        page: 1,
        search_time_ms: 1,
        hits: [{ document: { id: "validated" } }],
      })),
    )

    const result = await createService().suggest({
      query: "Jesus for kids",
      languageSlug: "english",
    })

    expect(
      result.filter((row) => row.kind === "content").map((row) => row.title),
    ).toEqual(["Jesus for Kids", "The Story of Jesus for Children"])
  })

  it("ranks title-prefix matches ahead of relaxed matches across candidate groups", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchMock.mockResolvedValueOnce([
      {
        found: 2,
        out_of: 2,
        page: 1,
        search_time_ms: 1,
        grouped_hits: [
          {
            group_key: ["canonical-relaxed"],
            found: 1,
            hits: [
              {
                document: {
                  videoId: "video-relaxed",
                  canonicalVideoId: "canonical-relaxed",
                  title_en: ["The Story of Jesus for Children"],
                },
              },
            ],
          },
          {
            group_key: ["canonical-prefix"],
            found: 1,
            hits: [
              {
                document: {
                  videoId: "video-prefix",
                  canonicalVideoId: "canonical-prefix",
                  title_en: ["Jesus for Kids Around the World"],
                },
              },
            ],
          },
        ],
      },
    ])
    multiSearchMock.mockImplementationOnce(async (searches: unknown[]) =>
      searches.map(() => ({
        found: 1,
        out_of: 1,
        page: 1,
        search_time_ms: 1,
        hits: [{ document: { id: "validated" } }],
      })),
    )

    const result = await createService().suggest({
      query: "Jesus for kids",
      languageSlug: "english",
    })

    expect(
      result.filter((row) => row.kind === "content").map((row) => row.title),
    ).toEqual([
      "Jesus for Kids Around the World",
      "The Story of Jesus for Children",
    ])
  })

  it("surfaces a relaxed metadata phrase only after strict validation without a direct match", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchMock.mockResolvedValueOnce([
      {
        found: 1,
        out_of: 1,
        page: 1,
        search_time_ms: 1,
        grouped_hits: [
          {
            group_key: ["canonical-description"],
            found: 1,
            hits: [
              {
                document: {
                  videoId: "video-description",
                  canonicalVideoId: "canonical-description",
                  title_en: ["An Unrelated Film"],
                  metadata_en: ["The Story of Jesus for Children"],
                },
              },
            ],
          },
        ],
      },
    ])
    multiSearchMock.mockImplementationOnce(async (searches: unknown[]) =>
      searches.map(() => ({
        found: 1,
        out_of: 1,
        page: 1,
        search_time_ms: 1,
        hits: [{ document: { id: "validated" } }],
      })),
    )

    const result = await createService().suggest({
      query: "Jesus for kids",
      languageSlug: "english",
    })

    expect(result).toEqual([
      {
        ...querySuggestion("Jesus for Children"),
        matchSource: "description",
      },
    ])
    expect(multiSearchMock.mock.calls[1]?.[0]).toEqual([
      expect.objectContaining({
        q: "Jesus for Children",
        prefix: false,
        drop_tokens_threshold: 0,
      }),
    ])
  })

  it("keeps two-token queries strict with no dropped-token recall", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchMock.mockResolvedValueOnce([
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
                  videoId: "video-purple-rain",
                  canonicalVideoId: "canonical-1",
                  title_en: ["Purple Rain"],
                },
              },
            ],
          },
        ],
      },
    ])

    const result = await createService().suggest({
      query: "purple kids",
      languageSlug: "english",
    })

    expect(multiSearchMock.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        q: "purple kids",
        drop_tokens_threshold: 0,
      }),
    ])
    expect(result).toEqual([])
    expect(multiSearchMock).toHaveBeenCalledTimes(1)
  })

  it("keeps one-token queries strict with no dropped-token recall", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchMock.mockResolvedValueOnce([
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
                  videoId: "video-purple-rain",
                  canonicalVideoId: "canonical-1",
                  title_en: ["Purple Rain"],
                },
              },
            ],
          },
        ],
      },
    ])

    await createService().suggest({
      query: "purple",
      languageSlug: "english",
    })

    expect(multiSearchMock.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        q: "purple",
        drop_tokens_threshold: 0,
      }),
    ])
  })

  it("deduplicates repeated query tokens before allowing dropped-token recall", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchMock.mockResolvedValueOnce([
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
                  videoId: "video-story-of-jesus",
                  canonicalVideoId: "canonical-1",
                  title_en: ["The Story of Jesus for Children"],
                },
              },
            ],
          },
        ],
      },
    ])

    const result = await createService().suggest({
      query: "Jesus Jesus kids",
      languageSlug: "english",
    })

    expect(multiSearchMock.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        q: "Jesus Jesus kids",
        drop_tokens_threshold: 0,
      }),
    ])
    expect(result).toEqual([])
  })

  it("rejects relaxed title coverage when two unique query tokens are unmatched", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchMock.mockResolvedValueOnce([
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
                  videoId: "video-story-of-jesus",
                  canonicalVideoId: "canonical-1",
                  title_en: ["The Story of Jesus for Children"],
                },
              },
            ],
          },
        ],
      },
    ])

    const result = await createService().suggest({
      query: "Jesus for kids today",
      languageSlug: "english",
    })

    expect(multiSearchMock.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ drop_tokens_threshold: 1 }),
    ])
    expect(result).toEqual([])
  })

  it("never matches through stop words alone even with relaxed recall", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchMock.mockResolvedValueOnce([
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
                  videoId: "video-gospel-of-john",
                  canonicalVideoId: "canonical-1",
                  title_en: ["The Gospel of John"],
                },
              },
            ],
          },
        ],
      },
    ])

    const result = await createService().suggest({
      query: "the story of",
      languageSlug: "english",
    })

    expect(multiSearchMock.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        q: "the story of",
        drop_tokens_threshold: 1,
      }),
    ])
    expect(result).toEqual([])
    expect(multiSearchMock).toHaveBeenCalledTimes(1)
  })

  it("isolates phrase verdicts by exact public language identity", async () => {
    const prisma = {
      language: { findFirst: findFirstMock },
      video: { findMany: videoFindManyMock },
    }
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchMock.mockImplementation(
      async (searches: Array<{ per_page?: number; filter_by?: string }>) =>
        searches[0]?.per_page === 25
          ? [
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
                          videoId: "video-1",
                          canonicalVideoId: "canonical-1",
                          title_en: ["Jesus Film"],
                        },
                      },
                    ],
                  },
                ],
              },
            ]
          : searches.map((search) => ({
              found: search.filter_by?.includes("slug:english-two") ? 0 : 1,
              out_of: 1,
              page: 1,
              search_time_ms: 1,
              hits: [],
            })),
    )

    const first = await createServiceWithPrisma(prisma).suggest({
      query: "je",
      languageSlug: "english-one",
    })
    const second = await createServiceWithPrisma(prisma).suggest({
      query: "jes",
      languageSlug: "english-two",
    })

    expect(first.some((row) => row.kind === "query")).toBe(true)
    expect(second.some((row) => row.kind === "query")).toBe(false)
    expect(
      multiSearchMock.mock.calls.filter(([searches]) =>
        searches.every(
          (search: { per_page?: number }) => search.per_page === 1,
        ),
      ),
    ).toHaveLength(2)
  })
})
