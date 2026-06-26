/**
 * Orchestrator-level tests for the `mode="keyword-first"` branch.
 *
 * Verifies that:
 *   1. The hybrid path is left UNTOUCHED — `searchVideoKeyword` (R4) is
 *      called, the three keyword-first retrievers are NOT.
 *   2. The keyword-first path swaps `searchVideoKeyword` for the three
 *      new retrievers (semantic-video stays shared between both modes).
 *   3. Keyword-first lexical retrievers start while embedding is pending.
 *   4. Empty-list filtering before fusion is preserved.
 *   5. Per-retriever failures via `Promise.allSettled` keep the rest
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

vi.mock("./hybrid-search-keyword-first-retrievers", () => {
  const searchByKeywordWeighted = vi.fn()
  const searchByTrigram = vi.fn()
  const searchByExactTitle = vi.fn()
  const searchKeywordFirstVideoLexical = vi.fn(
    async (prisma: unknown, params: unknown, timing: unknown) => ({
      keywordWeighted: await searchByKeywordWeighted(prisma, params, timing),
      trigram: await searchByTrigram(prisma, params, timing),
      exactTitle: await searchByExactTitle(prisma, params, timing),
    }),
  )

  return {
    searchByKeywordWeighted,
    searchByTrigram,
    searchByExactTitle,
    searchKeywordFirstVideoLexical,
    MAX_EXACT_TITLE_TOKENS: 16,
    tokenizeForExactTitle: (q: string) => q.toLowerCase().split(/\s+/),
  }
})

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
  videoLocale: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  $queryRaw: vi.fn().mockResolvedValue([]),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const successEmbedder = (): QueryEmbedder =>
  vi.fn().mockResolvedValue([0.1, 0.2, 0.3])

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

async function flushQueuedPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

async function delayMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

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
  mockPrisma.videoLocale.findMany.mockResolvedValue([])
  mockPrisma.$queryRaw.mockResolvedValue([])
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

    expect(searchByKeywordWeighted).toHaveBeenCalledWith(
      mockPrisma,
      {
        query: "the bible project",
        locale: "en",
        limit: 60,
      },
      expect.any(Object),
    )
    expect(searchByTrigram).toHaveBeenCalledWith(
      mockPrisma,
      {
        query: "the bible project",
        locale: "en",
        limit: 60,
      },
      expect.any(Object),
    )
    expect(searchByExactTitle).toHaveBeenCalledWith(
      mockPrisma,
      {
        query: "the bible project",
        locale: "en",
        limit: 60,
      },
      expect.any(Object),
    )
  })

  it("starts keyword-first lexical retrievers while query embedding is pending", async () => {
    const embedding = deferred<number[]>()
    const embedder: QueryEmbedder = vi.fn(() => embedding.promise)
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder,
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    const searchPromise = service.search({
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
    })
    await flushQueuedPromises()

    expect(embedder).toHaveBeenCalledWith("the bible project")
    expect(searchByKeywordWeighted).toHaveBeenCalled()
    expect(searchByTrigram).toHaveBeenCalled()
    expect(searchByExactTitle).toHaveBeenCalled()
    expect(searchVideoSemantic).not.toHaveBeenCalled()

    embedding.resolve([0.1, 0.2, 0.3])
    await searchPromise

    expect(searchVideoSemantic).toHaveBeenCalled()
  })

  it("does not charge embedding wait time to db retrieval timing", async () => {
    const embedding = deferred<number[]>()
    const delayedEmpty = async () => {
      await delayMs(20)
      return []
    }
    vi.mocked(searchByKeywordWeighted).mockImplementation(delayedEmpty)
    vi.mocked(searchByTrigram).mockImplementation(delayedEmpty)
    vi.mocked(searchByExactTitle).mockImplementation(delayedEmpty)

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: vi.fn(() => embedding.promise),
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    const searchPromise = service.searchWithTrace({
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
    })
    await flushQueuedPromises()
    await delayMs(90)

    expect(searchByKeywordWeighted).toHaveBeenCalled()
    expect(searchByTrigram).toHaveBeenCalled()
    expect(searchByExactTitle).toHaveBeenCalled()
    expect(searchVideoSemantic).not.toHaveBeenCalled()

    embedding.resolve([0.1, 0.2, 0.3])
    const traced = await searchPromise

    expect(traced.timings.embeddingMs).toBeGreaterThanOrEqual(85)
    expect(traced.timings.retrievalsMs).toBeGreaterThanOrEqual(55)
    expect(traced.timings.retrievalsMs).toBeLessThan(traced.timings.embeddingMs)
    expect(traced.timings.retrievalWaitMs).toBeLessThan(
      traced.timings.embeddingMs / 2,
    )
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

  it("isolates a lexical batch failure via Promise.allSettled while other retrievers still return", async () => {
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
    vi.mocked(searchVideoSemantic).mockResolvedValue([
      {
        resultType: "video",
        resultId: "vid-semantic",
        videoCoreId: null,
        videoSlug: "semantic",
        videoTitle: "Semantic",
        imageUrl: null,
        sceneDescription: "semantic survivor",
        startSeconds: 0,
        playbackId: null,
        similarity: 0.8,
        embeddingText: "[0.1,0.2,0.3]",
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
    expect(result.results[0]!.id).toBe("vid-semantic")
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining("keyword-weighted-video retrieval failed"),
    )
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining("trigram-video retrieval failed"),
    )
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining("exact-title-video retrieval failed"),
    )
  })

  it("handles a fast keyword-first lexical rejection while embedding is pending", async () => {
    const embedding = deferred<number[]>()
    const loggerError = vi.fn()
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason)
    }
    process.on("unhandledRejection", onUnhandledRejection)
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
    vi.mocked(searchVideoSemantic).mockResolvedValue([
      {
        resultType: "video",
        resultId: "vid-semantic",
        videoCoreId: null,
        videoSlug: "semantic",
        videoTitle: "Semantic",
        imageUrl: null,
        sceneDescription: "semantic survivor",
        startSeconds: 0,
        playbackId: null,
        similarity: 0.8,
        embeddingText: "[0.1,0.2,0.3]",
      },
    ])

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: vi.fn(() => embedding.promise),
      logger: { warn: vi.fn(), error: loggerError },
    })

    try {
      const searchPromise = service.search({
        query: "jesus",
        locale: "en",
        mode: "keyword-first",
      })
      await flushQueuedPromises()

      expect(searchByTrigram).toHaveBeenCalled()
      expect(loggerError).not.toHaveBeenCalledWith(
        expect.stringContaining("trigram-video retrieval failed"),
      )

      embedding.resolve([0.1, 0.2, 0.3])
      const result = await searchPromise
      await flushQueuedPromises()

      expect(result.results).toHaveLength(1)
      expect(result.results[0]!.id).toBe("vid-semantic")
      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining("keyword-weighted-video retrieval failed"),
      )
      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining("trigram-video retrieval failed"),
      )
      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining("exact-title-video retrieval failed"),
      )
      expect(unhandledRejections).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandledRejection)
    }
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

    expect(searchVideoSemantic).toHaveBeenCalledWith(
      mockPrisma,
      {
        queryEmbedding: "[0.1,0.2,0.3]",
        locale: "en",
        limit: 60,
      },
      expect.any(Object),
    )
    expect(searchExperienceSemantic).toHaveBeenCalledWith(
      mockPrisma,
      {
        queryEmbedding: "[0.1,0.2,0.3]",
        locale: "en",
        limit: 60,
      },
      expect.any(Object),
    )
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
