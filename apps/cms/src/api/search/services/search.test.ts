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

vi.mock("./experience-semantic-search", () => ({
  searchByExperienceSemantic: vi.fn(),
}))

vi.mock("./experience-keyword-search", () => ({
  searchByExperienceKeyword: vi.fn(),
}))

vi.mock("./fusion", () => ({
  fuseRankedLists: vi.fn(),
  deduplicateResults: vi.fn(),
}))

import { embedQuery } from "../../../lib/openrouter"
import { searchBySemantic } from "./semantic-search"
import { searchByKeyword } from "./keyword-search"
import { searchByExperienceSemantic } from "./experience-semantic-search"
import { searchByExperienceKeyword } from "./experience-keyword-search"
import { fuseRankedLists, deduplicateResults } from "./fusion"
import { __resetSearchHealthForTest, getStats } from "./search-health"
import { search } from "./search"

const mockKnex = {}
// Keep references to log mocks so tests can assert on call counts without
// casting mockStrapi back to its internal shape.
const logWarn = vi.fn()
const logError = vi.fn()
const mockStrapi = {
  db: { connection: mockKnex },
  log: { warn: logWarn, error: logError },
} as unknown as Parameters<typeof search>[0]

/**
 * Default empty-mock setup for all retrievals + fusion + dedup. Tests that
 * exercise just one slice of the pipeline can call this and only override
 * the mocks they care about.
 */
function setupDefaultMocks() {
  vi.mocked(embedQuery).mockResolvedValue([0.1])
  vi.mocked(searchBySemantic).mockResolvedValue([])
  vi.mocked(searchByKeyword).mockResolvedValue([])
  vi.mocked(searchByExperienceSemantic).mockResolvedValue([])
  vi.mocked(searchByExperienceKeyword).mockResolvedValue([])
  vi.mocked(fuseRankedLists).mockReturnValue([])
  vi.mocked(deduplicateResults).mockReturnValue([])
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetSearchHealthForTest()
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
    vi.mocked(searchByExperienceSemantic).mockResolvedValue([])
    vi.mocked(searchByExperienceKeyword).mockResolvedValue([])
    vi.mocked(fuseRankedLists).mockReturnValue([
      {
        resultType: "video",
        resultId: 1,
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
        resultType: "video",
        resultId: 2,
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
        resultType: "video",
        resultId: 1,
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
        resultType: "video",
        resultId: 2,
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

    // Verify both video retrievals were called with overfetch (20 * 3 = 60)
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

    // Default contentTypes also fires experience retrievals
    expect(searchByExperienceSemantic).toHaveBeenCalled()
    expect(searchByExperienceKeyword).toHaveBeenCalled()

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
    setupDefaultMocks()

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
    setupDefaultMocks()

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
    setupDefaultMocks()
    vi.mocked(deduplicateResults).mockReturnValue([
      {
        resultType: "video",
        resultId: 1,
        videoId: 1,
        videoTitle: "A",
        videoCoreId: null,
        score: 0.9,
      },
      {
        resultType: "video",
        resultId: 2,
        videoId: 2,
        videoTitle: "B",
        videoCoreId: null,
        score: 0.8,
      },
      {
        resultType: "video",
        resultId: 3,
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
    setupDefaultMocks()
    // Dedup returns 3 items when we asked for offset+limit+1 = 3 (limit=2, offset=0)
    vi.mocked(deduplicateResults).mockReturnValue([
      {
        resultType: "video",
        resultId: 1,
        videoId: 1,
        videoTitle: "A",
        videoCoreId: null,
        score: 0.9,
      },
      {
        resultType: "video",
        resultId: 2,
        videoId: 2,
        videoTitle: "B",
        videoCoreId: null,
        score: 0.8,
      },
      {
        resultType: "video",
        resultId: 3,
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
      offset: 0,
    })

    expect(result.results).toHaveLength(2)
    expect(result.hasMore).toBe(true)
  })

  it("returns empty results when both retrievals return nothing", async () => {
    setupDefaultMocks()

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
    vi.mocked(searchBySemantic).mockResolvedValue([])
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
    vi.mocked(searchByExperienceSemantic).mockResolvedValue([])
    vi.mocked(searchByExperienceKeyword).mockResolvedValue([])
    vi.mocked(fuseRankedLists).mockReturnValue([
      {
        resultType: "video",
        resultId: 10,
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
        resultType: "video",
        resultId: 10,
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
    // Semantic searches were skipped (no embedding available)
    expect(searchBySemantic).not.toHaveBeenCalled()
    expect(searchByExperienceSemantic).not.toHaveBeenCalled()
    // Experience keyword search still ran (no embedding dependency)
    expect(searchByExperienceKeyword).toHaveBeenCalled()
    // Results still returned
    expect(result.results).toHaveLength(1)
    expect(result.results[0]!.id).toBe(10)

    // feat-097 regression guard: embedding failure must surface at error
    // level (not warn) and include the error class plus a structured
    // `event=` tag so log-based alerts can target it.
    expect(logWarn).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("event=query_embedding_failure"),
    )
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("error_class=Error"),
    )
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("OPENROUTER_API_KEY is not set"),
    )

    // Counters recorded the failed attempt for the health probe to surface.
    const health = getStats()
    expect(health.attempts).toBe(1)
    expect(health.failures).toBe(1)
    expect(health.lastErrorClass).toBe("Error")
    expect(health.lastErrorMessage).toBe("OPENROUTER_API_KEY is not set")
    expect(health.lastErrorAt).not.toBeNull()

    // Response signals the degraded mode so consumers can render a banner.
    expect(result.searchMode).toBe("keyword-only")
  })

  it("tracks successful embeddings in the health counters without logging an error", async () => {
    setupDefaultMocks()

    const result = await search(mockStrapi, { query: "hope", locale: "en" })

    const health = getStats()
    expect(health.attempts).toBe(1)
    expect(health.failures).toBe(0)
    expect(health.lastErrorAt).toBeNull()
    expect(logError).not.toHaveBeenCalled()

    // When the embedding succeeds the response advertises the full hybrid
    // retrieval path, letting consumers show the normal affordances.
    expect(result.searchMode).toBe("hybrid")
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
    vi.mocked(searchByExperienceSemantic).mockResolvedValue([])
    vi.mocked(searchByExperienceKeyword).mockResolvedValue([])
    vi.mocked(fuseRankedLists).mockReturnValue([
      {
        resultType: "video",
        resultId: 20,
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
        resultType: "video",
        resultId: 20,
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

  it("returns empty results gracefully when all retrievals reject", async () => {
    vi.mocked(embedQuery).mockResolvedValue([0.1])
    vi.mocked(searchBySemantic).mockRejectedValue(new Error("pgvector down"))
    vi.mocked(searchByKeyword).mockRejectedValue(
      new Error("connection pool exhausted"),
    )
    vi.mocked(searchByExperienceSemantic).mockRejectedValue(
      new Error("pgvector down"),
    )
    vi.mocked(searchByExperienceKeyword).mockRejectedValue(
      new Error("connection pool exhausted"),
    )
    vi.mocked(fuseRankedLists).mockReturnValue([])
    vi.mocked(deduplicateResults).mockReturnValue([])

    const result = await search(mockStrapi, { query: "test", locale: "en" })

    // Total failure doesn't throw — degrades to empty result set
    expect(result.results).toEqual([])
    expect(result.hasMore).toBe(false)
    // All four failures are logged for operational visibility
    expect(logError.mock.calls.length).toBeGreaterThanOrEqual(4)
  })

  it("maps keyword-only results with null startSeconds and playbackId", async () => {
    setupDefaultMocks()
    // A keyword-only result has no startSeconds or playbackId
    vi.mocked(deduplicateResults).mockReturnValue([
      {
        resultType: "video",
        resultId: 30,
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

  /* ---------------------------------------------------------------- */
  /*  Content type filter                                              */
  /* ---------------------------------------------------------------- */

  describe("contentTypes filter", () => {
    it("fires only video retrievals when contentTypes=['video']", async () => {
      setupDefaultMocks()

      await search(mockStrapi, {
        query: "test",
        locale: "en",
        contentTypes: ["video"],
      })

      expect(searchBySemantic).toHaveBeenCalled()
      expect(searchByKeyword).toHaveBeenCalled()
      expect(searchByExperienceSemantic).not.toHaveBeenCalled()
      expect(searchByExperienceKeyword).not.toHaveBeenCalled()
    })

    it("fires only experience retrievals when contentTypes=['experience']", async () => {
      setupDefaultMocks()

      await search(mockStrapi, {
        query: "test",
        locale: "en",
        contentTypes: ["experience"],
      })

      expect(searchBySemantic).not.toHaveBeenCalled()
      expect(searchByKeyword).not.toHaveBeenCalled()
      expect(searchByExperienceSemantic).toHaveBeenCalled()
      expect(searchByExperienceKeyword).toHaveBeenCalled()
    })

    it("fires all four retrievals when contentTypes is omitted", async () => {
      setupDefaultMocks()

      await search(mockStrapi, { query: "test", locale: "en" })

      expect(searchBySemantic).toHaveBeenCalled()
      expect(searchByKeyword).toHaveBeenCalled()
      expect(searchByExperienceSemantic).toHaveBeenCalled()
      expect(searchByExperienceKeyword).toHaveBeenCalled()
    })

    it("fires all four retrievals when contentTypes=['video','experience']", async () => {
      setupDefaultMocks()

      await search(mockStrapi, {
        query: "test",
        locale: "en",
        contentTypes: ["video", "experience"],
      })

      expect(searchBySemantic).toHaveBeenCalled()
      expect(searchByKeyword).toHaveBeenCalled()
      expect(searchByExperienceSemantic).toHaveBeenCalled()
      expect(searchByExperienceKeyword).toHaveBeenCalled()
    })

    it("falls back to all types when contentTypes is an empty array", async () => {
      setupDefaultMocks()

      await search(mockStrapi, {
        query: "test",
        locale: "en",
        contentTypes: [],
      })

      expect(searchBySemantic).toHaveBeenCalled()
      expect(searchByExperienceSemantic).toHaveBeenCalled()
    })

    it("with contentTypes=['experience'] and embedQuery failure, only experience keyword runs", async () => {
      // Combined degradation: experience-only filter + OpenRouter outage.
      // Should fall back to a single experience-keyword retrieval. Fusion
      // receives exactly one non-empty list.
      vi.mocked(embedQuery).mockRejectedValue(new Error("OpenRouter down"))
      vi.mocked(searchByExperienceKeyword).mockResolvedValue([
        {
          resultType: "experience",
          resultId: 4,
          experienceId: 4,
          experienceSlug: "easter",
          experienceTitle: "Easter",
          experienceMetaDescription: "Easter snippet",
          imageUrl: null,
          rank: 0.5,
        },
      ])
      vi.mocked(fuseRankedLists).mockReturnValue([
        {
          resultType: "experience",
          resultId: 4,
          experienceId: 4,
          experienceSlug: "easter",
          experienceTitle: "Easter",
          experienceMetaDescription: "Easter snippet",
          imageUrl: null,
          score: 1.0,
        },
      ])
      vi.mocked(deduplicateResults).mockReturnValue([
        {
          resultType: "experience",
          resultId: 4,
          experienceId: 4,
          experienceSlug: "easter",
          experienceTitle: "Easter",
          experienceMetaDescription: "Easter snippet",
          imageUrl: null,
          score: 1.0,
        },
      ])

      const result = await search(mockStrapi, {
        query: "Easter",
        locale: "en",
        contentTypes: ["experience"],
      })

      // Only experience keyword fired
      expect(searchByExperienceKeyword).toHaveBeenCalled()
      expect(searchByExperienceSemantic).not.toHaveBeenCalled()
      expect(searchBySemantic).not.toHaveBeenCalled()
      expect(searchByKeyword).not.toHaveBeenCalled()

      // Fusion received exactly one non-empty list
      const passedLists = vi.mocked(fuseRankedLists).mock.calls[0]![0]
      expect(passedLists).toHaveLength(1)

      // Result reaches the client
      expect(result.results).toHaveLength(1)
      expect(result.results[0]!.type).toBe("experience")
      expect(result.results[0]!.id).toBe(4)
    })
  })

  /* ---------------------------------------------------------------- */
  /*  RRF score dilution prevention                                    */
  /* ---------------------------------------------------------------- */

  describe("empty list filtering before fusion", () => {
    it("does not pass empty result lists to fuseRankedLists", async () => {
      vi.mocked(embedQuery).mockResolvedValue([0.1])
      vi.mocked(searchBySemantic).mockResolvedValue([
        {
          videoId: 1,
          videoSlug: "v",
          videoTitle: "V",
          videoCoreId: null,
          imageUrl: null,
          sceneIndex: 0,
          description: "d",
          startSeconds: 0,
          playbackId: "p",
          similarity: 0.9,
          embeddingText: "[0.1]",
        },
      ])
      vi.mocked(searchByKeyword).mockResolvedValue([])
      vi.mocked(searchByExperienceSemantic).mockResolvedValue([])
      vi.mocked(searchByExperienceKeyword).mockResolvedValue([])
      vi.mocked(fuseRankedLists).mockReturnValue([])
      vi.mocked(deduplicateResults).mockReturnValue([])

      await search(mockStrapi, { query: "test", locale: "en" })

      // Only the non-empty list should reach fusion. RRF normalization
      // divides by the input list count, so feeding empty lists would
      // dilute the score from the one list that did contribute.
      expect(fuseRankedLists).toHaveBeenCalledWith(
        [expect.arrayContaining([expect.objectContaining({ videoId: 1 })])],
        60,
      )
      const passedLists = vi.mocked(fuseRankedLists).mock.calls[0]![0]
      expect(passedLists).toHaveLength(1)
    })
  })

  /* ---------------------------------------------------------------- */
  /*  Mixed video + experience results                                 */
  /* ---------------------------------------------------------------- */

  describe("mixed result types", () => {
    it("annotates video results with resultType/resultId before fusion", async () => {
      setupDefaultMocks()
      vi.mocked(searchBySemantic).mockResolvedValue([
        {
          videoId: 99,
          videoSlug: "v99",
          videoTitle: "V99",
          videoCoreId: "c99",
          imageUrl: null,
          sceneIndex: 0,
          description: "d",
          startSeconds: 0,
          playbackId: "p",
          similarity: 0.9,
          embeddingText: "[0.1]",
        },
      ])

      await search(mockStrapi, {
        query: "test",
        locale: "en",
        contentTypes: ["video"],
      })

      const passedLists = vi.mocked(fuseRankedLists).mock.calls[0]![0]
      const semanticList = passedLists[0]!
      expect(semanticList[0]).toMatchObject({
        resultType: "video",
        resultId: 99,
        videoId: 99,
      })
    })

    it("maps experience results to the SearchResult contract", async () => {
      setupDefaultMocks()
      // Use a score that exercises the 3-decimal rounding in
      // mapToSearchResult — proves the round() isn't accidentally a no-op.
      vi.mocked(deduplicateResults).mockReturnValue([
        {
          resultType: "experience",
          resultId: 4,
          experienceId: 4,
          experienceSlug: "easter",
          experienceTitle: "Easter",
          experienceMetaDescription:
            "Discover the meaning of Easter through scripture.",
          imageUrl: null,
          score: 0.9234567,
        },
      ])

      const result = await search(mockStrapi, {
        query: "Easter",
        locale: "en",
      })

      expect(result.results).toHaveLength(1)
      expect(result.results[0]).toEqual({
        type: "experience",
        id: 4,
        slug: "easter",
        title: "Easter",
        imageUrl: null,
        snippet: "Discover the meaning of Easter through scripture.",
        startSeconds: null,
        playbackId: null,
        score: 0.923,
      })
    })

    it("returns mixed video and experience results in score order", async () => {
      setupDefaultMocks()
      vi.mocked(deduplicateResults).mockReturnValue([
        {
          resultType: "experience",
          resultId: 4,
          experienceId: 4,
          experienceSlug: "easter",
          experienceTitle: "Easter",
          experienceMetaDescription: "Easter snippet",
          imageUrl: null,
          score: 0.96,
        },
        {
          resultType: "video",
          resultId: 7,
          videoId: 7,
          videoSlug: "easter-video",
          videoTitle: "Easter Video",
          videoCoreId: "ev",
          imageUrl: null,
          description: "video snippet",
          startSeconds: 12,
          playbackId: "px",
          score: 0.81,
        },
      ])

      const result = await search(mockStrapi, {
        query: "Easter",
        locale: "en",
      })

      expect(result.results.map((r) => r.type)).toEqual(["experience", "video"])
      expect(result.results[0]!.id).toBe(4)
      expect(result.results[1]!.id).toBe(7)
    })

    it("preserves both results when video id and experience id collide", async () => {
      setupDefaultMocks()
      // Same integer id on both — the orchestrator must not collapse them.
      vi.mocked(deduplicateResults).mockReturnValue([
        {
          resultType: "video",
          resultId: 4,
          videoId: 4,
          videoSlug: "v4",
          videoTitle: "Video 4",
          videoCoreId: "c4",
          imageUrl: null,
          description: "video 4",
          startSeconds: 0,
          playbackId: "p4",
          score: 0.9,
        },
        {
          resultType: "experience",
          resultId: 4,
          experienceId: 4,
          experienceSlug: "exp-4",
          experienceTitle: "Experience 4",
          experienceMetaDescription: "experience 4",
          imageUrl: null,
          score: 0.85,
        },
      ])

      const result = await search(mockStrapi, {
        query: "test",
        locale: "en",
      })

      expect(result.results).toHaveLength(2)
      expect(result.results[0]).toMatchObject({ type: "video", id: 4 })
      expect(result.results[1]).toMatchObject({ type: "experience", id: 4 })
    })
  })
})
