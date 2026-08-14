import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  MAX_CONCURRENT_WATCH_SEARCH_SUGGESTIONS,
  MAX_WATCH_SEARCH_QUERY_SUGGESTIONS,
  MAX_WATCH_SEARCH_SUGGESTION_LANGUAGE_SLUG_CODE_POINTS,
  MAX_WATCH_SEARCH_SUGGESTION_PREFIX_CODE_POINTS,
  TypesenseWatchSearchSuggestionsService,
} from "./typesense-watch-search-suggestions"
import { TypesenseSearchResultError } from "./typesense-client"

const findFirstMock = vi.fn()
const videoFindManyMock = vi.fn()
const multiSearchMock = vi.fn()
const multiSearchSettledMock = vi.fn()
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
    {
      multiSearch: multiSearchMock,
      multiSearchSettled: multiSearchSettledMock,
    } as never,
    { warn: warnMock },
  )
}

function languageIdentityFromRequest(request: { filter_by?: string }): string {
  return request.filter_by?.match(/`([^`]+)`/)?.[1] ?? "slug:english"
}

function withTestLanguageIdentity(
  result: unknown,
  request: { filter_by?: string },
): unknown {
  if (!result || typeof result !== "object" || !("grouped_hits" in result)) {
    return result
  }
  const groupedHits = (result as { grouped_hits?: unknown[] }).grouped_hits
  if (!Array.isArray(groupedHits)) return result
  return {
    ...result,
    grouped_hits: groupedHits.map((group) => {
      if (!group || typeof group !== "object" || !("hits" in group)) {
        return group
      }
      const hits = (group as { hits?: unknown[] }).hits
      return {
        ...group,
        hits: Array.isArray(hits)
          ? hits.map((hit) => {
              if (!hit || typeof hit !== "object" || !("document" in hit)) {
                return hit
              }
              const document = (hit as { document?: unknown }).document
              return document && typeof document === "object"
                ? {
                    ...hit,
                    document: {
                      languageIdentity: languageIdentityFromRequest(request),
                      ...document,
                    },
                  }
                : hit
            })
          : hits,
      }
    }),
  }
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
  multiSearchSettledMock.mockImplementation(
    async (searches: Array<{ filter_by?: string }>, options?: unknown) => {
      const resolved = (await (options === undefined
        ? multiSearchMock(searches)
        : multiSearchMock(searches, options))) as unknown[]
      const results =
        searches.length === 2 && resolved.length === 1
          ? [
              ...resolved,
              {
                found: 0,
                out_of: 0,
                page: 1,
                search_time_ms: 1,
                grouped_hits: [],
              },
            ]
          : resolved
      return results.map((result, index) => ({
        status: "fulfilled",
        value: withTestLanguageIdentity(result, searches[index] ?? {}),
      }))
    },
  )
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
    multiSearchMock
      .mockResolvedValueOnce([
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
      .mockImplementation(async (searches: unknown[]) =>
        searches.map(() => ({
          found: 1,
          out_of: 1,
          page: 1,
          search_time_ms: 1,
          hits: [{ document: { id: "validated" } }],
        })),
      )

    const result = await createService().suggest({
      query: overlongQuery,
      languageSlug: "english",
    })

    expect(findFirstMock).toHaveBeenCalledWith({
      where: { deletedAt: null, slug: "english" },
      select: { bcp47: true },
    })
    expect(multiSearchMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          collection: "watch_search_lexical",
          q: overlongQuery.slice(0, 200),
          query_by: "title_en,title_fallback,metadata_en,metadata_fallback",
          query_by_weights: "8,4,2,1",
          filter_by: "languageIdentity:=[`slug:english`]",
          include_fields:
            "videoId,canonicalVideoId,languageIdentity,title_en,title_fallback,metadata_en,metadata_fallback",
          per_page: 25,
          group_by: "canonicalVideoId",
          group_limit: 1,
          prefix: true,
          num_typos: "0,0,0,0",
          prioritize_exact_match: true,
          text_match_type: "max_weight",
        }),
      ]),
    )
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

  it("sends exactly one bounded settled retrieval with baseline and expansion lanes", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchSettledMock.mockResolvedValueOnce([
      {
        status: "fulfilled",
        value: {
          found: 0,
          out_of: 0,
          page: 1,
          search_time_ms: 1,
          grouped_hits: [],
        },
      },
      {
        status: "fulfilled",
        value: {
          found: 0,
          out_of: 0,
          page: 1,
          search_time_ms: 1,
          grouped_hits: [],
        },
      },
    ])

    await expect(
      createService().suggest({ query: "shorts", languageSlug: "english" }),
    ).resolves.toEqual([])

    expect(multiSearchSettledMock).toHaveBeenCalledTimes(1)
    const [searches] = multiSearchSettledMock.mock.calls[0] as [
      Array<Record<string, unknown>>,
    ]
    expect(searches).toHaveLength(2)
    expect(searches[0]).toEqual(
      expect.objectContaining({
        collection: "watch_search_lexical",
        query_by: "title_en,title_fallback,metadata_en,metadata_fallback",
        query_by_weights: "8,4,2,1",
        filter_by: "languageIdentity:=[`slug:english`]",
        per_page: 25,
        group_by: "canonicalVideoId",
        group_limit: 1,
        prefix: true,
        num_typos: "0,0,0,0",
      }),
    )
    expect(searches[1]).toEqual(
      expect.objectContaining({
        collection: "watch_search_lexical",
        query_by:
          "taxonomy_en,taxonomy_fallback,title_stem_en,metadata_stem_en,taxonomy_stem_en",
        filter_by: "languageIdentity:=[`slug:english`]",
        per_page: 25,
        group_by: "canonicalVideoId",
        group_limit: 1,
        prefix: true,
        num_typos: "0,0,0,0,0",
      }),
    )
    expect(
      searches.reduce(
        (bytes, search) =>
          bytes + new TextEncoder().encode(String(search.query_by)).byteLength,
        0,
      ),
    ).toBeLessThanOrEqual(4_096)
    expect(
      new TextEncoder().encode(JSON.stringify({ searches })).byteLength,
    ).toBeLessThanOrEqual(32_768)
  })

  it("admits English shorts through title-stem evidence without a raw prefix", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchSettledMock.mockResolvedValueOnce([
      {
        status: "fulfilled",
        value: {
          found: 0,
          out_of: 0,
          page: 1,
          search_time_ms: 1,
          grouped_hits: [],
        },
      },
      {
        status: "fulfilled",
        value: {
          found: 1,
          out_of: 1,
          page: 1,
          search_time_ms: 1,
          grouped_hits: [
            {
              group_key: ["canonical-short-film"],
              found: 1,
              hits: [
                {
                  document: {
                    videoId: "video-short-film",
                    canonicalVideoId: "canonical-short-film",
                    languageIdentity: "slug:english",
                    title_en: ["Short Film"],
                    title_stem_en: ["Short Film"],
                  },
                  highlights: [
                    {
                      field: "title_stem_en",
                      matched_tokens: ["short"],
                    },
                  ],
                  text_match_info: { score: "120" },
                },
              ],
            },
          ],
        },
      },
    ])

    await expect(
      createService().suggest({ query: "shorts", languageSlug: "english" }),
    ).resolves.toEqual([
      contentSuggestion("Short Film", null, "title", "video-short-film"),
    ])
    expect(multiSearchMock).not.toHaveBeenCalled()
  })

  it("admits a localized taxonomy-only hit without fabricating phrase rows", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "es" })
    multiSearchSettledMock.mockResolvedValueOnce([
      {
        status: "fulfilled",
        value: {
          found: 0,
          out_of: 0,
          page: 1,
          search_time_ms: 1,
          grouped_hits: [],
        },
      },
      {
        status: "fulfilled",
        value: {
          found: 1,
          out_of: 1,
          page: 1,
          search_time_ms: 1,
          grouped_hits: [
            {
              group_key: ["canonical-corto"],
              found: 1,
              hits: [
                {
                  document: {
                    videoId: "video-corto",
                    canonicalVideoId: "canonical-corto",
                    languageIdentity: "slug:spanish-castilian",
                    title_es: ["La historia de Ana"],
                    metadata_es: ["Una historia de esperanza"],
                    taxonomy_es: ["Cortometrajes"],
                  },
                  highlights: [
                    {
                      field: "taxonomy_es",
                      matched_tokens: ["cortometrajes"],
                    },
                  ],
                  text_match_info: { score: "99" },
                },
              ],
            },
          ],
        },
      },
    ])

    const result = await createService().suggest({
      query: "cortometrajes",
      languageSlug: "spanish-castilian",
    })

    expect(result).toEqual([
      contentSuggestion(
        "La historia de Ana",
        "Una historia de esperanza",
        "title",
        "video-corto",
      ),
    ])
    expect(result.every((row) => row.kind === "content")).toBe(true)
    expect(multiSearchMock).not.toHaveBeenCalled()
  })

  it("preserves the baseline when the expansion sub-result fails", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchSettledMock.mockResolvedValueOnce([
      {
        status: "fulfilled",
        value: {
          found: 1,
          out_of: 1,
          page: 1,
          search_time_ms: 1,
          grouped_hits: [
            {
              group_key: ["canonical-jesus"],
              found: 1,
              hits: [
                {
                  document: {
                    videoId: "video-jesus",
                    canonicalVideoId: "canonical-jesus",
                    languageIdentity: "slug:english",
                    title_en: ["Jesus Film"],
                  },
                  highlights: [{ field: "title_en", matched_tokens: ["jes"] }],
                  text_match_info: { score: "10" },
                },
              ],
            },
          ],
        },
      },
      {
        status: "rejected",
        reason: new TypesenseSearchResultError(
          "field not found: taxonomy_en",
          404,
          1,
        ),
      },
    ])
    multiSearchMock.mockImplementation(async (searches: unknown[]) =>
      searches.map(() => ({
        found: 0,
        out_of: 0,
        page: 1,
        search_time_ms: 1,
        hits: [],
      })),
    )

    await expect(
      createService().suggest({ query: "jes", languageSlug: "english" }),
    ).resolves.toEqual([
      contentSuggestion("Jesus Film", null, "title", "video-jesus"),
    ])
    expect(warnMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "event=lane_outcome lane=expansion outcome=expansion_unavailable",
      ),
    )
  })

  it("returns expanded direct matches without phrases when the baseline fails", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    multiSearchSettledMock.mockResolvedValueOnce([
      {
        status: "rejected",
        reason: new TypesenseSearchResultError("baseline failed", 500, 0),
      },
      {
        status: "fulfilled",
        value: {
          found: 1,
          out_of: 1,
          page: 1,
          search_time_ms: 1,
          grouped_hits: [
            {
              group_key: ["canonical-short"],
              found: 1,
              hits: [
                {
                  document: {
                    videoId: "video-short",
                    canonicalVideoId: "canonical-short",
                    languageIdentity: "slug:english",
                    title_en: ["Short Film"],
                    taxonomy_stem_en: ["Short Film"],
                  },
                  highlights: [
                    {
                      field: "taxonomy_stem_en",
                      matched_tokens: ["short"],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ])

    const result = await createService().suggest({
      query: "shorts",
      languageSlug: "english",
    })

    expect(result).toEqual([
      contentSuggestion("Short Film", null, "title", "video-short"),
    ])
    expect(result.every((row) => row.kind === "content")).toBe(true)
    expect(multiSearchMock).not.toHaveBeenCalled()
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
    expect(multiSearchMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          query_by: "title_fallback,metadata_fallback",
          query_by_weights: "8,2",
          filter_by: "languageIdentity:=[`slug:hawaiian`]",
          include_fields:
            "videoId,canonicalVideoId,languageIdentity,title_fallback,metadata_fallback",
          num_typos: "0,0",
        }),
      ]),
    )
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
    multiSearchMock
      .mockResolvedValueOnce([
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
      .mockImplementation(async (searches: unknown[]) =>
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
      "JESUS",
      "Jesus Wept",
      "Jesus Lives",
      "Jesus Film",
      "Jesus Messiah",
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

    expect(multiSearchMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          query_by: "title_ko,title_fallback,metadata_ko,metadata_fallback",
          filter_by: "languageIdentity:=[`slug:korean-sign-language`]",
          include_fields:
            "videoId,canonicalVideoId,languageIdentity,title_ko,title_fallback,metadata_ko,metadata_fallback",
        }),
      ]),
    )
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

  it("orders evidence tiers deterministically and deduplicates canonical videos", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    const hit = ({
      videoId,
      canonicalVideoId,
      title,
      field,
      fieldValue,
      score,
    }: {
      videoId: string
      canonicalVideoId: string
      title: string
      field: string
      fieldValue: string
      score: string
    }) => ({
      document: {
        videoId,
        canonicalVideoId,
        languageIdentity: "slug:english",
        title_en: [title],
        [field]: [fieldValue],
      },
      highlights: [{ field, matched_tokens: ["jes"] }],
      text_match_info: { score },
    })
    const group = (canonicalVideoId: string, value: unknown) => ({
      group_key: [canonicalVideoId],
      found: 1,
      hits: [value],
    })
    multiSearchSettledMock.mockResolvedValueOnce([
      {
        status: "fulfilled",
        value: {
          found: 2,
          out_of: 2,
          page: 1,
          search_time_ms: 1,
          grouped_hits: [
            group(
              "canonical-metadata",
              hit({
                videoId: "video-metadata",
                canonicalVideoId: "canonical-metadata",
                title: "Metadata result",
                field: "metadata_en",
                fieldValue: "Jesus story",
                score: "999",
              }),
            ),
            group(
              "canonical-title",
              hit({
                videoId: "video-title",
                canonicalVideoId: "canonical-title",
                title: "Jesus literal title",
                field: "title_en",
                fieldValue: "Jesus literal title",
                score: "1",
              }),
            ),
          ],
        },
      },
      {
        status: "fulfilled",
        value: {
          found: 5,
          out_of: 5,
          page: 1,
          search_time_ms: 1,
          grouped_hits: [
            group(
              "canonical-title",
              hit({
                videoId: "video-title-duplicate",
                canonicalVideoId: "canonical-title",
                title: "Duplicate lower evidence",
                field: "title_stem_en",
                fieldValue: "Jesus duplicate",
                score: "999999",
              }),
            ),
            group(
              "canonical-stem-metadata",
              hit({
                videoId: "video-stem-metadata",
                canonicalVideoId: "canonical-stem-metadata",
                title: "Stem metadata",
                field: "metadata_stem_en",
                fieldValue: "Jesus metadata",
                score: "900",
              }),
            ),
            group(
              "canonical-stem-taxonomy",
              hit({
                videoId: "video-stem-taxonomy",
                canonicalVideoId: "canonical-stem-taxonomy",
                title: "Stem taxonomy",
                field: "taxonomy_stem_en",
                fieldValue: "Jesus taxonomy",
                score: "800",
              }),
            ),
            group(
              "canonical-stem-title",
              hit({
                videoId: "video-stem-title",
                canonicalVideoId: "canonical-stem-title",
                title: "Stem title",
                field: "title_stem_en",
                fieldValue: "Jesus title",
                score: "2",
              }),
            ),
            group(
              "canonical-taxonomy",
              hit({
                videoId: "video-taxonomy",
                canonicalVideoId: "canonical-taxonomy",
                title: "Literal taxonomy",
                field: "taxonomy_en",
                fieldValue: "Jesus category",
                score: "1",
              }),
            ),
          ],
        },
      },
    ])
    multiSearchMock.mockImplementation(async (searches: unknown[]) =>
      searches.map(() => ({
        found: 0,
        out_of: 0,
        page: 1,
        search_time_ms: 1,
        hits: [],
      })),
    )

    const result = await createService().suggest({
      query: "jes",
      languageSlug: "english",
    })

    expect(
      result.filter((row) => row.kind === "content").map((row) => row.title),
    ).toEqual([
      "Jesus literal title",
      "Literal taxonomy",
      "Stem title",
      "Metadata result",
      "Stem taxonomy",
      "Stem metadata",
    ])
    expect(videoFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: {
            in: [
              "video-title",
              "video-taxonomy",
              "video-stem-title",
              "video-metadata",
              "video-stem-taxonomy",
              "video-stem-metadata",
            ],
          },
        }),
      }),
    )
  })

  it("rejects a wrong exact-slug sibling before bounded hydration even when it is first", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "ko" })
    multiSearchSettledMock.mockResolvedValueOnce([
      {
        status: "fulfilled",
        value: {
          found: 2,
          out_of: 2,
          page: 1,
          search_time_ms: 1,
          grouped_hits: [
            {
              group_key: ["canonical-wrong"],
              found: 1,
              hits: [
                {
                  document: {
                    videoId: "video-wrong-korean",
                    canonicalVideoId: "canonical-wrong",
                    languageIdentity: "slug:korean",
                    title_ko: ["Jesus wrong sibling"],
                  },
                  highlights: [{ field: "title_ko", matched_tokens: ["jes"] }],
                },
              ],
            },
            {
              group_key: ["canonical-right"],
              found: 1,
              hits: [
                {
                  document: {
                    videoId: "video-right-ksl",
                    canonicalVideoId: "canonical-right",
                    languageIdentity: "slug:korean-sign-language",
                    title_ko: ["Jesus Korean Sign Language"],
                  },
                  highlights: [{ field: "title_ko", matched_tokens: ["jes"] }],
                },
              ],
            },
          ],
        },
      },
      {
        status: "fulfilled",
        value: {
          found: 0,
          out_of: 0,
          page: 1,
          search_time_ms: 1,
          grouped_hits: [],
        },
      },
    ])
    multiSearchMock.mockImplementation(async (searches: unknown[]) =>
      searches.map(() => ({
        found: 0,
        out_of: 0,
        page: 1,
        search_time_ms: 1,
        hits: [],
      })),
    )

    const result = await createService().suggest({
      query: "jes",
      languageSlug: "korean-sign-language",
    })

    expect(result.filter((row) => row.kind === "content")).toEqual([
      contentSuggestion(
        "Jesus Korean Sign Language",
        null,
        "title",
        "video-right-ksl",
      ),
    ])
    expect(videoFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["video-right-ksl"] } }),
      }),
    )
  })

  it("bounds and merges maximal 25-group baseline and expansion results", async () => {
    findFirstMock.mockResolvedValue({ bcp47: "en" })
    const baselineGroups = Array.from({ length: 25 }, (_, index) => ({
      group_key: [`canonical-baseline-${index}`],
      found: 1,
      hits: [
        {
          document: {
            videoId: `video-baseline-${index}`,
            canonicalVideoId: `canonical-baseline-${index}`,
            languageIdentity: "slug:english",
            title_en: [`Baseline ${index}`],
          },
          highlights: [{ field: "title_en", matched_tokens: ["baseline"] }],
        },
      ],
    }))
    const expansionGroups = Array.from({ length: 25 }, (_, index) => ({
      group_key: [`canonical-expansion-${index}`],
      found: 1,
      hits: [
        {
          document: {
            videoId: `video-expansion-${index}`,
            canonicalVideoId: `canonical-expansion-${index}`,
            languageIdentity: "slug:english",
            title_en: [`Short Film ${index}`],
            title_stem_en: [`Short Film ${index}`],
          },
          highlights: [{ field: "title_stem_en", matched_tokens: ["short"] }],
          text_match: 100 - index,
        },
      ],
    }))
    multiSearchSettledMock.mockResolvedValueOnce([
      {
        status: "fulfilled",
        value: {
          found: 25,
          out_of: 25,
          page: 1,
          search_time_ms: 2,
          grouped_hits: baselineGroups,
        },
      },
      {
        status: "fulfilled",
        value: {
          found: 25,
          out_of: 25,
          page: 1,
          search_time_ms: 2,
          grouped_hits: expansionGroups,
        },
      },
    ])

    const result = await createService().suggest({
      query: "shorts",
      languageSlug: "english",
    })

    expect(multiSearchSettledMock).toHaveBeenCalledTimes(1)
    expect(result.filter((row) => row.kind === "content")).toHaveLength(6)
    expect(new Set(result.map((row) => row.id)).size).toBe(result.length)
    expect(videoFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: {
            in: Array.from(
              { length: 6 },
              (_, index) => `video-expansion-${index}`,
            ),
          },
        }),
      }),
    )
    expect(multiSearchMock).not.toHaveBeenCalled()
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
      expect.stringContaining(
        "event=typesense_unavailable lane=total outcome=total_unavailable revision=watch-search-candidate/v2",
      ),
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
    const typesense = {
      multiSearch: multiSearchMock,
      multiSearchSettled: multiSearchSettledMock,
    }
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
