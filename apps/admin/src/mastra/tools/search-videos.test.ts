import { beforeEach, describe, expect, it, vi } from "vitest"

// Tool execute() returns the success type or a ValidationError. Tests pass valid
// inputs, so we narrow to the success shape by excluding the error variant.
function assertOk<T>(value: T): Exclude<T, { error: unknown }> {
  if (typeof value === "object" && value !== null && "error" in value) {
    throw new Error("tool returned a ValidationError instead of a result")
  }
  return value as Exclude<T, { error: unknown }>
}

const searchMock = vi.hoisted(() => vi.fn())

// AI_VIDEO_SEARCH_EMBEDDING_SOURCE controls which embedding source the tool
// passes; defaults to "openrouter". Tests flip it to exercise both paths.
const mockEnv = vi.hoisted(() => ({
  env: {
    AI_VIDEO_SEARCH_EMBEDDING_SOURCE: "openrouter" as "openrouter" | "gateway",
  },
}))

vi.mock("@/config/env", () => mockEnv)

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
    mockEnv.env.AI_VIDEO_SEARCH_EMBEDDING_SOURCE = "openrouter"
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
    const result = assertOk(
      await searchVideosTool.execute!(
        { q: "jesus", locale: "en", limit: 5 },
        undefined as never,
      ),
    )

    expect(searchMock).toHaveBeenCalledWith({
      query: "jesus",
      locale: "en",
      limit: 5,
      contentTypes: ["video"],
      // Default flag → OpenRouter source.
      embeddingSource: "openrouter",
    })
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

  it("passes embeddingSource=gateway when AI_VIDEO_SEARCH_EMBEDDING_SOURCE is set", async () => {
    mockEnv.env.AI_VIDEO_SEARCH_EMBEDDING_SOURCE = "gateway"
    searchMock.mockResolvedValue({
      results: [],
      hasMore: false,
      query: "jesus",
      searchMode: "hybrid",
    })
    const { searchVideosTool } = await import("./search-videos")
    await searchVideosTool.execute!(
      { q: "jesus", locale: "en", limit: 5 },
      undefined as never,
    )
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ embeddingSource: "gateway" }),
    )
  })

  it("returns an empty array when the service returns no video results", async () => {
    searchMock.mockResolvedValue({
      results: [],
      hasMore: false,
      query: "nothing",
      searchMode: "hybrid",
    })
    const { searchVideosTool } = await import("./search-videos")
    const result = assertOk(
      await searchVideosTool.execute!(
        { q: "nothing", locale: "en", limit: 8 },
        undefined as never,
      ),
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
    const { searchVideosInputSchema } = await import("./search-videos")
    const parseResult = searchVideosInputSchema.safeParse({
      q: "",
      locale: "en",
    })
    expect(parseResult.success).toBe(false)
  })

  it("defaults limit to 8 when not provided", async () => {
    const { searchVideosInputSchema } = await import("./search-videos")
    const parsed = searchVideosInputSchema.parse({ q: "hope", locale: "en" })
    expect(parsed.limit).toBe(8)
  })
})
