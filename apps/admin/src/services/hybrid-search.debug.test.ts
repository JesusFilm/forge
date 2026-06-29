/**
 * Service-level tests for the origin-gated `debug` payload.
 *
 * Origin gating happens at the REST + GraphQL boundary; the service
 * trusts the boolean. These tests cover the orchestrator's contract
 * with that boolean: when `debug: true`, every returned result carries
 * a `debug` payload with the per-retriever ranks + fused score +
 * cap state; when omitted/false, the field is absent.
 *
 * Boundary-level origin gating (REST + GraphQL) is covered in
 * `app/api/search/route.test.ts` and `graphql/queries/hybrid-search.test.ts`.
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

beforeEach(() => {
  vi.clearAllMocks()
  __resetSearchHealthForTest()
  // Restore default hydration stub after clearAllMocks wipes it.
  mockPrisma.video.findMany.mockResolvedValue([])
  mockPrisma.videoLocale.findMany.mockResolvedValue([])
  mockPrisma.$queryRaw.mockResolvedValue([])
  vi.mocked(searchVideoSemantic).mockResolvedValue([])
  vi.mocked(searchExperienceSemantic).mockResolvedValue([])
  vi.mocked(searchExperienceKeyword).mockResolvedValue([])
  vi.mocked(searchByKeywordWeighted).mockResolvedValue([])
  vi.mocked(searchByTrigram).mockResolvedValue([])
  vi.mocked(searchByExactTitle).mockResolvedValue([])
  vi.mocked(searchVideoKeyword).mockResolvedValue([
    {
      resultType: "video",
      resultId: "vid-1",
      videoCoreId: "core-1",
      videoSlug: "x",
      videoTitle: "X",
      imageUrl: null,
      description: "d",
      playbackId: null,
      rank: 0.5,
    },
  ])
})

describe("HybridSearchService debug payload routing", () => {
  it("attaches debug to every result when params.debug=true", async () => {
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    const result = await service.search({
      query: "x",
      locale: "en",
      debug: true,
    })

    expect(result.results).toHaveLength(1)
    const debug = result.results[0]!.debug
    expect(debug).toBeDefined()
    expect(debug!.retrieverRanks).toEqual([{ label: "keyword-video", rank: 1 }])
    expect(typeof debug!.fusedScore).toBe("number")
    expect(debug!.dilutionCapApplied).toBe(false)
  })

  it("strips debug when params.debug omitted", async () => {
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    const result = await service.search({ query: "x", locale: "en" })

    expect(result.results).toHaveLength(1)
    expect(result.results[0]!.debug).toBeUndefined()
  })

  it("strips debug when params.debug=false", async () => {
    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    const result = await service.search({
      query: "x",
      locale: "en",
      debug: false,
    })

    expect(result.results[0]!.debug).toBeUndefined()
  })

  it("debug payload aggregates ranks across multiple lists when a result hits more than one", async () => {
    // Same resultId appears in semantic-video AND keyword-video.
    vi.mocked(searchVideoSemantic).mockResolvedValue([
      {
        resultType: "video",
        resultId: "vid-shared",
        videoCoreId: "core-S",
        videoSlug: "shared",
        videoTitle: "Shared",
        imageUrl: null,
        sceneDescription: "desc",
        startSeconds: 0,
        playbackId: null,
        similarity: 0.9,
        embeddingText: "[0.1,0.2,0.3]",
      },
    ])
    vi.mocked(searchVideoKeyword).mockResolvedValue([
      {
        resultType: "video",
        resultId: "vid-shared",
        videoCoreId: "core-S",
        videoSlug: "shared",
        videoTitle: "Shared",
        imageUrl: null,
        description: "d",
        playbackId: null,
        rank: 0.5,
      },
    ])

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    const result = await service.search({
      query: "shared",
      locale: "en",
      debug: true,
    })

    const debug = result.results[0]!.debug!
    const labels = debug.retrieverRanks.map((r) => r.label).sort()
    expect(labels).toEqual(["keyword-video", "semantic-video"])
  })

  it("a mixed semantic-video hit still exposes one debug origin and no public evidence fields", async () => {
    vi.mocked(searchVideoKeyword).mockResolvedValue([])
    vi.mocked(searchVideoSemantic).mockResolvedValue([
      {
        resultType: "video",
        resultId: "vid-mixed",
        videoCoreId: "core-mixed",
        videoSlug: "mixed",
        videoTitle: "Mixed Evidence",
        imageUrl: null,
        sceneDescription: "Winning transcript or scene snippet",
        startSeconds: 12,
        playbackId: "mux-mixed",
        similarity: 0.91,
        embeddingText: "[0.1,0.2,0.3]",
      },
    ])

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    const result = await service.search({
      query: "spoken phrase",
      locale: "en",
      debug: true,
      contentTypes: ["video"],
    })

    expect(result.results).toHaveLength(1)
    expect(result.results[0]!.debug!.retrieverRanks).toEqual([
      { label: "semantic-video", rank: 1 },
    ])
    expect(Object.keys(result.results[0]!).sort()).toEqual(
      [
        "childCount",
        "debug",
        "durationSeconds",
        "id",
        "imageUrl",
        "label",
        "playbackId",
        "score",
        "slug",
        "snippet",
        "startSeconds",
        "title",
        "type",
      ].sort(),
    )
  })

  it("dilutionCapApplied reflects the cap's per-result decision in keyword-first mode", async () => {
    // Bring up a keyword-first scenario where the cap fires on a
    // semantic-only row.
    vi.mocked(searchVideoKeyword).mockResolvedValue([])
    vi.mocked(searchVideoSemantic).mockResolvedValue([
      {
        resultType: "video",
        resultId: "vid-sem-only",
        videoCoreId: "core-OUT",
        videoSlug: "out",
        videoTitle: "Out of allowlist",
        imageUrl: null,
        sceneDescription: "scene",
        startSeconds: 0,
        playbackId: null,
        similarity: 0.85,
        embeddingText: "[0.1,0.2,0.3]",
      },
    ])
    vi.mocked(searchByExactTitle).mockResolvedValue([
      {
        resultType: "video",
        resultId: "vid-exact",
        videoCoreId: "core-IN",
        videoSlug: "exact",
        videoTitle: "The Bible Project",
        imageUrl: null,
        description: "",
        titleLength: 17,
      },
    ])
    vi.mocked(searchByKeywordWeighted).mockResolvedValue([
      {
        resultType: "video",
        resultId: "vid-kw",
        videoCoreId: "core-IN",
        videoSlug: "kw",
        videoTitle: "The Bible Project",
        imageUrl: null,
        description: "",
        rank: 0.5,
      },
    ])

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    const result = await service.search({
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
      debug: true,
    })

    const semOnly = result.results.find((r) => r.id === "vid-sem-only")
    expect(semOnly).toBeDefined()
    expect(semOnly!.debug!.dilutionCapApplied).toBe(true)
    // Keyword-side rows (vid-kw / vid-exact) survive dedup as a single
    // entry because they share videoCoreId + title; the survivor's
    // dilutionCapApplied is false (it was never semantic-only).
    const keywordSurvivor = result.results.find(
      (r) => r.id === "vid-kw" || r.id === "vid-exact",
    )
    expect(keywordSurvivor).toBeDefined()
    expect(keywordSurvivor!.debug!.dilutionCapApplied).toBe(false)
  })
})
