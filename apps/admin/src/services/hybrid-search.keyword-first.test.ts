/**
 * Orchestrator-level tests for the `mode="keyword-first"` branch.
 *
 * Verifies that:
 *   1. The hybrid path is left UNTOUCHED — `searchVideoKeyword` (R4) is
 *      called, the three keyword-first retrievers are NOT.
 *   2. The keyword-first path swaps `searchVideoKeyword` for the three
 *      new retrievers (semantic-video stays shared between both modes).
 *   3. Empty-list filtering before fusion is preserved.
 *   4. Per-retriever failures via `Promise.allSettled` keep the rest
 *      of the response intact.
 *
 * Real-DB integration tests (Bible Project headline against seeded
 * data, EXPLAIN-based GIN verification) are deferred to R0 readiness,
 * same posture as R4 + R5.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./hybrid-search-retrievers", () => ({
  searchVideoSemantic: vi.fn(),
  searchVideoKeyword: vi.fn(),
  searchExperienceSemantic: vi.fn(),
  searchExperienceKeyword: vi.fn(),
}))

vi.mock("./hybrid-search-keyword-first-retrievers", () => ({
  searchByKeywordWeighted: vi.fn(),
  searchByTrigram: vi.fn(),
  searchByExactTitle: vi.fn(),
  MAX_EXACT_TITLE_TOKENS: 16,
  tokenizeForExactTitle: (q: string) => q.toLowerCase().split(/\s+/),
}))

import {
  searchVideoSemantic,
  searchVideoKeyword,
  searchExperienceSemantic,
  searchExperienceKeyword,
} from "./hybrid-search-retrievers"
import {
  searchByKeywordWeighted,
  searchByTrigram,
  searchByExactTitle,
} from "./hybrid-search-keyword-first-retrievers"
import { __resetSearchHealthForTest } from "./hybrid-search-health"
import {
  HybridSearchService,
  type QueryEmbedder,
} from "./hybrid-search.service"

const mockPrisma = {
  video: {
    // Default to empty hydration so card-pill enrichment (post-fusion
    // `prisma.video.findMany`) doesn't crash these tests.
    findMany: vi.fn().mockResolvedValue([]),
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const successEmbedder = (): QueryEmbedder =>
  vi.fn().mockResolvedValue([0.1, 0.2, 0.3])

function setupAllRetrieversEmpty() {
  vi.mocked(searchVideoSemantic).mockResolvedValue([])
  vi.mocked(searchVideoKeyword).mockResolvedValue([])
  vi.mocked(searchExperienceSemantic).mockResolvedValue([])
  vi.mocked(searchExperienceKeyword).mockResolvedValue([])
  vi.mocked(searchByKeywordWeighted).mockResolvedValue([])
  vi.mocked(searchByTrigram).mockResolvedValue([])
  vi.mocked(searchByExactTitle).mockResolvedValue([])
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetSearchHealthForTest()
  setupAllRetrieversEmpty()
  // Restore default hydration stub after clearAllMocks wipes it.
  mockPrisma.video.findMany.mockResolvedValue([])
})

describe("HybridSearchService keyword-first branch", () => {
  it("dispatches the three lexical retrievers when mode='keyword-first'", async () => {
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    await service.search({
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
    })

    expect(searchByKeywordWeighted).toHaveBeenCalledWith(mockPrisma, {
      query: "the bible project",
      locale: "en",
      limit: 60,
    })
    expect(searchByTrigram).toHaveBeenCalledWith(mockPrisma, {
      query: "the bible project",
      locale: "en",
      limit: 60,
    })
    expect(searchByExactTitle).toHaveBeenCalledWith(mockPrisma, {
      query: "the bible project",
      locale: "en",
      limit: 60,
    })
  })

  it("does NOT dispatch the legacy R4 video keyword retriever in keyword-first mode", async () => {
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    await service.search({
      query: "jesus",
      locale: "en",
      mode: "keyword-first",
    })

    expect(searchVideoKeyword).not.toHaveBeenCalled()
  })

  it("still shares semantic-video and both experience retrievers across modes", async () => {
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    await service.search({
      query: "jesus",
      locale: "en",
      mode: "keyword-first",
    })

    expect(searchVideoSemantic).toHaveBeenCalled()
    expect(searchExperienceSemantic).toHaveBeenCalled()
    expect(searchExperienceKeyword).toHaveBeenCalled()
  })

  it("hybrid mode untouched — calls R4 retrievers, NOT keyword-first ones", async () => {
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    await service.search({
      query: "jesus",
      locale: "en",
      mode: "hybrid",
    })

    expect(searchVideoKeyword).toHaveBeenCalledTimes(1)
    expect(searchByKeywordWeighted).not.toHaveBeenCalled()
    expect(searchByTrigram).not.toHaveBeenCalled()
    expect(searchByExactTitle).not.toHaveBeenCalled()
  })

  it("isolates per-retriever failures via Promise.allSettled (one rejected list = empty list, response still returns)", async () => {
    const loggerError = vi.fn()
    vi.mocked(searchByTrigram).mockRejectedValue(new Error("boom trigram"))
    vi.mocked(searchByKeywordWeighted).mockResolvedValue([
      {
        resultType: "video",
        resultId: "vid-1",
        videoCoreId: null,
        videoSlug: "a",
        videoTitle: "A",
        imageUrl: null,
        description: "kw weighted survivor",
        rank: 0.7,
      },
    ])

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn: vi.fn(), error: loggerError },
    })

    const result = await service.search({
      query: "jesus",
      locale: "en",
      mode: "keyword-first",
    })

    expect(result.results).toHaveLength(1)
    expect(result.results[0]!.id).toBe("vid-1")
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining("trigram-video retrieval failed"),
    )
  })

  it("video-only contentTypes still routes through the keyword-first stack (no experience dispatch)", async () => {
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    await service.search({
      query: "jesus",
      locale: "en",
      mode: "keyword-first",
      contentTypes: ["video"],
    })

    expect(searchByKeywordWeighted).toHaveBeenCalled()
    expect(searchByTrigram).toHaveBeenCalled()
    expect(searchByExactTitle).toHaveBeenCalled()
    expect(searchExperienceSemantic).not.toHaveBeenCalled()
    expect(searchExperienceKeyword).not.toHaveBeenCalled()
  })

  it("preserves the searchMode='hybrid'/'keyword-only' degradation signal independently of input mode", async () => {
    const failingEmbedder: QueryEmbedder = vi
      .fn()
      .mockRejectedValue(new Error("provider down"))
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: failingEmbedder,
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    const result = await service.search({
      query: "jesus",
      locale: "en",
      mode: "keyword-first",
    })

    expect(result.searchMode).toBe("keyword-only")
    // Semantic-video is gated behind embedding success — same as hybrid.
    expect(searchVideoSemantic).not.toHaveBeenCalled()
    // The three lexical retrievers DO run regardless (they don't need
    // an embedding).
    expect(searchByKeywordWeighted).toHaveBeenCalled()
    expect(searchByTrigram).toHaveBeenCalled()
    expect(searchByExactTitle).toHaveBeenCalled()
  })

  it("dispatches semantic retrievers only when semantic-only is enabled for internal eval", async () => {
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    await service.search({
      query: "jesus",
      locale: "en",
      mode: "semantic-only",
      allowInternalEvalModes: true,
    })

    expect(searchVideoSemantic).toHaveBeenCalledWith(mockPrisma, {
      queryEmbedding: "[0.1,0.2,0.3]",
      locale: "en",
      limit: 60,
    })
    expect(searchExperienceSemantic).toHaveBeenCalledWith(mockPrisma, {
      queryEmbedding: "[0.1,0.2,0.3]",
      locale: "en",
      limit: 60,
    })
    expect(searchVideoKeyword).not.toHaveBeenCalled()
    expect(searchExperienceKeyword).not.toHaveBeenCalled()
    expect(searchByKeywordWeighted).not.toHaveBeenCalled()
    expect(searchByTrigram).not.toHaveBeenCalled()
    expect(searchByExactTitle).not.toHaveBeenCalled()
  })

  it("keeps semantic-only internal and falls back to hybrid without the eval flag", async () => {
    const warn = vi.fn()
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn, error: vi.fn() },
    })

    await service.search({
      query: "jesus",
      locale: "en",
      mode: "semantic-only",
    })

    expect(searchVideoKeyword).toHaveBeenCalled()
    expect(searchExperienceKeyword).toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("semantic-only"))
  })

  it("semantic-only video content type skips experience retrievers", async () => {
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    await service.search({
      query: "jesus",
      locale: "en",
      mode: "semantic-only",
      allowInternalEvalModes: true,
      contentTypes: ["video"],
    })

    expect(searchVideoSemantic).toHaveBeenCalled()
    expect(searchExperienceSemantic).not.toHaveBeenCalled()
    expect(searchExperienceKeyword).not.toHaveBeenCalled()
    expect(searchVideoKeyword).not.toHaveBeenCalled()
    expect(searchByKeywordWeighted).not.toHaveBeenCalled()
    expect(searchByTrigram).not.toHaveBeenCalled()
    expect(searchByExactTitle).not.toHaveBeenCalled()
  })

  it("semantic-only embedding failure returns an empty degraded response without lexical fallback", async () => {
    const failingEmbedder: QueryEmbedder = vi
      .fn()
      .mockRejectedValue(new Error("provider down"))
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: failingEmbedder,
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    const result = await service.search({
      query: "jesus",
      locale: "en",
      mode: "semantic-only",
      allowInternalEvalModes: true,
    })

    expect(result).toMatchObject({
      results: [],
      hasMore: false,
      query: "jesus",
      searchMode: "keyword-only",
    })
    expect(searchVideoSemantic).not.toHaveBeenCalled()
    expect(searchExperienceSemantic).not.toHaveBeenCalled()
    expect(searchVideoKeyword).not.toHaveBeenCalled()
    expect(searchExperienceKeyword).not.toHaveBeenCalled()
    expect(searchByKeywordWeighted).not.toHaveBeenCalled()
    expect(searchByTrigram).not.toHaveBeenCalled()
    expect(searchByExactTitle).not.toHaveBeenCalled()
  })
})
