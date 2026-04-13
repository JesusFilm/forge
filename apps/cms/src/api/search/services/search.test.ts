import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../lib/openrouter", () => ({
  embedQuery: vi.fn(),
}))

vi.mock("./semantic-search", () => ({
  searchBySemantic: vi.fn(),
}))

vi.mock("./keyword-search", () => ({
  searchByKeyword: vi.fn(),
}))

vi.mock("./fusion", () => ({
  fuseRankedLists: vi.fn(),
  deduplicateResults: vi.fn(),
}))

import { embedQuery } from "../../../lib/openrouter"
import { searchBySemantic } from "./semantic-search"
import { searchByKeyword } from "./keyword-search"
import { fuseRankedLists, deduplicateResults } from "./fusion"
import { search } from "./search"

const mockKnex = {}
const mockStrapi = {
  db: { connection: mockKnex },
  log: { warn: vi.fn(), error: vi.fn() },
} as unknown as Parameters<typeof search>[0]

beforeEach(() => {
  vi.clearAllMocks()
})

describe("search", () => {
  it("orchestrates embed → retrieve → fuse → dedup → paginate", async () => {
    const queryVector = [0.1, 0.2, 0.3]

    vi.mocked(embedQuery).mockResolvedValue(queryVector)
    vi.mocked(searchBySemantic).mockResolvedValue([
      {
        videoId: 1,
        videoSlug: "video-one",
        videoTitle: "Video One",
        videoCoreId: "core1",
        imageUrl: "https://img/1.jpg",
        sceneIndex: 0,
        description: "A scene about forgiveness",
        startSeconds: 45,
        playbackId: "mux1",
        similarity: 0.9,
        embeddingText: "[0.1,0.2,0.3]",
      },
    ])
    vi.mocked(searchByKeyword).mockResolvedValue([
      {
        videoId: 2,
        videoSlug: "video-two",
        videoTitle: "Video Two",
        videoCoreId: "core2",
        imageUrl: "https://img/2.jpg",
        description: "A video about grace",
        rank: 0.5,
      },
    ])
    vi.mocked(fuseRankedLists).mockReturnValue([
      {
        videoId: 1,
        videoSlug: "video-one",
        videoTitle: "Video One",
        videoCoreId: "core1",
        imageUrl: "https://img/1.jpg",
        description: "A scene about forgiveness",
        startSeconds: 45,
        playbackId: "mux1",
        embeddingText: "[0.1,0.2,0.3]",
        score: 0.95,
      },
      {
        videoId: 2,
        videoSlug: "video-two",
        videoTitle: "Video Two",
        videoCoreId: "core2",
        imageUrl: "https://img/2.jpg",
        description: "A video about grace",
        score: 0.4,
      },
    ])
    vi.mocked(deduplicateResults).mockReturnValue([
      {
        videoId: 1,
        videoSlug: "video-one",
        videoTitle: "Video One",
        videoCoreId: "core1",
        imageUrl: "https://img/1.jpg",
        description: "A scene about forgiveness",
        startSeconds: 45,
        playbackId: "mux1",
        embeddingText: "[0.1,0.2,0.3]",
        score: 0.95,
      },
      {
        videoId: 2,
        videoSlug: "video-two",
        videoTitle: "Video Two",
        videoCoreId: "core2",
        imageUrl: "https://img/2.jpg",
        description: "A video about grace",
        score: 0.4,
      },
    ])

    const result = await search(mockStrapi, {
      query: "forgiveness",
      locale: "en",
    })

    // Verify embedding was generated
    expect(embedQuery).toHaveBeenCalledWith("forgiveness")

    // Verify both retrievals were called with overfetch (20 * 3 = 60)
    expect(searchBySemantic).toHaveBeenCalledWith(mockKnex, {
      queryEmbedding: "[0.1,0.2,0.3]",
      locale: "en",
      limit: 60,
    })
    expect(searchByKeyword).toHaveBeenCalledWith(mockKnex, {
      query: "forgiveness",
      locale: "en",
      limit: 60,
    })

    // Verify fusion was called with both result lists
    expect(fuseRankedLists).toHaveBeenCalledWith(
      [expect.any(Array), expect.any(Array)],
      60,
    )

    // Verify dedup was called with offset + limit + 1 (extra for hasMore)
    expect(deduplicateResults).toHaveBeenCalledWith(expect.any(Array), 21)

    // Verify response shape
    expect(result.query).toBe("forgiveness")
    expect(result.hasMore).toBe(false)
    expect(result.results).toHaveLength(2)
    expect(result.results[0]).toEqual({
      type: "video",
      id: 1,
      slug: "video-one",
      title: "Video One",
      imageUrl: "https://img/1.jpg",
      snippet: "A scene about forgiveness",
      startSeconds: 45,
      playbackId: "mux1",
      score: 0.95,
    })
  })

  it("clamps limit to MAX_LIMIT (50)", async () => {
    vi.mocked(embedQuery).mockResolvedValue([0.1])
    vi.mocked(searchBySemantic).mockResolvedValue([])
    vi.mocked(searchByKeyword).mockResolvedValue([])
    vi.mocked(fuseRankedLists).mockReturnValue([])
    vi.mocked(deduplicateResults).mockReturnValue([])

    await search(mockStrapi, {
      query: "test",
      locale: "en",
      limit: 100,
    })

    // Overfetch: min(100, 50) * 3 = 150
    expect(searchBySemantic).toHaveBeenCalledWith(
      mockKnex,
      expect.objectContaining({ limit: 150 }),
    )
  })

  it("clamps limit minimum to 1", async () => {
    vi.mocked(embedQuery).mockResolvedValue([0.1])
    vi.mocked(searchBySemantic).mockResolvedValue([])
    vi.mocked(searchByKeyword).mockResolvedValue([])
    vi.mocked(fuseRankedLists).mockReturnValue([])
    vi.mocked(deduplicateResults).mockReturnValue([])

    await search(mockStrapi, {
      query: "test",
      locale: "en",
      limit: -5,
    })

    // Overfetch: max(-5, 1) * 3 = 3
    expect(searchBySemantic).toHaveBeenCalledWith(
      mockKnex,
      expect.objectContaining({ limit: 3 }),
    )
  })

  it("applies offset for pagination", async () => {
    vi.mocked(embedQuery).mockResolvedValue([0.1])
    vi.mocked(searchBySemantic).mockResolvedValue([])
    vi.mocked(searchByKeyword).mockResolvedValue([])
    vi.mocked(fuseRankedLists).mockReturnValue([])
    vi.mocked(deduplicateResults).mockReturnValue([
      {
        videoId: 1,
        videoTitle: "A",
        videoCoreId: null,
        score: 0.9,
      },
      {
        videoId: 2,
        videoTitle: "B",
        videoCoreId: null,
        score: 0.8,
      },
      {
        videoId: 3,
        videoTitle: "C",
        videoCoreId: null,
        score: 0.7,
      },
    ])

    const result = await search(mockStrapi, {
      query: "test",
      locale: "en",
      limit: 2,
      offset: 1,
    })

    // Dedup should request offset + limit + 1 = 4 (extra for hasMore)
    expect(deduplicateResults).toHaveBeenCalledWith(expect.any(Array), 4)

    // Should return items starting at offset
    expect(result.results).toHaveLength(2)
    expect(result.results[0]!.id).toBe(2)
    expect(result.results[1]!.id).toBe(3)
    // deduped had 3 items, offset+limit=3, so no more results
    expect(result.hasMore).toBe(false)
  })

  it("sets hasMore when dedup returns more than offset + limit", async () => {
    vi.mocked(embedQuery).mockResolvedValue([0.1])
    vi.mocked(searchBySemantic).mockResolvedValue([])
    vi.mocked(searchByKeyword).mockResolvedValue([])
    vi.mocked(fuseRankedLists).mockReturnValue([])
    // Dedup returns 3 items when we asked for offset+limit+1 = 3 (limit=2, offset=0)
    // Actually the dedup limit is 3, so if it returns exactly 3 we know there's more
    vi.mocked(deduplicateResults).mockReturnValue([
      { videoId: 1, videoTitle: "A", videoCoreId: null, score: 0.9 },
      { videoId: 2, videoTitle: "B", videoCoreId: null, score: 0.8 },
      { videoId: 3, videoTitle: "C", videoCoreId: null, score: 0.7 },
    ])

    const result = await search(mockStrapi, {
      query: "test",
      locale: "en",
      limit: 2,
      offset: 0,
    })

    expect(result.results).toHaveLength(2)
    expect(result.hasMore).toBe(true)
  })

  it("returns empty results when both retrievals return nothing", async () => {
    vi.mocked(embedQuery).mockResolvedValue([0.1])
    vi.mocked(searchBySemantic).mockResolvedValue([])
    vi.mocked(searchByKeyword).mockResolvedValue([])
    vi.mocked(fuseRankedLists).mockReturnValue([])
    vi.mocked(deduplicateResults).mockReturnValue([])

    const result = await search(mockStrapi, {
      query: "nonexistent",
      locale: "en",
    })

    expect(result.results).toEqual([])
    expect(result.hasMore).toBe(false)
    expect(result.query).toBe("nonexistent")
  })

  it("degrades to keyword-only when embedQuery fails", async () => {
    vi.mocked(embedQuery).mockRejectedValue(
      new Error("OPENROUTER_API_KEY is not set"),
    )
    vi.mocked(searchByKeyword).mockResolvedValue([
      {
        videoId: 10,
        videoSlug: "found",
        videoTitle: "Found",
        videoCoreId: null,
        imageUrl: null,
        description: "matched via keyword",
        rank: 0.5,
      },
    ])
    vi.mocked(fuseRankedLists).mockReturnValue([
      {
        videoId: 10,
        videoSlug: "found",
        videoTitle: "Found",
        videoCoreId: null,
        imageUrl: null,
        description: "matched via keyword",
        score: 0.3,
      },
    ])
    vi.mocked(deduplicateResults).mockReturnValue([
      {
        videoId: 10,
        videoSlug: "found",
        videoTitle: "Found",
        videoCoreId: null,
        imageUrl: null,
        description: "matched via keyword",
        score: 0.3,
      },
    ])

    const result = await search(mockStrapi, { query: "test", locale: "en" })

    // Keyword search still ran
    expect(searchByKeyword).toHaveBeenCalled()
    // Semantic search was skipped (no embedding available)
    expect(searchBySemantic).not.toHaveBeenCalled()
    // Results still returned
    expect(result.results).toHaveLength(1)
    expect(result.results[0]!.id).toBe(10)
  })

  it("preserves keyword results when semantic retrieval fails", async () => {
    vi.mocked(embedQuery).mockResolvedValue([0.1])
    vi.mocked(searchBySemantic).mockRejectedValue(new Error("pgvector timeout"))
    vi.mocked(searchByKeyword).mockResolvedValue([
      {
        videoId: 20,
        videoSlug: "keyword-only",
        videoTitle: "Keyword Only",
        videoCoreId: null,
        imageUrl: null,
        description: "text match",
        rank: 0.4,
      },
    ])
    vi.mocked(fuseRankedLists).mockReturnValue([
      {
        videoId: 20,
        videoSlug: "keyword-only",
        videoTitle: "Keyword Only",
        videoCoreId: null,
        imageUrl: null,
        description: "text match",
        score: 0.2,
      },
    ])
    vi.mocked(deduplicateResults).mockReturnValue([
      {
        videoId: 20,
        videoSlug: "keyword-only",
        videoTitle: "Keyword Only",
        videoCoreId: null,
        imageUrl: null,
        description: "text match",
        score: 0.2,
      },
    ])

    const result = await search(mockStrapi, { query: "test", locale: "en" })

    // Partial failure should not propagate — keyword results survive
    expect(result.results).toHaveLength(1)
    expect(result.results[0]!.id).toBe(20)
  })

  it("maps keyword-only results with null startSeconds and playbackId", async () => {
    vi.mocked(embedQuery).mockResolvedValue([0.1])
    vi.mocked(searchBySemantic).mockResolvedValue([])
    vi.mocked(searchByKeyword).mockResolvedValue([])
    vi.mocked(fuseRankedLists).mockReturnValue([])
    // A keyword-only result has no startSeconds or playbackId
    vi.mocked(deduplicateResults).mockReturnValue([
      {
        videoId: 30,
        videoSlug: "keyword-video",
        videoTitle: "Keyword Video",
        videoCoreId: null,
        imageUrl: null,
        description: "video description",
        score: 0.5,
      },
    ])

    const result = await search(mockStrapi, { query: "test", locale: "en" })

    // Null signals "no scene-level match" — client must handle missing data
    expect(result.results[0]!.startSeconds).toBeNull()
    expect(result.results[0]!.playbackId).toBeNull()
  })
})
