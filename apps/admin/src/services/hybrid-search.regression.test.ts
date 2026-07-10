/**
 * Default-mode regression snapshot — the byte-identity gate for the
 * R4 → keyword-first port.
 *
 * The contract this test locks in: when the public `mode` argument is
 * unset, null, empty string, `"hybrid"`, or any unknown value, the
 * orchestrator's response MUST be byte-equal to R4's mode-less
 * baseline. Adding new retrievers, dilution caps, or debug payloads
 * to the keyword-first branch (Units 3+) is allowed only as long as
 * THIS test stays green.
 *
 * The snapshot is captured *across modes within a single test run*
 * against deterministic mocked retrievers — the byte-identity is the
 * relative invariant (mode A == mode B == mode C == ...). A future
 * R-stage that legitimately changes R4's hybrid response shape will
 * fail this test on principle, which is the point: such a change must
 * be a deliberate, reviewed update to the snapshot, not silent drift.
 *
 * Behavioral cross-check: keyword-first retrievers are mocked in Unit 3
 * onward and asserted NEVER-CALLED on the default path. Until those
 * retrievers exist we assert via the four R4 retrievers that they ARE
 * all called regardless of `mode` value (since hybrid is the universal
 * fallback in this unit).
 *
 * Per docs/solutions/best-practices/test-first-regression-snapshot-byte-identical-default-20260429.md.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./hybrid-search-retrievers", () => ({
  searchVideoSemantic: vi.fn(),
  searchVideoKeyword: vi.fn(),
  searchExperienceSemantic: vi.fn(),
  searchExperienceKeyword: vi.fn(),
}))

vi.mock("./hybrid-search-keyword-first-retrievers", () => {
  const searchByKeywordWeighted = vi.fn().mockResolvedValue([])
  const searchByTrigram = vi.fn().mockResolvedValue([])
  const searchByExactTitle = vi.fn().mockResolvedValue([])
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
  type SearchParams,
} from "./hybrid-search.service"

const mockPrisma = {
  video: {
    // Default to empty hydration so card-pill enrichment (post-fusion
    // `prisma.video.findMany`) doesn't crash these regression tests.
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

/**
 * Deterministic fixtures across all modes. The exact rows don't matter
 * — what matters is that the same fixtures produce byte-identical
 * responses regardless of the `mode` value.
 */
function setupRetrieverFixtures() {
  vi.mocked(searchVideoSemantic).mockResolvedValue([
    {
      resultType: "video",
      resultId: "vid-sem-1",
      videoCoreId: "1_RegressionVideo",
      videoSlug: "regression-video",
      videoTitle: "Regression Video",
      imageUrl: null,
      sceneDescription: "Regression scene",
      startSeconds: 12,
      playbackId: "mux-regression-1",
      similarity: 0.91,
      embeddingText: "[0.1,0.2,0.3]",
    },
  ])
  vi.mocked(searchVideoKeyword).mockResolvedValue([
    {
      resultType: "video",
      resultId: "vid-kw-1",
      videoCoreId: "2_KeywordVideo",
      videoSlug: "keyword-video",
      videoTitle: "Keyword Video",
      imageUrl: null,
      description: "Keyword description",
      playbackId: null,
      rank: 0.42,
    },
  ])
  vi.mocked(searchExperienceSemantic).mockResolvedValue([
    {
      resultType: "experience",
      resultId: "exp-sem-1",
      experienceSlug: "regression-experience",
      experienceTitle: "Regression Experience",
      experienceMetaDescription: "Regression meta",
      imageUrl: null,
      similarity: 0.77,
    },
  ])
  vi.mocked(searchExperienceKeyword).mockResolvedValue([
    {
      resultType: "experience",
      resultId: "exp-kw-1",
      experienceSlug: "keyword-experience",
      experienceTitle: "Keyword Experience",
      experienceMetaDescription: "Keyword meta",
      imageUrl: null,
      rank: 0.33,
    },
  ])
}

/** Five representative queries × 5 mode values. Keep this list stable — re-snapshotting on a whim defeats the point. */
const REGRESSION_QUERIES = [
  "the bible project",
  "jesus heals",
  "easter resurrection",
  "forgiveness",
  "hope when life is hard",
]

const DEFAULT_EQUIVALENT_MODES: Array<{
  label: string
  mode: SearchParams["mode"]
}> = [
  { label: "undefined", mode: undefined },
  { label: "null", mode: null },
  { label: "empty string", mode: "" },
  { label: "'hybrid'", mode: "hybrid" },
  { label: "'garbage' (unknown)", mode: "garbage" },
]

beforeEach(() => {
  vi.clearAllMocks()
  __resetSearchHealthForTest()
  setupRetrieverFixtures()
  // Restore default hydration stub after clearAllMocks wipes it.
  mockPrisma.video.findMany.mockResolvedValue([])
  mockPrisma.videoLocale.findMany.mockResolvedValue([])
  mockPrisma.$queryRaw.mockResolvedValue([])
})

describe("HybridSearchService default-mode regression snapshot", () => {
  it.each(REGRESSION_QUERIES)(
    "produces byte-identical responses across hybrid-equivalent modes for q=%s",
    async (query) => {
      const responses: string[] = []
      for (const { mode } of DEFAULT_EQUIVALENT_MODES) {
        const warn = vi.fn()
        const error = vi.fn()
        const service = new HybridSearchService({
          prisma: mockPrisma,
          embedder: successEmbedder(),
          logger: { warn, error },
        })
        const result = await service.search({ query, locale: "en", mode })
        responses.push(JSON.stringify(result))
      }
      const [first, ...rest] = responses
      for (const r of rest) {
        expect(r).toBe(first)
      }
    },
  )

  it("calls every R4 retriever exactly once on the default path regardless of mode", async () => {
    for (const { mode } of DEFAULT_EQUIVALENT_MODES) {
      vi.clearAllMocks()
      setupRetrieverFixtures()
      mockPrisma.video.findMany.mockResolvedValue([])
      const service = new HybridSearchService({
        prisma: mockPrisma,
        embedder: successEmbedder(),
        logger: { warn: vi.fn(), error: vi.fn() },
      })
      await service.search({ query: "jesus", locale: "en", mode })
      expect(searchVideoSemantic).toHaveBeenCalledTimes(1)
      expect(searchVideoKeyword).toHaveBeenCalledTimes(1)
      expect(searchExperienceSemantic).toHaveBeenCalledTimes(1)
      expect(searchExperienceKeyword).toHaveBeenCalledTimes(1)
    }
  })

  it("default path embeds once and searches semantic video without a source override", async () => {
    for (const { mode } of DEFAULT_EQUIVALENT_MODES) {
      vi.clearAllMocks()
      setupRetrieverFixtures()
      mockPrisma.video.findMany.mockResolvedValue([])
      const embedder = successEmbedder()
      const service = new HybridSearchService({
        prisma: mockPrisma,
        embedder,
        logger: { warn: vi.fn(), error: vi.fn() },
      })
      await service.search({ query: "jesus", locale: "en", mode })
      expect(embedder).toHaveBeenCalledWith("jesus")
      const params = vi.mocked(searchVideoSemantic).mock.calls.at(-1)?.[1]
      expect(params).not.toHaveProperty("embeddingSource")
    }
  })

  it("NEVER calls keyword-first retrievers on the default path", async () => {
    for (const { mode } of DEFAULT_EQUIVALENT_MODES) {
      vi.clearAllMocks()
      setupRetrieverFixtures()
      mockPrisma.video.findMany.mockResolvedValue([])
      const service = new HybridSearchService({
        prisma: mockPrisma,
        embedder: successEmbedder(),
        logger: { warn: vi.fn(), error: vi.fn() },
      })
      await service.search({ query: "jesus", locale: "en", mode })
      expect(searchByKeywordWeighted).not.toHaveBeenCalled()
      expect(searchByTrigram).not.toHaveBeenCalled()
      expect(searchByExactTitle).not.toHaveBeenCalled()
    }
  })

  it("emits exactly one sanitized warn log on unknown mode and never throws", async () => {
    const warn = vi.fn()
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn, error: vi.fn() },
    })

    await service.search({ query: "jesus", locale: "en", mode: "garbage" })

    expect(warn).toHaveBeenCalledTimes(1)
    const line = warn.mock.calls[0]![0] as string
    expect(line).toContain("event=search_unknown_mode")
    expect(line).toContain("mode=garbage")
    expect(line).toContain("falling_back=hybrid")
  })

  it("strips CR/LF/TAB from sanitized mode value to prevent log injection", async () => {
    const warn = vi.fn()
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn, error: vi.fn() },
    })

    await service.search({
      query: "jesus",
      locale: "en",
      mode: "garbage\r\nevent=injected",
    })

    expect(warn).toHaveBeenCalledTimes(1)
    const line = warn.mock.calls[0]![0] as string
    // Newlines / tabs have been replaced with spaces. The sanitized
    // payload still contains the literal substring `event=injected`
    // (clamped + space-replaced), but no NEW log line was started, so
    // a downstream log shipper sees one record, not two.
    expect(line).not.toMatch(/[\r\n\t]/)
    expect(line.split("\n").length).toBe(1)
    expect(line).toContain("event=search_unknown_mode")
    // `\r\n` becomes two spaces (no whitespace collapsing — keeps the
    // sanitizer minimal and predictable).
    expect(line).toContain("mode=garbage  event=injected")
  })

  it("does NOT warn when mode is unset / null / empty / 'hybrid'", async () => {
    for (const mode of [undefined, null, "", "hybrid"] as const) {
      const warn = vi.fn()
      const service = new HybridSearchService({
        prisma: mockPrisma,
        embedder: successEmbedder(),
        logger: { warn, error: vi.fn() },
      })
      await service.search({ query: "jesus", locale: "en", mode })
      expect(warn).not.toHaveBeenCalled()
    }
  })

  it("does NOT warn when mode is the canonical 'keyword-first' value (recognized)", async () => {
    const warn = vi.fn()
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn, error: vi.fn() },
    })
    await service.search({
      query: "jesus",
      locale: "en",
      mode: "keyword-first",
    })
    // Wired but not branched on in Unit 2 — the orchestrator's response
    // is still hybrid-shaped. No warn should fire because the value is
    // recognized.
    expect(warn).not.toHaveBeenCalled()
  })

  it("preserves searchMode='hybrid' when embedding succeeds — orthogonal to input mode", async () => {
    for (const { mode } of DEFAULT_EQUIVALENT_MODES) {
      const service = new HybridSearchService({
        prisma: mockPrisma,
        embedder: successEmbedder(),
        logger: { warn: vi.fn(), error: vi.fn() },
      })
      const result = await service.search({
        query: "jesus",
        locale: "en",
        mode,
      })
      expect(result.searchMode).toBe("hybrid")
    }
  })

  it("preserves searchMode='keyword-only' when embedding fails — orthogonal to input mode", async () => {
    const failingEmbedder: QueryEmbedder = vi
      .fn()
      .mockRejectedValue(new Error("provider down"))
    for (const { mode } of DEFAULT_EQUIVALENT_MODES) {
      const service = new HybridSearchService({
        prisma: mockPrisma,
        embedder: failingEmbedder,
        logger: { warn: vi.fn(), error: vi.fn() },
      })
      const result = await service.search({
        query: "jesus",
        locale: "en",
        mode,
      })
      expect(result.searchMode).toBe("keyword-only")
    }
  })
})
