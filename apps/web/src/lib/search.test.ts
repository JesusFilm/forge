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
                hrefLanguageSlug: "spanish-castilian",
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

  it("uses watchSearch card fields without a catalog fallback query", async () => {
    semanticSearchAdminQuery.mockResolvedValueOnce({
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
              label: "COLLECTION",
              durationSeconds: null,
              childCount: 2,
              languageSlug: "english",
              languageEnglishName: "English",
              availability: null,
              evidence: null,
              action: {
                hrefLanguageSlug: "english",
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

    const data = await searchVideos("world cup")

    expect(semanticSearchAdminQuery).toHaveBeenCalledTimes(1)
    expect(data.results[0]).toMatchObject({
      slug: "global-football-soccer-event",
      label: "COLLECTION",
      childCount: 2,
    })
  })

  it("keeps subtitle availability separate from the playable audio action", async () => {
    semanticSearchAdminQuery.mockResolvedValueOnce({
      data: {
        watchSearch: {
          results: [
            {
              type: "VIDEO",
              id: "video-perfect-2",
              slug: "perfect-2",
              title: "Perfect?",
              imageUrl: null,
              imageBlurDataUrl: null,
              muxThumbnailBlurDataUrl: null,
              snippet: "Russian subtitle match",
              playbackId: "playback-en",
              startSeconds: null,
              score: 0.8,
              label: "COLLECTION",
              durationSeconds: 120,
              childCount: 1,
              languageSlug: "russian",
              languageEnglishName: "Russian",
              availability: {
                kind: "TARGET_SUBTITLE",
                languageSlug: "russian",
                languageEnglishName: "Russian",
              },
              evidence: null,
              action: { hrefLanguageSlug: "english" },
            },
          ],
          hasMore: false,
          query: "мария",
          searchMode: "watch-search",
          latencyMs: 12,
          nextOffset: 0,
        },
      },
    })

    const data = await searchVideos("мария")

    expect(data.results[0]).toMatchObject({
      languageSlug: "english",
      languageEnglishName: null,
      availabilityKind: "target_subtitle",
      subtitleLanguageSlug: "russian",
      availabilityLanguageEnglishName: "Russian",
    })
  })
})
