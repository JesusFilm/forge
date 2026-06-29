/**
 * Unit + orchestrator tests for the keyword-first semantic-dilution cap.
 *
 * The cap activates only in keyword-first mode, and only when the
 * exact-title list returned a result whose lowercased title contains
 * every query token. When triggered, semantic-only fused results whose
 * `videoCoreId` is null OR not present in the top-N keyword-side
 * core_ids are down-weighted by `DILUTION_CAP_DOWNWEIGHT` (0.5).
 *
 * Real-DB integration verification (canary diff vs cms keyword-first
 * across a fixed query set × locales) is deferred to R0 readiness;
 * algorithmic correctness is locked in here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  applyDilutionCap,
  DILUTION_CAP_DOWNWEIGHT,
  type SearchResultDebug,
} from "./hybrid-search.service"
import type { FusedResult, RankedItem } from "./hybrid-search-fusion"

const ORIGINAL_FLAG = process.env.SEARCH_DILUTION_CAP_ENABLED

afterEach(() => {
  if (ORIGINAL_FLAG != null) {
    process.env.SEARCH_DILUTION_CAP_ENABLED = ORIGINAL_FLAG
  } else {
    delete process.env.SEARCH_DILUTION_CAP_ENABLED
  }
})

function makeFused(
  resultId: string,
  videoCoreId: string | null,
  score: number,
  videoTitle = "",
): FusedResult {
  return {
    resultType: "video",
    resultId,
    videoCoreId,
    videoTitle,
    score,
  }
}

function makeRanked(
  resultId: string,
  videoCoreId: string | null,
  videoTitle = "",
): RankedItem {
  return {
    resultType: "video",
    resultId,
    videoCoreId,
    videoTitle,
  }
}

function buildDebugByKey(
  labeledLists: Array<{ label: string; list: RankedItem[] }>,
): Map<string, SearchResultDebug> {
  const map = new Map<string, SearchResultDebug>()
  for (const { label, list } of labeledLists) {
    for (let i = 0; i < list.length; i++) {
      const item = list[i]!
      const key = `${item.resultType}:${item.resultId}`
      const existing = map.get(key)
      if (existing == null) {
        map.set(key, {
          retrieverRanks: [{ label, rank: i + 1 }],
          fusedScore: 0,
          dilutionCapApplied: false,
        })
      } else {
        existing.retrieverRanks.push({ label, rank: i + 1 })
      }
    }
  }
  return map
}

function mockHydrationPrisma() {
  return {
    video: { findMany: vi.fn().mockResolvedValue([]) },
    videoLocale: { findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe("applyDilutionCap", () => {
  it("does NOT trigger when no exact-title hit covers every query token", () => {
    // Query: "the bible project". Exact-title list has one item but its
    // title doesn't contain "project" → cap is silent.
    const labeledLists = [
      {
        label: "semantic-video",
        list: [makeRanked("vid-sem-1", "core-A", "Bible Stories")],
      },
      {
        label: "exact-title-video",
        list: [makeRanked("vid-ex-1", "core-B", "Bible Stories")],
      },
    ]
    const fused = [makeFused("vid-sem-1", "core-A", 0.8)]
    const debugByKey = buildDebugByKey(labeledLists)

    applyDilutionCap(fused, labeledLists, "the bible project", debugByKey)

    expect(fused[0]!.score).toBe(0.8)
    expect(debugByKey.get("video:vid-sem-1")!.dilutionCapApplied).toBe(false)
  })

  it("triggers when exact-title list contains a row with every token", () => {
    const labeledLists = [
      {
        label: "semantic-video",
        list: [makeRanked("vid-sem-1", "core-OUT", "Random Themes Video")],
      },
      {
        label: "keyword-weighted-video",
        list: [makeRanked("vid-kw-1", "core-IN", "The Bible Project")],
      },
      {
        label: "exact-title-video",
        list: [makeRanked("vid-ex-1", "core-IN", "The Bible Project")],
      },
    ]
    const fused = [
      makeFused("vid-sem-1", "core-OUT", 0.6, "Random Themes Video"),
      makeFused("vid-kw-1", "core-IN", 0.5, "The Bible Project"),
      makeFused("vid-ex-1", "core-IN", 0.4, "The Bible Project"),
    ]
    const debugByKey = buildDebugByKey(labeledLists)

    applyDilutionCap(fused, labeledLists, "the bible project", debugByKey)

    // vid-sem-1 (semantic-only, core_id NOT in top-N) → down-weighted.
    const semOnly = fused.find((r) => r.resultId === "vid-sem-1")!
    expect(semOnly.score).toBeCloseTo(0.6 * DILUTION_CAP_DOWNWEIGHT)
    expect(debugByKey.get("video:vid-sem-1")!.dilutionCapApplied).toBe(true)

    // vid-kw-1 (in keyword-side, NOT semantic-only) → unchanged.
    const kw = fused.find((r) => r.resultId === "vid-kw-1")!
    expect(kw.score).toBe(0.5)
    expect(debugByKey.get("video:vid-kw-1")!.dilutionCapApplied).toBe(false)
  })

  it("treats null videoCoreId as 'outside top-N' (down-weighted)", () => {
    const labeledLists = [
      {
        label: "semantic-video",
        list: [makeRanked("vid-sem-null", null, "Some Other Video")],
      },
      {
        label: "exact-title-video",
        list: [makeRanked("vid-ex-1", "core-IN", "The Bible Project")],
      },
    ]
    const fused = [makeFused("vid-sem-null", null, 0.7)]
    const debugByKey = buildDebugByKey(labeledLists)

    applyDilutionCap(fused, labeledLists, "the bible project", debugByKey)

    expect(fused[0]!.score).toBeCloseTo(0.7 * DILUTION_CAP_DOWNWEIGHT)
    expect(debugByKey.get("video:vid-sem-null")!.dilutionCapApplied).toBe(true)
  })

  it("exempts semantic-only rows whose videoCoreId IS in the top-N keyword-side allowlist", () => {
    // Same core_id surfaces in semantic-video AND keyword-weighted-video
    // but the fused result is only attributed to semantic-video (rare
    // but possible after dedup). The cap exempts it because the entity
    // is genuinely a keyword winner.
    const labeledLists = [
      {
        label: "semantic-video",
        list: [makeRanked("vid-sem-1", "core-IN", "")],
      },
      {
        label: "trigram-video",
        list: [makeRanked("vid-other", "core-IN", "")],
      },
      {
        label: "exact-title-video",
        list: [makeRanked("vid-ex-1", "core-X", "The Bible Project")],
      },
    ]
    const fused = [makeFused("vid-sem-1", "core-IN", 0.7)]
    const debugByKey = buildDebugByKey(labeledLists)
    // Force semantic-only attribution on vid-sem-1 (it's only on the
    // semantic-video list above, so this is correct).

    applyDilutionCap(fused, labeledLists, "the bible project", debugByKey)

    expect(fused[0]!.score).toBe(0.7)
    expect(debugByKey.get("video:vid-sem-1")!.dilutionCapApplied).toBe(false)
  })

  it("re-sorts after down-weighting", () => {
    const labeledLists = [
      {
        label: "semantic-video",
        list: [makeRanked("vid-sem-high", "core-OUT", "")],
      },
      {
        label: "exact-title-video",
        list: [makeRanked("vid-ex-1", "core-IN", "The Bible Project")],
      },
    ]
    const fused = [
      makeFused("vid-sem-high", "core-OUT", 0.9), // semantic-only, will be halved → 0.45
      makeFused("vid-ex-1", "core-IN", 0.6, "The Bible Project"), // 0.6
    ]
    const debugByKey = buildDebugByKey(labeledLists)

    applyDilutionCap(fused, labeledLists, "the bible project", debugByKey)

    expect(fused.map((r) => r.resultId)).toEqual(["vid-ex-1", "vid-sem-high"])
  })

  it("returns silently when query yields zero tokens (pure punctuation)", () => {
    // Note: vid-sem-1 isn't on any labeled list (semantic-video would
    // contribute it normally; here we just construct the fused result
    // directly to exercise the early-return path). Its score must not
    // change when applyDilutionCap short-circuits on zero tokens.
    const labeledLists = [
      {
        label: "semantic-video",
        list: [makeRanked("vid-sem-1", "core-OUT", "")],
      },
      {
        label: "exact-title-video",
        list: [makeRanked("vid-ex-1", "core-X", "The Bible Project")],
      },
    ]
    const fused = [makeFused("vid-sem-1", "core-OUT", 0.7)]
    const debugByKey = buildDebugByKey(labeledLists)

    // Zero-token query short-circuits before the trigger check —
    // pure-punctuation input cannot satisfy "every token in title".
    applyDilutionCap(fused, labeledLists, "!!!", debugByKey)

    expect(fused[0]!.score).toBe(0.7)
    expect(debugByKey.get("video:vid-sem-1")?.dilutionCapApplied).toBe(false)
  })

  it("never down-weights non-video result types (experience rows pass through)", () => {
    const labeledLists = [
      {
        label: "semantic-experience",
        list: [
          {
            resultType: "experience" as const,
            resultId: "exp-1",
            videoCoreId: null,
          },
        ],
      },
      {
        label: "exact-title-video",
        list: [makeRanked("vid-ex-1", "core-X", "The Bible Project")],
      },
    ]
    const fused: FusedResult[] = [
      {
        resultType: "experience",
        resultId: "exp-1",
        videoCoreId: null,
        score: 0.9,
      },
    ]
    const debugByKey = buildDebugByKey(labeledLists)

    applyDilutionCap(fused, labeledLists, "the bible project", debugByKey)

    // Experience rows must NEVER be touched by the video-side cap, even
    // when an exact-title trigger fires.
    expect(fused[0]!.score).toBe(0.9)
    expect(debugByKey.get("experience:exp-1")?.dilutionCapApplied).toBe(false)
  })

  it("only DILUTION_CAP_TOP_N=3 keyword-side rows per list contribute to the allowlist", () => {
    const labeledLists = [
      {
        label: "semantic-video",
        list: [makeRanked("vid-sem-1", "core-INDEX-4", "")], // 4th in trigram → NOT in top-N
      },
      {
        label: "trigram-video",
        list: [
          makeRanked("vid-t1", "core-INDEX-1", ""),
          makeRanked("vid-t2", "core-INDEX-2", ""),
          makeRanked("vid-t3", "core-INDEX-3", ""),
          makeRanked("vid-t4", "core-INDEX-4", ""),
        ],
      },
      {
        label: "exact-title-video",
        list: [makeRanked("vid-ex-1", "core-X", "The Bible Project")],
      },
    ]
    const fused = [makeFused("vid-sem-1", "core-INDEX-4", 0.8)]
    const debugByKey = buildDebugByKey(labeledLists)

    applyDilutionCap(fused, labeledLists, "the bible project", debugByKey)

    // core-INDEX-4 is the 4th in trigram-video — outside top-3 — so the
    // semantic-only row gets down-weighted.
    expect(fused[0]!.score).toBeCloseTo(0.8 * DILUTION_CAP_DOWNWEIGHT)
  })
})

// -----------------------------------------------------------------------------
// Env-flag parsing for SEARCH_DILUTION_CAP_ENABLED (no orchestrator —
// see the next describe block for the orchestrator-level skip
// behavior).
// -----------------------------------------------------------------------------

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
    tokenizeForExactTitle: (q: string) =>
      q
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length > 0),
  }
})

describe("isDilutionCapEnabled (SEARCH_DILUTION_CAP_ENABLED parser)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("env=undefined → cap enabled", async () => {
    delete process.env.SEARCH_DILUTION_CAP_ENABLED
    const { isDilutionCapEnabled } = await import("./hybrid-search.service")
    expect(isDilutionCapEnabled()).toBe(true)
  })

  it("env='false' → cap disabled", async () => {
    process.env.SEARCH_DILUTION_CAP_ENABLED = "false"
    const { isDilutionCapEnabled } = await import("./hybrid-search.service")
    expect(isDilutionCapEnabled()).toBe(false)
  })

  it("env='0' or 'off' (typo'd off-values) → cap STAYS enabled (documented quirk)", async () => {
    // Per cms-side decision: only the literal string "false" disables.
    // A tolerant parser is a documented follow-up; today this is the
    // safe direction (cap is on by default; an operator typing "0"
    // gets cap-on, not cap-off, until they type "false").
    process.env.SEARCH_DILUTION_CAP_ENABLED = "0"
    const { isDilutionCapEnabled } = await import("./hybrid-search.service")
    expect(isDilutionCapEnabled()).toBe(true)
    process.env.SEARCH_DILUTION_CAP_ENABLED = "off"
    expect(isDilutionCapEnabled()).toBe(true)
  })
})

// -----------------------------------------------------------------------------
// Orchestrator-level: SEARCH_DILUTION_CAP_ENABLED='false' actually
// short-circuits applyDilutionCap when keyword-first mode + exact-title
// trigger are both present.
// -----------------------------------------------------------------------------

describe("HybridSearchService skips dilution cap when SEARCH_DILUTION_CAP_ENABLED='false'", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // Default every retriever to [] — individual tests override the
    // ones whose return values they care about.
    const {
      searchVideoSemantic,
      searchVideoKeyword,
      searchExperienceSemantic,
      searchExperienceKeyword,
    } = await import("./hybrid-search-retrievers")
    const { searchByKeywordWeighted, searchByTrigram, searchByExactTitle } =
      await import("./hybrid-search-keyword-first-retrievers")
    vi.mocked(searchVideoSemantic).mockResolvedValue([])
    vi.mocked(searchVideoKeyword).mockResolvedValue([])
    vi.mocked(searchExperienceSemantic).mockResolvedValue([])
    vi.mocked(searchExperienceKeyword).mockResolvedValue([])
    vi.mocked(searchByKeywordWeighted).mockResolvedValue([])
    vi.mocked(searchByTrigram).mockResolvedValue([])
    vi.mocked(searchByExactTitle).mockResolvedValue([])
  })

  it("env='false' + keyword-first + exact-title trigger → semantic-only score is NOT halved", async () => {
    const { searchVideoSemantic, searchVideoKeyword } =
      await import("./hybrid-search-retrievers")
    const { searchByKeywordWeighted, searchByTrigram, searchByExactTitle } =
      await import("./hybrid-search-keyword-first-retrievers")
    const { HybridSearchService } = await import("./hybrid-search.service")

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
    vi.mocked(searchByKeywordWeighted).mockResolvedValue([])
    vi.mocked(searchByTrigram).mockResolvedValue([])

    process.env.SEARCH_DILUTION_CAP_ENABLED = "false"

    const service = new HybridSearchService({
      prisma: mockHydrationPrisma(),
      embedder: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
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
    // dilutionCapApplied stays false because the cap never ran.
    expect(semOnly!.debug!.dilutionCapApplied).toBe(false)
    // pre-cap fusedScore equals visible score (within rounding) because
    // the cap didn't mutate score.
    expect(semOnly!.score).toBeCloseTo(semOnly!.debug!.fusedScore, 2)
  })

  it("env unset + keyword-first + exact-title trigger → semantic-only IS halved", async () => {
    const { searchVideoSemantic, searchVideoKeyword } =
      await import("./hybrid-search-retrievers")
    const { searchByKeywordWeighted, searchByTrigram, searchByExactTitle } =
      await import("./hybrid-search-keyword-first-retrievers")
    const { HybridSearchService } = await import("./hybrid-search.service")

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
    vi.mocked(searchByKeywordWeighted).mockResolvedValue([])
    vi.mocked(searchByTrigram).mockResolvedValue([])

    delete process.env.SEARCH_DILUTION_CAP_ENABLED

    const service = new HybridSearchService({
      prisma: mockHydrationPrisma(),
      embedder: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      logger: { warn: vi.fn(), error: vi.fn() },
    })
    const result = await service.search({
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
      debug: true,
    })

    const semOnly = result.results.find((r) => r.id === "vid-sem-only")
    expect(semOnly!.debug!.dilutionCapApplied).toBe(true)
    // visible score is half the pre-cap fusedScore.
    expect(semOnly!.score).toBeCloseTo(semOnly!.debug!.fusedScore * 0.5, 2)
  })
})
