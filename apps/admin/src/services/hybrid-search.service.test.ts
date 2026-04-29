/**
 * Orchestrator-level tests for HybridSearchService. Retrievers are
 * stubbed by mocking the module import; embedder is injected via the
 * constructor so tests can simulate success and failure independently.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./hybrid-search-retrievers", () => ({
  searchVideoSemantic: vi.fn(),
  searchVideoKeyword: vi.fn(),
  searchExperienceSemantic: vi.fn(),
  searchExperienceKeyword: vi.fn(),
}))

import {
  searchVideoSemantic,
  searchVideoKeyword,
  searchExperienceSemantic,
  searchExperienceKeyword,
} from "./hybrid-search-retrievers"
import { __resetSearchHealthForTest, getStats } from "./hybrid-search-health"
import {
  HybridSearchService,
  type QueryEmbedder,
} from "./hybrid-search.service"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = {} as any
const loggerError = vi.fn()
const loggerWarn = vi.fn()
const logger = { error: loggerError, warn: loggerWarn }

function successEmbedder(vector: number[] = [0.1, 0.2, 0.3]): QueryEmbedder {
  return vi.fn().mockResolvedValue(vector)
}

function failingEmbedder(error = new Error("provider down")): QueryEmbedder {
  return vi.fn().mockRejectedValue(error)
}

function setupDefaultRetrievers() {
  vi.mocked(searchVideoSemantic).mockResolvedValue([])
  vi.mocked(searchVideoKeyword).mockResolvedValue([])
  vi.mocked(searchExperienceSemantic).mockResolvedValue([])
  vi.mocked(searchExperienceKeyword).mockResolvedValue([])
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetSearchHealthForTest()
  setupDefaultRetrievers()
})

describe("HybridSearchService", () => {
  it("orchestrates embed → 4 retrieve → fuse → dedup → paginate on happy path", async () => {
    vi.mocked(searchVideoSemantic).mockResolvedValue([
      {
        resultType: "video",
        resultId: "vid-1",
        videoCoreId: "1_Jesus",
        videoSlug: "jesus",
        videoTitle: "Jesus",
        imageUrl: null,
        sceneDescription: "A scene about forgiveness",
        startSeconds: 42,
        playbackId: "mux-1",
        similarity: 0.9,
        embeddingText: "[0.1,0.2,0.3]",
      },
    ])
    vi.mocked(searchVideoKeyword).mockResolvedValue([
      {
        resultType: "video",
        resultId: "vid-2",
        videoCoreId: "2_Grace",
        videoSlug: "grace",
        videoTitle: "Grace",
        imageUrl: null,
        description: "Video about grace",
        rank: 0.5,
      },
    ])

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    const result = await service.search({
      query: "forgiveness",
      locale: "en",
    })

    // All 4 retrievers were invoked with overfetch = DEFAULT_LIMIT * 3 = 60
    expect(searchVideoSemantic).toHaveBeenCalledWith(mockPrisma, {
      queryEmbedding: "[0.1,0.2,0.3]",
      locale: "en",
      limit: 60,
    })
    expect(searchVideoKeyword).toHaveBeenCalledWith(mockPrisma, {
      query: "forgiveness",
      locale: "en",
      limit: 60,
    })
    expect(searchExperienceSemantic).toHaveBeenCalled()
    expect(searchExperienceKeyword).toHaveBeenCalled()

    expect(result.query).toBe("forgiveness")
    expect(result.searchMode).toBe("hybrid")
    expect(result.results).toHaveLength(2)
    // Semantic-video row comes first (higher RRF score — rank 1 in
    // semantic-video; keyword-video row was rank 1 in a different list).
    const first = result.results.find((r) => r.id === "vid-1")!
    expect(first).toMatchObject({
      type: "video",
      slug: "jesus",
      title: "Jesus",
      imageUrl: null,
      snippet: "A scene about forgiveness",
      startSeconds: 42,
      playbackId: "mux-1",
    })
  })

  it("degrades to keyword-only when embedder throws", async () => {
    vi.mocked(searchVideoKeyword).mockResolvedValue([
      {
        resultType: "video",
        resultId: "vid-2",
        videoCoreId: null,
        videoSlug: "grace",
        videoTitle: "Grace",
        imageUrl: null,
        description: "Video about grace",
        rank: 0.5,
      },
    ])

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: failingEmbedder(),
      logger,
    })

    const result = await service.search({ query: "grace", locale: "en" })

    expect(result.searchMode).toBe("keyword-only")
    expect(searchVideoSemantic).not.toHaveBeenCalled()
    expect(searchExperienceSemantic).not.toHaveBeenCalled()
    expect(searchVideoKeyword).toHaveBeenCalled()
    expect(searchExperienceKeyword).toHaveBeenCalled()

    // Counters updated
    const stats = getStats()
    expect(stats.attempts).toBe(1)
    expect(stats.failures).toBe(1)

    // Structured error log
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining("event=query_embedding_failure"),
    )
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining("error_class=Error"),
    )
  })

  it("restricts to video corpus when contentTypes=['video']", async () => {
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    await service.search({
      query: "test",
      locale: "en",
      contentTypes: ["video"],
    })

    expect(searchVideoSemantic).toHaveBeenCalled()
    expect(searchVideoKeyword).toHaveBeenCalled()
    expect(searchExperienceSemantic).not.toHaveBeenCalled()
    expect(searchExperienceKeyword).not.toHaveBeenCalled()
  })

  it("restricts to experience corpus when contentTypes=['experience']", async () => {
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    await service.search({
      query: "test",
      locale: "en",
      contentTypes: ["experience"],
    })

    expect(searchVideoSemantic).not.toHaveBeenCalled()
    expect(searchVideoKeyword).not.toHaveBeenCalled()
    expect(searchExperienceSemantic).toHaveBeenCalled()
    expect(searchExperienceKeyword).toHaveBeenCalled()
  })

  it("empty contentTypes falls back to both corpora", async () => {
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    await service.search({
      query: "test",
      locale: "en",
      contentTypes: [],
    })

    expect(searchVideoSemantic).toHaveBeenCalled()
    expect(searchExperienceSemantic).toHaveBeenCalled()
  })

  it("clamps limit to MAX_LIMIT (50)", async () => {
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    await service.search({ query: "test", locale: "en", limit: 100 })

    expect(searchVideoSemantic).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ limit: 150 }), // 50 * 3
    )
  })

  it("clamps limit minimum to 1", async () => {
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    await service.search({ query: "test", locale: "en", limit: -5 })

    expect(searchVideoSemantic).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ limit: 3 }), // 1 * 3
    )
  })

  it("sets hasMore when dedup returns more than offset + limit", async () => {
    // Produce 25 semantic-video rows; default limit 20, so the 21st row
    // plus beyond triggers hasMore.
    // IDs + coreIds are zero-padded + suffixed so neither layer 1
    // (coreId prefix) nor layer 2 (exact title) nor layer 3 (cosine
    // similarity) of dedup collapses them.
    const pad = (n: number) => String(n).padStart(3, "0")
    const many = Array.from({ length: 25 }, (_, i) => ({
      resultType: "video" as const,
      resultId: `vid-${pad(i)}`,
      videoCoreId: `core-${pad(i)}x`,
      videoSlug: `slug-${pad(i)}`,
      videoTitle: `Title ${pad(i)}`,
      imageUrl: null,
      sceneDescription: `desc ${pad(i)}`,
      startSeconds: i,
      playbackId: `mux-${pad(i)}`,
      similarity: 1 - i * 0.01,
      // Distinct-enough vectors so cosine similarity stays below 0.95.
      // Each row gets a unique unit vector along a distinct axis by
      // rotating through a long dim so no two rows ever collide.
      embeddingText: `[${Array.from({ length: 32 }, (_, j) => (j === i ? 1 : 0)).join(",")}]`,
    }))
    vi.mocked(searchVideoSemantic).mockResolvedValue(many)

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    const result = await service.search({ query: "test", locale: "en" })
    expect(result.results).toHaveLength(20)
    expect(result.hasMore).toBe(true)
  })

  it("unwraps allSettled — one rejected retrieval logs and returns []", async () => {
    vi.mocked(searchVideoKeyword).mockRejectedValue(
      new Error("boom keyword-video"),
    )
    vi.mocked(searchVideoSemantic).mockResolvedValue([
      {
        resultType: "video",
        resultId: "vid-1",
        videoCoreId: null,
        videoSlug: "a",
        videoTitle: "A",
        imageUrl: null,
        sceneDescription: "",
        startSeconds: 0,
        playbackId: null,
        similarity: 1,
        embeddingText: "[]",
      },
    ])

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    const result = await service.search({ query: "x", locale: "en" })

    // Still returns the semantic-video row; keyword-video was dropped.
    expect(result.results).toHaveLength(1)
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining("keyword-video retrieval failed"),
    )
  })

  it("rounds score to 3 decimal places", async () => {
    vi.mocked(searchVideoSemantic).mockResolvedValue([
      {
        resultType: "video",
        resultId: "vid-1",
        videoCoreId: null,
        videoSlug: "a",
        videoTitle: "A",
        imageUrl: null,
        sceneDescription: "",
        startSeconds: 0,
        playbackId: null,
        similarity: 1,
        embeddingText: "[]",
      },
    ])

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    const result = await service.search({ query: "x", locale: "en" })
    // With 1 non-empty list, fuseRankedLists normalises to 1.0 for the
    // sole rank-1 row → rounded to 1.
    expect(result.results[0]!.score).toBe(1)
  })

  it("maps experience rows with null startSeconds + playbackId", async () => {
    vi.mocked(searchExperienceSemantic).mockResolvedValue([
      {
        resultType: "experience",
        resultId: "exp-loc-1",
        experienceSlug: "easter",
        experienceTitle: "Easter",
        experienceMetaDescription: "The resurrection",
        imageUrl: null,
        similarity: 0.8,
      },
    ])

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger,
    })

    const result = await service.search({
      query: "easter",
      locale: "en",
      contentTypes: ["experience"],
    })

    const exp = result.results.find((r) => r.id === "exp-loc-1")!
    expect(exp).toMatchObject({
      type: "experience",
      slug: "easter",
      title: "Easter",
      snippet: "The resurrection",
      imageUrl: null,
      startSeconds: null,
      playbackId: null,
    })
  })
})
