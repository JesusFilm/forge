import { beforeEach, describe, expect, it, vi } from "vitest"

import { searchVideos } from "./search"

const { adminQuery, semanticSearchAdminQuery } = vi.hoisted(() => ({
  adminQuery: vi.fn(),
  semanticSearchAdminQuery: vi.fn(),
}))

vi.mock("@/lib/admin-client", () => ({
  default: {
    query: adminQuery,
  },
  semanticSearchAdminClient: {
    query: semanticSearchAdminQuery,
  },
}))

function watchResult(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: "VIDEO",
    id: "video-1",
    slug: "jesus",
    title: "JESUS",
    imageUrl: null,
    imageBlurDataUrl: null,
    muxThumbnailBlurDataUrl: null,
    snippet: "",
    playbackId: "playback-1",
    startSeconds: null,
    score: 0.97,
    label: "FEATURE_FILM",
    durationSeconds: 7200,
    childCount: 0,
    languageSlug: "english",
    languageEnglishName: "English",
    availability: {
      kind: "TARGET_AUDIO",
      languageEnglishName: "English",
    },
    evidence: null,
    action: {
      kind: "WATCH",
      hrefLanguageSlug: "english",
    },
    fallback: {
      kind: "NONE",
    },
    ...overrides,
  }
}

function watchSearchPage({
  results,
  hasMore = false,
  nextOffset = 0,
  requestId = "watch_search_req_1",
  query = "jesus",
  latencyMs = 12,
}: {
  results: Record<string, unknown>[]
  hasMore?: boolean
  nextOffset?: number
  requestId?: string
  query?: string
  latencyMs?: number
}) {
  return {
    data: {
      watchSearch: {
        results,
        hasMore,
        requestId,
        degraded: false,
        laneStatuses: [],
        query,
        searchMode: "watch-search",
        latencyMs,
        nextOffset,
      },
    },
  }
}

describe("searchVideos", () => {
  beforeEach(() => {
    adminQuery.mockReset()
    semanticSearchAdminQuery.mockReset()
  })

  it("calls the Admin Watch search contract with a canonical default display language", async () => {
    semanticSearchAdminQuery.mockResolvedValueOnce({
      data: {
        watchSearch: {
          results: [],
          hasMore: false,
          requestId: "watch_search_req_1",
          degraded: false,
          laneStatuses: [
            {
              lane: "exact_title",
              status: "fulfilled",
              elapsedMs: 4,
              resultCount: 0,
              reason: null,
            },
          ],
          query: "jesus",
          searchMode: "watch-search",
          latencyMs: 12,
          nextOffset: 0,
        },
      },
    })

    const data = await searchVideos("jesus")

    expect(adminQuery).not.toHaveBeenCalled()
    expect(semanticSearchAdminQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          input: {
            query: "jesus",
            clientRequestId: undefined,
            targetLanguageSlug: undefined,
            queryLanguageSlug: undefined,
            queryNamedLanguageSlug: undefined,
            displayLanguageSlug: "english",
            routeLanguageSlug: undefined,
            currentWatchLanguageSlug: undefined,
            acceptLanguage: undefined,
            limit: 20,
            offset: 0,
            resultTypes: undefined,
          },
        },
        fetchPolicy: "no-cache",
      }),
    )
    expect(data).toMatchObject({
      results: [],
      hasMore: false,
      query: "jesus",
      searchMode: "watch-search",
      requestId: "watch_search_req_1",
      degraded: false,
      laneStatuses: [
        {
          lane: "exact_title",
          status: "fulfilled",
          elapsedMs: 4,
          resultCount: 0,
          reason: null,
        },
      ],
      nextOffset: 0,
    })
    expect(data.latencyMs).toBe(12)
  })

  it("canonicalizes a localized UI language without synthesizing route context", async () => {
    semanticSearchAdminQuery.mockResolvedValueOnce({
      data: {
        watchSearch: {
          results: [],
          hasMore: false,
          query: "x".repeat(200),
          searchMode: "watch-search",
          latencyMs: 9,
          nextOffset: 40,
        },
      },
    })

    const data = await searchVideos("x".repeat(250), 10, 40, "video", "es")

    expect(semanticSearchAdminQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          input: expect.objectContaining({
            query: "x".repeat(200),
            clientRequestId: undefined,
            targetLanguageSlug: undefined,
            queryLanguageSlug: undefined,
            queryNamedLanguageSlug: undefined,
            displayLanguageSlug: "spanish-castilian",
            routeLanguageSlug: undefined,
            currentWatchLanguageSlug: undefined,
            acceptLanguage: undefined,
            limit: 10,
            offset: 40,
            resultTypes: ["VIDEO"],
          }),
        },
      }),
    )
    expect(data.query).toHaveLength(200)
    expect(data.nextOffset).toBe(40)
  })

  it("preserves an explicitly null route language", async () => {
    semanticSearchAdminQuery.mockResolvedValueOnce({
      data: {
        watchSearch: {
          results: [],
          hasMore: false,
          query: "jesus",
          searchMode: "watch-search",
          latencyMs: 4,
          nextOffset: 0,
        },
      },
    })

    await searchVideos("jesus", 20, 0, undefined, "en", {
      routeLanguageSlug: null,
    })

    expect(semanticSearchAdminQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          input: expect.objectContaining({
            displayLanguageSlug: "english",
            routeLanguageSlug: null,
          }),
        },
      }),
    )
  })

  it("maps returned Watch search results to the existing UI card shape", async () => {
    semanticSearchAdminQuery.mockResolvedValueOnce({
      data: {
        watchSearch: {
          results: [
            {
              type: "VIDEO",
              id: "video-1",
              slug: "jesus",
              title: "JESUS",
              imageUrl: "https://img.example/jesus.jpg",
              imageBlurDataUrl: null,
              muxThumbnailBlurDataUrl: null,
              snippet:
                "<b>Following Jesus</b> &amp; <b>Prayer</b><br />Talk to God.",
              playbackId: "playback-1",
              startSeconds: null,
              score: 0.97,
              label: "FEATURE_FILM",
              durationSeconds: 7200,
              childCount: 0,
              languageSlug: "spanish-castilian",
              languageEnglishName: "Spanish, Castilian",
              availability: {
                kind: "TARGET_AUDIO",
                languageEnglishName: "Spanish, Castilian",
              },
              evidence: {
                label: "Title match",
                languageSlug: "english",
              },
              action: {
                kind: "WATCH",
                hrefLanguageSlug: "spanish-castilian",
              },
              fallback: {
                kind: "NONE",
              },
            },
          ],
          hasMore: true,
          requestId: "watch_search_req_2",
          degraded: true,
          laneStatuses: [
            {
              lane: "semantic_retrieval",
              status: "degraded",
              elapsedMs: 19,
              resultCount: 1,
              reason: "partial_locale_failure",
            },
          ],
          query: "jesus",
          searchMode: "watch-search",
          latencyMs: 18,
          nextOffset: 20,
        },
      },
    })

    const data = await searchVideos("jesus")

    expect(data.results).toEqual([
      expect.objectContaining({
        type: "video",
        id: "video-1",
        slug: "jesus",
        title: "JESUS",
        snippet: "Following Jesus & Prayer Talk to God.",
        label: "FEATURE_FILM",
        source: "watch-search",
        languageSlug: "spanish-castilian",
        availabilityKind: "target_audio",
        availabilityLanguageEnglishName: "Spanish, Castilian",
        evidenceLabel: "Title match",
        evidenceLanguageSlug: "english",
      }),
    ])
    expect(data.hasMore).toBe(true)
    expect(data.nextOffset).toBe(20)
    expect(semanticSearchAdminQuery).toHaveBeenCalledTimes(1)
    expect(data).toMatchObject({
      requestId: "watch_search_req_2",
      degraded: true,
      laneStatuses: [
        {
          lane: "semantic_retrieval",
          status: "degraded",
          elapsedMs: 19,
          resultCount: 1,
          reason: "partial_locale_failure",
        },
      ],
    })
  })

  it("preserves the separately validated experience search contract", async () => {
    semanticSearchAdminQuery.mockResolvedValueOnce(
      watchSearchPage({
        query: "easter",
        results: [
          watchResult({
            type: "EXPERIENCE",
            id: "experience-1",
            slug: "easter",
            title: "Easter",
            playbackId: null,
            label: null,
            durationSeconds: null,
            availability: null,
            action: {
              kind: "OPEN_EXPERIENCE",
              hrefLanguageSlug: null,
            },
            fallback: null,
          }),
        ],
      }),
    )

    const data = await searchVideos("easter", 10, 0, "experience")

    expect(data.results).toEqual([
      expect.objectContaining({
        type: "experience",
        id: "experience-1",
        slug: "easter",
        title: "Easter",
      }),
    ])
    expect(semanticSearchAdminQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          input: expect.objectContaining({
            resultTypes: ["EXPERIENCE"],
          }),
        },
      }),
    )
  })

  it("hydrates missing video labels from the catalog slug", async () => {
    semanticSearchAdminQuery
      .mockResolvedValueOnce({
        data: {
          watchSearch: {
            results: [
              {
                type: "VIDEO",
                id: "video-collection",
                slug: "global-football-soccer-event",
                title: "Global Football Soccer Event",
                imageUrl: null,
                imageBlurDataUrl: null,
                muxThumbnailBlurDataUrl: null,
                snippet: "",
                playbackId: null,
                startSeconds: null,
                score: 0.9,
                label: null,
                durationSeconds: null,
                childCount: null,
                languageSlug: "english",
                languageEnglishName: "English",
                availability: {
                  kind: "TARGET_AUDIO",
                  languageEnglishName: "English",
                },
                evidence: null,
                action: {
                  kind: "WATCH",
                  hrefLanguageSlug: "english",
                },
                fallback: {
                  kind: "NONE",
                },
              },
            ],
            hasMore: false,
            query: "world cup",
            searchMode: "watch-search",
            latencyMs: 15,
            nextOffset: 0,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoBySlug: {
            label: "COLLECTION",
            children: [
              { child: { id: "child-1" } },
              { child: { id: "child-2" } },
            ],
          },
        },
      })

    const data = await searchVideos("world cup")

    expect(semanticSearchAdminQuery).toHaveBeenCalledTimes(2)
    expect(semanticSearchAdminQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        variables: { slug: "global-football-soccer-event" },
        fetchPolicy: "no-cache",
      }),
    )
    expect(data.results[0]).toMatchObject({
      slug: "global-football-soccer-event",
      label: "COLLECTION",
      childCount: 2,
    })
  })

  it("admits only supported action, availability, fallback, and public-route pairs", async () => {
    semanticSearchAdminQuery.mockResolvedValueOnce(
      watchSearchPage({
        results: [
          watchResult({
            id: "valid-underscore",
            slug: "valid_watch_slug",
          }),
          watchResult({
            id: "valid-related",
            slug: "related-language-film",
            availability: {
              kind: "RELATED_LANGUAGE",
              languageEnglishName: "Spanish, Castilian",
            },
            action: {
              kind: "WATCH",
              hrefLanguageSlug: "spanish-castilian",
            },
            fallback: {
              kind: "RELATED_LANGUAGE",
            },
          }),
          watchResult({ id: "missing-action", action: null }),
          watchResult({
            id: "unsupported-action",
            action: {
              kind: "OPEN_EXPERIENCE",
              hrefLanguageSlug: "english",
            },
          }),
          watchResult({
            id: "missing-action-language",
            action: {
              kind: "WATCH",
              hrefLanguageSlug: null,
            },
          }),
          watchResult({
            id: "regex-valid-non-public-language",
            action: {
              kind: "WATCH",
              hrefLanguageSlug: "non-existent",
            },
          }),
          watchResult({
            id: "unavailable",
            availability: {
              kind: "UNAVAILABLE",
              languageEnglishName: "English",
            },
            action: {
              kind: "WATCH",
              hrefLanguageSlug: "english",
            },
            fallback: {
              kind: "UNAVAILABLE",
            },
          }),
          watchResult({
            id: "subtitle-only",
            availability: {
              kind: "TARGET_SUBTITLE",
              languageEnglishName: "English",
            },
            fallback: {
              kind: "SUBTITLE",
            },
          }),
          watchResult({
            id: "contradictory-target-audio",
            fallback: {
              kind: "RELATED_LANGUAGE",
            },
          }),
          watchResult({
            id: "contradictory-related-language",
            availability: {
              kind: "RELATED_LANGUAGE",
              languageEnglishName: "English",
            },
            fallback: {
              kind: "NONE",
            },
          }),
          watchResult({
            id: "missing-availability",
            availability: null,
          }),
          watchResult({
            id: "missing-fallback",
            fallback: null,
          }),
          watchResult({
            id: "tumlukden-nura",
            slug: "tümlükden-nura",
            title: "Tümlükden Nura",
          }),
          watchResult({
            id: "la-busqueda",
            slug: "La_Busqueda_La Recherche",
            title: "La_Busqueda_La Recherche",
          }),
        ],
      }),
    )

    const data = await searchVideos("jesus")

    expect(data.results.map(({ id }) => id)).toEqual([
      "valid-underscore",
      "valid-related",
    ])
    expect(data.results).toEqual([
      expect.objectContaining({
        id: "valid-underscore",
        slug: "valid_watch_slug",
        languageSlug: "english",
        availabilityKind: "target_audio",
      }),
      expect.objectContaining({
        id: "valid-related",
        languageSlug: "spanish-castilian",
        availabilityKind: "related_language",
      }),
    ])
  })

  it("advances past a fully filtered page and returns the first admissible page with its metadata", async () => {
    semanticSearchAdminQuery
      .mockResolvedValueOnce(
        watchSearchPage({
          results: [
            watchResult({
              id: "invalid-first-page",
              slug: "Tümlükden Nura",
            }),
          ],
          hasMore: true,
          nextOffset: 20,
          requestId: "request-page-1",
          latencyMs: 8,
        }),
      )
      .mockResolvedValueOnce(
        watchSearchPage({
          results: [watchResult({ id: "valid-second-page" })],
          hasMore: true,
          nextOffset: 40,
          requestId: "request-page-2",
          latencyMs: 19,
        }),
      )

    const data = await searchVideos("jesus")

    expect(data.results.map(({ id }) => id)).toEqual(["valid-second-page"])
    expect(data).toMatchObject({
      hasMore: true,
      nextOffset: 40,
      requestId: "request-page-2",
      latencyMs: 19,
    })
    expect(
      semanticSearchAdminQuery.mock.calls.map(
        ([request]) => request.variables.input.offset,
      ),
    ).toEqual([0, 20])
  })

  it("stops after three filtered source pages and preserves the bounded final cursor", async () => {
    semanticSearchAdminQuery
      .mockResolvedValueOnce(
        watchSearchPage({
          results: [watchResult({ id: "invalid-1", action: null })],
          hasMore: true,
          nextOffset: 10,
          requestId: "request-page-1",
        }),
      )
      .mockResolvedValueOnce(
        watchSearchPage({
          results: [watchResult({ id: "invalid-2", availability: null })],
          hasMore: true,
          nextOffset: 20,
          requestId: "request-page-2",
        }),
      )
      .mockResolvedValueOnce(
        watchSearchPage({
          results: [watchResult({ id: "invalid-3", fallback: null })],
          hasMore: true,
          nextOffset: 30,
          requestId: "request-page-3",
          latencyMs: 31,
        }),
      )

    const data = await searchVideos("jesus")

    expect(data).toMatchObject({
      results: [],
      hasMore: true,
      nextOffset: 30,
      requestId: "request-page-3",
      latencyMs: 31,
    })
    expect(
      semanticSearchAdminQuery.mock.calls.map(
        ([request]) => request.variables.input.offset,
      ),
    ).toEqual([0, 10, 20])
  })

  it("does not repeat a non-increasing source cursor", async () => {
    semanticSearchAdminQuery.mockResolvedValueOnce(
      watchSearchPage({
        results: [watchResult({ action: null })],
        hasMore: true,
        nextOffset: 0,
      }),
    )

    const data = await searchVideos("jesus")

    expect(data).toMatchObject({
      results: [],
      hasMore: false,
      nextOffset: 0,
    })
    expect(semanticSearchAdminQuery).toHaveBeenCalledTimes(1)
  })
})
