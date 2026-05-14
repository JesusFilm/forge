import { beforeEach, describe, expect, it, vi } from "vitest"

const searchMock = vi.hoisted(() => vi.fn())

vi.mock("@/services/hybrid-search.service", () => ({
  HybridSearchService: class {
    search = searchMock
  },
}))

vi.mock("@/db/client", () => ({
  prisma: {},
}))

describe("searchVideosTool", () => {
  beforeEach(() => {
    searchMock.mockReset()
    vi.resetModules()
  })

  it("calls HybridSearchService.search with the input query+locale+limit and returns trimmed videos", async () => {
    searchMock.mockResolvedValue({
      results: [
        {
          type: "video",
          id: "vid-1",
          slug: "jesus",
          title: "Jesus",
          imageUrl: "https://cdn/img.png",
          snippet: "About Jesus.",
          startSeconds: null,
          playbackId: null,
          score: 0.9,
        },
        {
          type: "experience",
          id: "exp-1",
          slug: "christmas",
          title: "Christmas",
          imageUrl: null,
          snippet: "Christmas page.",
          startSeconds: null,
          playbackId: null,
          score: 0.5,
        },
        {
          type: "video",
          id: "vid-2",
          slug: "easter",
          title: "Easter",
          imageUrl: null,
          snippet: "Easter video.",
          startSeconds: 0,
          playbackId: "pb-1",
          score: 0.8,
        },
      ],
      hasMore: false,
      query: "jesus",
      searchMode: "hybrid",
    })

    const { searchVideosTool } = await import("./search-videos")
    const result = await searchVideosTool.execute!(
      { q: "jesus", locale: "en", limit: 5 },
      undefined as never,
    )

    expect(searchMock).toHaveBeenCalledWith({
      query: "jesus",
      locale: "en",
      limit: 5,
      contentTypes: ["video"],
    })
    // Only `video` rows survive; experience row dropped.
    expect(result.videos).toEqual([
      {
        videoId: "vid-1",
        title: "Jesus",
        snippet: "About Jesus.",
        slug: "jesus",
        imageUrl: "https://cdn/img.png",
      },
      {
        videoId: "vid-2",
        title: "Easter",
        snippet: "Easter video.",
        slug: "easter",
        imageUrl: null,
      },
    ])
  })

  it("returns an empty array when the service returns no video results", async () => {
    searchMock.mockResolvedValue({
      results: [],
      hasMore: false,
      query: "nothing",
      searchMode: "hybrid",
    })
    const { searchVideosTool } = await import("./search-videos")
    const result = await searchVideosTool.execute!(
      { q: "nothing", locale: "en", limit: 8 },
      undefined as never,
    )
    expect(result.videos).toEqual([])
  })

  it("propagates a service error (the agent surfaces it in its assistant message)", async () => {
    searchMock.mockRejectedValue(new Error("DB unreachable"))
    const { searchVideosTool } = await import("./search-videos")
    await expect(
      searchVideosTool.execute!(
        { q: "x", locale: "en", limit: 8 },
        undefined as never,
      ),
    ).rejects.toThrow(/DB unreachable/)
  })

  it("rejects invalid input via Zod (empty query)", async () => {
    const { searchVideosTool } = await import("./search-videos")
    const parseResult = searchVideosTool.inputSchema!.safeParse({
      q: "",
      locale: "en",
    })
    expect(parseResult.success).toBe(false)
  })

  it("defaults limit to 8 when not provided", async () => {
    const { searchVideosTool } = await import("./search-videos")
    const parsed = searchVideosTool.inputSchema!.parse({
      q: "hope",
      locale: "en",
    })
    expect(parsed.limit).toBe(8)
  })
})
