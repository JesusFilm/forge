import { print } from "graphql"
import { afterEach, describe, expect, it, vi } from "vitest"

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}))

vi.mock("@/lib/client", () => ({
  default: {
    query: queryMock,
  },
}))

describe("searchVideos", () => {
  afterEach(() => {
    queryMock.mockReset()
    vi.resetModules()
  })

  it("dispatches admin search and maps results to the existing lower-case client shape", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        semanticSearch: {
          query: "Jesus",
          hasMore: false,
          searchMode: "HYBRID",
          results: [
            {
              type: "VIDEO",
              id: "video-1",
              slug: "jesus",
              title: "JESUS",
              imageUrl: "https://cdn.example/jesus.jpg",
              snippet: "The story of Jesus",
              startSeconds: 12,
              playbackId: "mux-1",
              score: 0.91,
            },
          ],
        },
      },
    })

    const { SEMANTIC_SEARCH, searchVideos } = await import("./search")

    const result = await searchVideos("Jesus", 8, 0, "video")

    const query = queryMock.mock.calls[0][0].query

    expect(print(SEMANTIC_SEARCH)).toContain("semanticSearch: search")
    expect(print(query)).toContain("semanticSearch: search")
    expect(print(query)).toContain("q: $query")
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query,
        variables: {
          query: "Jesus",
          locale: "en",
          limit: 8,
          offset: 0,
          type: "VIDEO",
        },
        fetchPolicy: "no-cache",
      }),
    )
    expect(result.results).toEqual([
      expect.objectContaining({
        type: "video",
        id: "video-1",
        title: "JESUS",
      }),
    ])
    expect(result.searchMode).toBe("hybrid")
  })

  it("returns an empty result set when admin search has no hits", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        semanticSearch: {
          query: "missing",
          hasMore: false,
          searchMode: "KEYWORD_ONLY",
          results: [],
        },
      },
    })

    const { searchVideos } = await import("./search")

    await expect(searchVideos("missing")).resolves.toMatchObject({
      results: [],
      hasMore: false,
      query: "missing",
      searchMode: "keyword-only",
    })
  })
})
