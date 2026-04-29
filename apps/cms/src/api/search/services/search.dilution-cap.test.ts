/**
 * Behavior tests for the keyword-first semantic-dilution cap and the
 * origin-gated debug payload (feat-109 unit 4).
 *
 * Both features are post-fusion: they consume the labeled retrieval
 * lists and the fused output. We mock retrievers + fusion so the test
 * controls exactly which lists exist and which fused result was
 * "semantic-only" vs "shared with the keyword side."
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

const SAVED_ENV: Record<string, string | undefined> = {}

beforeEach(() => {
  vi.clearAllMocks()
  __resetSearchHealthForTest()
  SAVED_ENV.SEARCH_DILUTION_CAP_ENABLED =
    process.env.SEARCH_DILUTION_CAP_ENABLED
  SAVED_ENV.NODE_ENV = process.env.NODE_ENV
  SAVED_ENV.SEARCH_DEBUG_ALLOWED_ORIGINS =
    process.env.SEARCH_DEBUG_ALLOWED_ORIGINS

  vi.mocked(embedQuery).mockResolvedValue([0.1])
  vi.mocked(searchByKeyword).mockResolvedValue([])
  vi.mocked(searchByExperienceSemantic).mockResolvedValue([])
  vi.mocked(searchByExperienceKeyword).mockResolvedValue([])
  // Pass-through dedup so we can inspect post-cap order directly.
  vi.mocked(deduplicateResults).mockImplementation(
    (results: ReturnType<typeof fuseRankedLists>) => results,
  )
})

afterEach(() => {
  if (SAVED_ENV.SEARCH_DILUTION_CAP_ENABLED == null) {
    delete process.env.SEARCH_DILUTION_CAP_ENABLED
  } else {
    process.env.SEARCH_DILUTION_CAP_ENABLED =
      SAVED_ENV.SEARCH_DILUTION_CAP_ENABLED
  }
  if (SAVED_ENV.NODE_ENV == null) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = SAVED_ENV.NODE_ENV
  }
  if (SAVED_ENV.SEARCH_DEBUG_ALLOWED_ORIGINS == null) {
    delete process.env.SEARCH_DEBUG_ALLOWED_ORIGINS
  } else {
    process.env.SEARCH_DEBUG_ALLOWED_ORIGINS =
      SAVED_ENV.SEARCH_DEBUG_ALLOWED_ORIGINS
  }
})

/**
 * Build a keyword-first scenario where the exact-title list contains a
 * full-token match (triggers the cap), and the fused output mixes a
 * semantic-only result and a keyword-side result.
 */
function setupBibleProjectScenario({
  semanticVideoCoreId,
}: {
  semanticVideoCoreId: string | null
}) {
  // Semantic returns a video that is NOT The Bible Project.
  vi.mocked(searchBySemantic).mockResolvedValue([
    {
      videoId: 99,
      videoSlug: "unrelated",
      videoTitle: "A Different Video",
      videoCoreId: semanticVideoCoreId,
      imageUrl: null,
      sceneIndex: 0,
      description: "scene about projects in general",
      startSeconds: 0,
      playbackId: "p99",
      similarity: 0.85,
      embeddingText: "[0.1]",
    },
  ])
  // Keyword-weighted returns The Bible Project.
  vi.mocked(searchByKeywordWeighted).mockResolvedValue([
    {
      videoId: 1,
      videoSlug: "bible-project-genesis",
      videoTitle: "The Bible Project: Genesis",
      videoCoreId: "bp-genesis",
      imageUrl: null,
      description: "Genesis overview",
      rank: 0.9,
    },
  ])
  vi.mocked(searchByTrigram).mockResolvedValue([])
  // Exact-title returns a full-token match — triggers the cap.
  vi.mocked(searchByExactTitle).mockResolvedValue([
    {
      videoId: 1,
      videoSlug: "bible-project-genesis",
      videoTitle: "The Bible Project: Genesis",
      videoCoreId: "bp-genesis",
      imageUrl: null,
      description: "Genesis overview",
      titleLength: 27,
    },
  ])
  // Pre-cap fused result: semantic-only result with score 0.8, keyword
  // side with score 0.7. The cap halves the semantic result (no shared
  // core_id), demoting it below the keyword side.
  vi.mocked(fuseRankedLists).mockReturnValue([
    {
      resultType: "video",
      resultId: 99,
      videoId: 99,
      videoSlug: "unrelated",
      videoTitle: "A Different Video",
      videoCoreId: semanticVideoCoreId,
      imageUrl: null,
      description: "scene about projects in general",
      startSeconds: 0,
      playbackId: "p99",
      embeddingText: "[0.1]",
      score: 0.8,
    },
    {
      resultType: "video",
      resultId: 1,
      videoId: 1,
      videoSlug: "bible-project-genesis",
      videoTitle: "The Bible Project: Genesis",
      videoCoreId: "bp-genesis",
      imageUrl: null,
      description: "Genesis overview",
      score: 0.7,
    },
  ])
}

describe("dilution cap (feat-109)", () => {
  it("triggers in keyword-first mode when an exact-title match exists, halving semantic-only score", async () => {
    setupBibleProjectScenario({ semanticVideoCoreId: "unrelated-core" })

    const response = await search(mockStrapi, {
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
    })

    // After cap: semantic 0.8 → 0.4, keyword stays at 0.7 — order flipped.
    expect(response.results.map((r) => r.id)).toEqual([1, 99])
    // 0.4 rounded to 3 decimals
    expect(response.results[1]!.score).toBe(0.4)
  })

  it("does NOT trigger when no exact-title full-token match exists", async () => {
    // Same as above, but exact-title returns a partial match that does
    // not contain every token. Cap should silently no-op.
    vi.mocked(searchBySemantic).mockResolvedValue([
      {
        videoId: 99,
        videoSlug: "unrelated",
        videoTitle: "A Different Video",
        videoCoreId: "unrelated-core",
        imageUrl: null,
        sceneIndex: 0,
        description: "...",
        startSeconds: 0,
        playbackId: "p",
        similarity: 0.85,
        embeddingText: "[0.1]",
      },
    ])
    vi.mocked(searchByKeywordWeighted).mockResolvedValue([])
    vi.mocked(searchByTrigram).mockResolvedValue([])
    vi.mocked(searchByExactTitle).mockResolvedValue([
      {
        videoId: 5,
        videoSlug: "v",
        videoTitle: "Hope When Life Is Hard",
        videoCoreId: "h",
        imageUrl: null,
        description: null,
        titleLength: 22,
      },
    ])
    vi.mocked(fuseRankedLists).mockReturnValue([
      {
        resultType: "video",
        resultId: 99,
        videoId: 99,
        videoSlug: "unrelated",
        videoTitle: "A Different Video",
        videoCoreId: "unrelated-core",
        imageUrl: null,
        description: "...",
        score: 0.8,
      },
    ])

    const response = await search(mockStrapi, {
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
    })

    // Score unchanged — cap did not fire (no title contains "the bible project").
    expect(response.results[0]!.score).toBe(0.8)
  })

  it("does NOT down-weight semantic results that share a core_id with the keyword-side top-N", async () => {
    setupBibleProjectScenario({ semanticVideoCoreId: "bp-genesis" })

    const response = await search(mockStrapi, {
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
    })

    // Semantic result shares core_id with keyword top-N → exempt from cap.
    expect(response.results.map((r) => r.id)).toEqual([99, 1])
    expect(response.results[0]!.score).toBe(0.8)
  })

  it("treats semantic results with null core_id as outside the keyword window (down-weight)", async () => {
    setupBibleProjectScenario({ semanticVideoCoreId: null })

    const response = await search(mockStrapi, {
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
    })

    // Null core_id → cannot prove overlap → down-weighted.
    expect(response.results.map((r) => r.id)).toEqual([1, 99])
  })

  it("treats empty-string core_id identically to null (down-weight)", async () => {
    // Defends against a future migration that defaults core_id to '' —
    // the cap currently treats `cid != null && cid.length > 0` as the
    // shared-coreid signal, so '' falls through to the down-weight path.
    setupBibleProjectScenario({ semanticVideoCoreId: "" })

    const response = await search(mockStrapi, {
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
    })

    expect(response.results.map((r) => r.id)).toEqual([1, 99])
  })

  it("does NOT down-weight experience results even when their score would qualify", async () => {
    // The cap is video-only by construction (line: `if
    // (result.resultType !== 'video') continue`). Mix an experience
    // result into the fused list and assert its score is untouched even
    // when the trigger is hit.
    setupBibleProjectScenario({ semanticVideoCoreId: "unrelated-core" })
    // Override the fused fixture to inject an experience result.
    vi.mocked(fuseRankedLists).mockReturnValue([
      {
        resultType: "video",
        resultId: 99,
        videoId: 99,
        videoSlug: "unrelated",
        videoTitle: "A Different Video",
        videoCoreId: "unrelated-core",
        imageUrl: null,
        description: "scene about projects in general",
        startSeconds: 0,
        playbackId: "p99",
        embeddingText: "[0.1]",
        score: 0.8,
      },
      {
        resultType: "experience",
        resultId: 4,
        experienceId: 4,
        experienceSlug: "easter",
        experienceTitle: "Easter",
        experienceMetaDescription: "Easter snippet",
        imageUrl: null,
        score: 0.75,
      },
      {
        resultType: "video",
        resultId: 1,
        videoId: 1,
        videoSlug: "bible-project-genesis",
        videoTitle: "The Bible Project: Genesis",
        videoCoreId: "bp-genesis",
        imageUrl: null,
        description: "Genesis overview",
        score: 0.7,
      },
    ])

    const response = await search(mockStrapi, {
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
    })

    // Experience score (0.75) is untouched, so it now leads. Video
    // semantic-only (0.8 → 0.4 after cap) demoted below the keyword-
    // side video (0.7). Final order: experience > keyword video >
    // capped semantic.
    const experience = response.results.find((r) => r.type === "experience")!
    expect(experience.score).toBe(0.75)
    expect(response.results.map((r) => r.id)).toEqual([4, 1, 99])
  })

  it("is a no-op when SEARCH_DILUTION_CAP_ENABLED=false", async () => {
    process.env.SEARCH_DILUTION_CAP_ENABLED = "false"

    setupBibleProjectScenario({ semanticVideoCoreId: "unrelated-core" })

    const response = await search(mockStrapi, {
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
    })

    // Cap disabled → semantic-only result keeps its higher score.
    expect(response.results.map((r) => r.id)).toEqual([99, 1])
    expect(response.results[0]!.score).toBe(0.8)
  })

  it("does NOT run on the hybrid path even when the exact-title fixture would trigger it", async () => {
    // Hybrid path doesn't call exact-title, so the cap step is unreachable.
    // This test runs the hybrid pipeline with a fixed fused output and
    // confirms scores are untouched.
    vi.mocked(searchBySemantic).mockResolvedValue([])
    vi.mocked(fuseRankedLists).mockReturnValue([
      {
        resultType: "video",
        resultId: 99,
        videoId: 99,
        videoSlug: "x",
        videoTitle: "X",
        videoCoreId: "x",
        imageUrl: null,
        description: null,
        score: 0.8,
      },
    ])

    const response = await search(mockStrapi, {
      query: "the bible project",
      locale: "en",
      mode: "hybrid",
    })

    expect(response.results[0]!.score).toBe(0.8)
  })
})

describe("debug payload (feat-109)", () => {
  it("attaches debug per result when debug=true (service trusts the boundary's gate)", async () => {
    setupBibleProjectScenario({ semanticVideoCoreId: "unrelated-core" })

    const response = await search(mockStrapi, {
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
      debug: true,
    })

    expect(response.results[0]!.debug).toBeDefined()
    // Keyword winner: contributed via keyword-weighted-video and exact-title-video.
    const keywordWinner = response.results.find((r) => r.id === 1)!
    const labels = keywordWinner
      .debug!.retrieverRanks.map((r) => r.label)
      .sort()
    expect(labels).toEqual(["exact-title-video", "keyword-weighted-video"])
    expect(keywordWinner.debug!.dilutionCapApplied).toBe(false)

    // Semantic loser: contributed only via semantic-video.
    const semanticLoser = response.results.find((r) => r.id === 99)!
    expect(semanticLoser.debug!.retrieverRanks.map((r) => r.label)).toEqual([
      "semantic-video",
    ])
    expect(semanticLoser.debug!.dilutionCapApplied).toBe(true)
    // fusedScore is the PRE-cap score.
    expect(semanticLoser.debug!.fusedScore).toBe(0.8)
  })

  it("omits debug per result when debug=false", async () => {
    setupBibleProjectScenario({ semanticVideoCoreId: "unrelated-core" })

    const response = await search(mockStrapi, {
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
      debug: false,
    })

    for (const result of response.results) {
      expect(result.debug).toBeUndefined()
    }
  })

  it("omits debug when debug is unset (default)", async () => {
    setupBibleProjectScenario({ semanticVideoCoreId: "unrelated-core" })

    const response = await search(mockStrapi, {
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
    })

    for (const result of response.results) {
      expect(result.debug).toBeUndefined()
    }
  })

  it("attaches debug in hybrid mode when debug=true (no dilution cap section)", async () => {
    vi.mocked(searchBySemantic).mockResolvedValue([
      {
        videoId: 1,
        videoSlug: "v",
        videoTitle: "V",
        videoCoreId: "c",
        imageUrl: null,
        sceneIndex: 0,
        description: "...",
        startSeconds: 0,
        playbackId: "p",
        similarity: 0.9,
        embeddingText: "[0.1]",
      },
    ])
    vi.mocked(fuseRankedLists).mockReturnValue([
      {
        resultType: "video",
        resultId: 1,
        videoId: 1,
        videoSlug: "v",
        videoTitle: "V",
        videoCoreId: "c",
        imageUrl: null,
        description: "...",
        score: 0.5,
      },
    ])

    const response = await search(mockStrapi, {
      query: "test",
      locale: "en",
      debug: true,
    })

    expect(response.results[0]!.debug).toBeDefined()
    // Hybrid mode → cap is unreachable → dilutionCapApplied always false.
    expect(response.results[0]!.debug!.dilutionCapApplied).toBe(false)
  })
})
