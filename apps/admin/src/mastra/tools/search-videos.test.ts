import { beforeEach, describe, expect, it, vi } from "vitest"

// Tool execute() returns the success type or a ValidationError. Tests pass valid
// inputs, so we narrow to the success shape by excluding the error variant.
// We also exclude `void`: Mastra's createTool types execute's return as
// `T | void`, and once the admin program's total type-instantiation load is
// high the checker keeps the `void` arm instead of resolving to T. Excluding
// it here (with a runtime null-guard) keeps these tests robust to that budget.
function assertOk<T>(value: T): Exclude<T, { error: unknown } | void> {
  if (value == null) {
    throw new Error("tool returned no result")
  }
  if (typeof value === "object" && "error" in value) {
    throw new Error("tool returned a ValidationError instead of a result")
  }
  return value as Exclude<T, { error: unknown } | void>
}

const searchMock = vi.hoisted(() => vi.fn())
const languageFindFirstMock = vi.hoisted(() => vi.fn())

vi.mock("@/services/watch-search.service", () => ({
  WatchSearchService: class {
    search = searchMock
  },
}))

vi.mock("@/db/client", () => ({
  prisma: {
    language: {
      findFirst: languageFindFirstMock,
    },
  },
}))

describe("searchVideosTool", () => {
  beforeEach(() => {
    searchMock.mockReset()
    languageFindFirstMock.mockReset()
    languageFindFirstMock.mockResolvedValue({ slug: "english" })
    vi.resetModules()
  })

  it("calls WatchSearchService.search with the input query+locale+limit and returns trimmed playable videos, dropping playbackId-null rows", async () => {
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
      searchMode: "watch-search",
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
      targetLanguageSlug: "english",
      displayLanguageSlug: "english",
      routeLanguageSlug: "english",
      acceptLanguage: "en",
      limit: 5,
      resultTypes: ["video"],
    })
    // vid-1 has playbackId null (no playable dub in the locale) — agents
    // write returned videoIds into blocks verbatim, so it must be dropped.
    expect(result.videos).toEqual([
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
      searchMode: "watch-search",
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
