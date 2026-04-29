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
// Orchestrator-level: env flag wiring + skip-on-hybrid-mode invariant.
// -----------------------------------------------------------------------------

describe("orchestrator: dilution cap respects SEARCH_DILUTION_CAP_ENABLED", () => {
  vi.mock("./hybrid-search-retrievers", () => ({
    searchVideoSemantic: vi.fn().mockResolvedValue([]),
    searchVideoKeyword: vi.fn().mockResolvedValue([]),
    searchExperienceSemantic: vi.fn().mockResolvedValue([]),
    searchExperienceKeyword: vi.fn().mockResolvedValue([]),
  }))

  vi.mock("./hybrid-search-keyword-first-retrievers", () => ({
    searchByKeywordWeighted: vi.fn(),
    searchByTrigram: vi.fn(),
    searchByExactTitle: vi.fn(),
    MAX_EXACT_TITLE_TOKENS: 16,
    tokenizeForExactTitle: (q: string) => q.toLowerCase().split(/\s+/),
  }))

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
