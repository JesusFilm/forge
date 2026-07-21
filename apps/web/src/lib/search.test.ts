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

  it("calls the Admin Watch search GraphQL contract", async () => {
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
            displayLanguageSlug: "en",
            routeLanguageSlug: "en",
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

  it("keeps query truncation and offset semantics stable for callers", async () => {
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
            displayLanguageSlug: "es",
            routeLanguageSlug: "es",
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
})
