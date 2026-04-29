/**
 * Orchestrator-level coverage for the keyword-first branch (feat-109,
 * unit 3). Asserts that `mode="keyword-first"` swaps the video
 * retrieval set from {semantic, keyword} to {semantic,
 * keyword-weighted, trigram, exact-title}, leaves experience
 * retrievals untouched, and never calls the legacy `searchByKeyword`.
 *
 * Real-DB integration is a follow-up. This test validates the wiring
 * (which retrievers are dispatched, with which params); the retriever
 * SQL itself is covered by the per-retriever unit tests.
 */

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

vi.mock("./keyword-weighted-search", () => ({
  searchByKeywordWeighted: vi.fn(),
}))

vi.mock("./trigram-search", () => ({
  searchByTrigram: vi.fn(),
}))

vi.mock("./exact-title-search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./exact-title-search")>()
  return {
    ...actual,
    searchByExactTitle: vi.fn(),
  }
})

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
import { searchByExactTitle } from "./exact-title-search"
import { searchByExperienceKeyword } from "./experience-keyword-search"
import { searchByExperienceSemantic } from "./experience-semantic-search"
import { deduplicateResults, fuseRankedLists } from "./fusion"
import { searchByKeyword } from "./keyword-search"
import { searchByKeywordWeighted } from "./keyword-weighted-search"
import { __resetSearchHealthForTest } from "./search-health"
import { searchBySemantic } from "./semantic-search"
import { searchByTrigram } from "./trigram-search"
import { search } from "./search"

const mockKnex = {}
const logWarn = vi.fn()
const logError = vi.fn()
const mockStrapi = {
  db: { connection: mockKnex },
  log: { warn: logWarn, error: logError },
} as unknown as Parameters<typeof search>[0]

function setupDefaultMocks() {
  vi.mocked(embedQuery).mockResolvedValue([0.1])
  vi.mocked(searchBySemantic).mockResolvedValue([])
  vi.mocked(searchByKeyword).mockResolvedValue([])
  vi.mocked(searchByKeywordWeighted).mockResolvedValue([])
  vi.mocked(searchByTrigram).mockResolvedValue([])
  vi.mocked(searchByExactTitle).mockResolvedValue([])
  vi.mocked(searchByExperienceSemantic).mockResolvedValue([])
  vi.mocked(searchByExperienceKeyword).mockResolvedValue([])
  vi.mocked(fuseRankedLists).mockReturnValue([])
  vi.mocked(deduplicateResults).mockReturnValue([])
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetSearchHealthForTest()
  setupDefaultMocks()
})

describe("search keyword-first branch (feat-109)", () => {
  it("swaps the video retrieval set: keyword-weighted + trigram + exact-title replace keyword", async () => {
    await search(mockStrapi, {
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
    })

    // Semantic still runs (shared between modes).
    expect(searchBySemantic).toHaveBeenCalled()

    // Three new keyword-side retrievers run.
    expect(searchByKeywordWeighted).toHaveBeenCalledWith(
      mockKnex,
      expect.objectContaining({
        query: "the bible project",
        locale: "en",
      }),
    )
    expect(searchByTrigram).toHaveBeenCalledWith(
      mockKnex,
      expect.objectContaining({
        query: "the bible project",
        locale: "en",
      }),
    )
    expect(searchByExactTitle).toHaveBeenCalledWith(
      mockKnex,
      expect.objectContaining({
        query: "the bible project",
        locale: "en",
      }),
    )

    // Legacy keyword retriever is NOT called in keyword-first mode.
    expect(searchByKeyword).not.toHaveBeenCalled()
  })

  it("leaves experience retrievals untouched in keyword-first mode", async () => {
    await search(mockStrapi, {
      query: "easter",
      locale: "en",
      mode: "keyword-first",
    })

    expect(searchByExperienceSemantic).toHaveBeenCalled()
    expect(searchByExperienceKeyword).toHaveBeenCalled()
  })

  it("hybrid mode preserves legacy keyword path; never calls the new retrievers", async () => {
    await search(mockStrapi, {
      query: "the bible project",
      locale: "en",
      mode: "hybrid",
    })

    expect(searchByKeyword).toHaveBeenCalled()

    expect(searchByKeywordWeighted).not.toHaveBeenCalled()
    expect(searchByTrigram).not.toHaveBeenCalled()
    expect(searchByExactTitle).not.toHaveBeenCalled()
  })

  it("default mode (no `mode` arg) is identical to mode='hybrid' — no new retrievers fire", async () => {
    await search(mockStrapi, {
      query: "the bible project",
      locale: "en",
    })

    expect(searchByKeyword).toHaveBeenCalled()
    expect(searchByKeywordWeighted).not.toHaveBeenCalled()
    expect(searchByTrigram).not.toHaveBeenCalled()
    expect(searchByExactTitle).not.toHaveBeenCalled()
  })

  it("unknown mode falls back to hybrid — keyword-first retrievers do NOT fire", async () => {
    await search(mockStrapi, {
      query: "the bible project",
      locale: "en",
      mode: "garbage",
    })

    expect(searchByKeyword).toHaveBeenCalled()
    expect(searchByKeywordWeighted).not.toHaveBeenCalled()
    expect(searchByTrigram).not.toHaveBeenCalled()
    expect(searchByExactTitle).not.toHaveBeenCalled()
    // Warn log emitted by normalizeMode().
    expect(logWarn).toHaveBeenCalledTimes(1)
  })

  it("contentTypes=['experience'] + mode='keyword-first': only experience retrievals fire", async () => {
    // Keyword-first applies only to videos. An experience-only filter
    // skips video retrieval entirely regardless of mode.
    await search(mockStrapi, {
      query: "easter",
      locale: "en",
      mode: "keyword-first",
      contentTypes: ["experience"],
    })

    expect(searchByKeywordWeighted).not.toHaveBeenCalled()
    expect(searchByTrigram).not.toHaveBeenCalled()
    expect(searchByExactTitle).not.toHaveBeenCalled()
    expect(searchByKeyword).not.toHaveBeenCalled()
    expect(searchBySemantic).not.toHaveBeenCalled()

    expect(searchByExperienceSemantic).toHaveBeenCalled()
    expect(searchByExperienceKeyword).toHaveBeenCalled()
  })

  it("keyword-first overfetch limit propagates to all four retrievers", async () => {
    // limit=10 (default 20 capped) → overfetchLimit=30. Limit=10 is
    // the regression query set's standard. Asserting the overfetch
    // factor is consistent across the four retrievers prevents subtle
    // ranking dilution from RRF when one retriever returns fewer
    // candidates than the others.
    await search(mockStrapi, {
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
      limit: 10,
    })

    const overfetch = 30 // 10 * OVERFETCH_FACTOR (3)
    expect(searchBySemantic).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: overfetch }),
    )
    expect(searchByKeywordWeighted).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: overfetch }),
    )
    expect(searchByTrigram).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: overfetch }),
    )
    expect(searchByExactTitle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: overfetch }),
    )
  })

  it("when embedding fails in keyword-first mode, lexical retrievers still run", async () => {
    // The lexical stack does not depend on the embedding service; only
    // semantic does. A query-embedding failure should not silently kill
    // keyword-first results.
    vi.mocked(embedQuery).mockRejectedValue(new Error("OpenRouter down"))
    vi.mocked(searchByKeywordWeighted).mockResolvedValue([
      {
        videoId: 1,
        videoSlug: "v1",
        videoTitle: "The Bible Project",
        videoCoreId: "bp",
        imageUrl: null,
        description: null,
        rank: 0.9,
      },
    ])

    const response = await search(mockStrapi, {
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
    })

    expect(searchByKeywordWeighted).toHaveBeenCalled()
    expect(searchByTrigram).toHaveBeenCalled()
    expect(searchByExactTitle).toHaveBeenCalled()
    // searchBySemantic was skipped (no embedding available).
    expect(searchBySemantic).not.toHaveBeenCalled()
    // Response signals the degraded mode just like hybrid.
    expect(response.searchMode).toBe("keyword-only")
  })

  it("in keyword-first mode the orchestrator passes 4 ranked video lists to fusion when all return data", async () => {
    vi.mocked(searchBySemantic).mockResolvedValue([
      {
        videoId: 1,
        videoSlug: "v1",
        videoTitle: "Bible Project: Genesis",
        videoCoreId: "bp1",
        imageUrl: null,
        sceneIndex: 0,
        description: "scene",
        startSeconds: 0,
        playbackId: "p",
        similarity: 0.9,
        embeddingText: "[0.1]",
      },
    ])
    vi.mocked(searchByKeywordWeighted).mockResolvedValue([
      {
        videoId: 2,
        videoSlug: "v2",
        videoTitle: "Bible Project: Exodus",
        videoCoreId: "bp2",
        imageUrl: null,
        description: null,
        rank: 0.8,
      },
    ])
    vi.mocked(searchByTrigram).mockResolvedValue([
      {
        videoId: 3,
        videoSlug: "v3",
        videoTitle: "The Bible Project",
        videoCoreId: "bp3",
        imageUrl: null,
        description: null,
        similarity: 0.7,
      },
    ])
    vi.mocked(searchByExactTitle).mockResolvedValue([
      {
        videoId: 4,
        videoSlug: "v4",
        videoTitle: "Bible Project",
        videoCoreId: "bp4",
        imageUrl: null,
        description: null,
        titleLength: 13,
      },
    ])

    await search(mockStrapi, {
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
      contentTypes: ["video"],
    })

    const passedLists = vi.mocked(fuseRankedLists).mock.calls[0]![0]
    expect(passedLists).toHaveLength(4)
  })
})
