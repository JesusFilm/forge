/**
 * Default-mode regression test for feat-109.
 *
 * Locks in the byte-identical-default invariant: the orchestrator's
 * response (results, hasMore, query, searchMode) MUST be identical
 * across `mode ∈ {undefined, null, "", "hybrid", "garbage"}` for the
 * same retriever output. The only observable difference between an
 * unknown mode and "hybrid" is a single structured warn log.
 *
 * This test is the gate for every subsequent unit in the keyword-first
 * landing. Unit 3 introduces a new retrieval branch; Unit 4 introduces
 * a post-fusion cap. NEITHER may change the response shape on the
 * default path. If this test fails on any commit after Unit 2, the
 * default-behavior contract is broken.
 *
 * The test deliberately mocks all retrievers + fusion + dedup so the
 * comparison is over the orchestrator's wiring (mode plumbing, embed
 * sequencing, list filtering, response mapping) and not over real DB
 * behavior. A real-DB integration regression test is a follow-up
 * documented in the PR description.
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
import { searchByExperienceKeyword } from "./experience-keyword-search"
import { searchByExperienceSemantic } from "./experience-semantic-search"
import { deduplicateResults, fuseRankedLists } from "./fusion"
import { searchByKeyword } from "./keyword-search"
import { __resetSearchHealthForTest } from "./search-health"
import { searchBySemantic } from "./semantic-search"
import { search } from "./search"

const mockKnex = {}
const logWarn = vi.fn()
const logError = vi.fn()
const mockStrapi = {
  db: { connection: mockKnex },
  log: { warn: logWarn, error: logError },
} as unknown as Parameters<typeof search>[0]

/**
 * Deterministic fixture: one video from semantic, one from keyword, one
 * experience from each. Same data is returned for every test in this file
 * so the only variable across cases is the input `mode` value.
 */
function loadFixedFixture() {
  vi.mocked(embedQuery).mockResolvedValue([0.1, 0.2, 0.3])
  vi.mocked(searchBySemantic).mockResolvedValue([
    {
      videoId: 1,
      videoSlug: "v1",
      videoTitle: "Video One",
      videoCoreId: "c1",
      imageUrl: "https://img/1.jpg",
      sceneIndex: 0,
      description: "scene description",
      startSeconds: 12,
      playbackId: "mux-1",
      similarity: 0.91,
      embeddingText: "[0.1,0.2,0.3]",
    },
  ])
  vi.mocked(searchByKeyword).mockResolvedValue([
    {
      videoId: 2,
      videoSlug: "v2",
      videoTitle: "Video Two",
      videoCoreId: "c2",
      imageUrl: "https://img/2.jpg",
      description: "video two description",
      rank: 0.55,
    },
  ])
  vi.mocked(searchByExperienceSemantic).mockResolvedValue([])
  vi.mocked(searchByExperienceKeyword).mockResolvedValue([])
  vi.mocked(fuseRankedLists).mockReturnValue([
    {
      resultType: "video",
      resultId: 1,
      videoId: 1,
      videoSlug: "v1",
      videoTitle: "Video One",
      videoCoreId: "c1",
      imageUrl: "https://img/1.jpg",
      description: "scene description",
      startSeconds: 12,
      playbackId: "mux-1",
      embeddingText: "[0.1,0.2,0.3]",
      score: 0.94327,
    },
    {
      resultType: "video",
      resultId: 2,
      videoId: 2,
      videoSlug: "v2",
      videoTitle: "Video Two",
      videoCoreId: "c2",
      imageUrl: "https://img/2.jpg",
      description: "video two description",
      score: 0.412,
    },
  ])
  vi.mocked(deduplicateResults).mockImplementation(
    (results: ReturnType<typeof fuseRankedLists>) => results,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetSearchHealthForTest()
  loadFixedFixture()
})

const COMMON_PARAMS = {
  query: "the Bible project",
  locale: "en" as const,
  limit: 10,
}

const DEFAULT_MODE_CASES: Array<{
  label: string
  mode: SearchModeArg
  expectsWarn: boolean
}> = [
  { label: "mode undefined", mode: undefined, expectsWarn: false },
  { label: "mode null", mode: null, expectsWarn: false },
  { label: "mode empty string", mode: "", expectsWarn: false },
  { label: 'mode "hybrid"', mode: "hybrid", expectsWarn: false },
  { label: 'mode "garbage"', mode: "garbage", expectsWarn: true },
]

type SearchModeArg = string | null | undefined

describe("search default-mode regression (feat-109)", () => {
  it("produces byte-identical responses across all default-mode aliases", async () => {
    // Capture the response under no-arg as the baseline.
    const baseline = await search(mockStrapi, { ...COMMON_PARAMS })

    for (const { label, mode } of DEFAULT_MODE_CASES) {
      vi.clearAllMocks()
      __resetSearchHealthForTest()
      loadFixedFixture()

      const response = await search(mockStrapi, {
        ...COMMON_PARAMS,
        mode,
      })

      // JSON.stringify equality is the strongest "byte-identical"
      // assertion we can make at the orchestrator level — it includes
      // key order, score precision, and field presence.
      expect(JSON.stringify(response), `case: ${label}`).toBe(
        JSON.stringify(baseline),
      )
    }
  })

  it.each(DEFAULT_MODE_CASES)(
    "$label -> emits warn iff value is unknown",
    async ({ mode, expectsWarn }) => {
      await search(mockStrapi, { ...COMMON_PARAMS, mode })

      if (expectsWarn) {
        expect(logWarn).toHaveBeenCalledTimes(1)
        const [msg] = logWarn.mock.calls[0]!
        expect(msg).toContain("event=search_unknown_mode")
        expect(msg).toContain(`mode=${mode}`)
        expect(msg).toContain("falling_back=hybrid")
      } else {
        expect(logWarn).not.toHaveBeenCalled()
      }
    },
  )

  it("preserves searchMode response field independent of the input mode", async () => {
    // searchMode reports degradation (hybrid vs keyword-only). It must
    // remain "hybrid" (embedding succeeded) regardless of the input
    // mode value. Locks in the input/output naming-collision
    // disambiguation called out in the plan.
    for (const { mode } of DEFAULT_MODE_CASES) {
      vi.clearAllMocks()
      __resetSearchHealthForTest()
      loadFixedFixture()

      const response = await search(mockStrapi, { ...COMMON_PARAMS, mode })
      expect(response.searchMode).toBe("hybrid")
    }
  })

  it("retains keyword-only degradation independent of input mode", async () => {
    // When the embedding call fails, searchMode flips to "keyword-only".
    // Input mode must NOT mask this signal — operators rely on it for
    // alerting (feat-097 regression).
    for (const { mode } of DEFAULT_MODE_CASES) {
      vi.clearAllMocks()
      __resetSearchHealthForTest()
      loadFixedFixture()
      vi.mocked(embedQuery).mockRejectedValueOnce(
        new Error("OPENROUTER_API_KEY is not set"),
      )

      const response = await search(mockStrapi, { ...COMMON_PARAMS, mode })
      expect(response.searchMode).toBe("keyword-only")
    }
  })
})
