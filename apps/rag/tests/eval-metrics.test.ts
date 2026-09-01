/**
 * Unit tests for the eval harness's pure scoring + reporting logic
 * (scripts/eval-metrics.ts). No DB, network, or env — vitest includes tests/**,
 * and the module is side-effect-free. Covers the source-agnostic multi-relevant
 * model: matching against the relevant union, recall@3/@10, coverage, and the
 * per-source coverage breakdown (docs/eval-approach.md).
 */
/* eslint-disable max-lines -- characterization parity with the retained metric suite */
import { describe, expect, it } from "vitest"
import {
  GoldenCaseSchema,
  allRelevantDocuments,
  caseLanguage,
  computeMetrics,
  coverageByLanguage,
  coverageBySource,
  coverageByTier,
  firstMatchingRank,
  renderMarkdown,
  returnedRelevant,
  safePathname,
  type CaseResult,
  type GoldenCase,
  type Hit,
} from "../scripts/lib/evaluation/metrics.js"

const SWG = "starting-with-god"
const CRU = "cru"

function gcase(over: Partial<GoldenCase> = {}): GoldenCase {
  return {
    id: "c1",
    question: "q?",
    relevant: { [SWG]: ["/a.html", "/b.html"], [CRU]: ["/x.html"] },
    ...over,
  }
}

function hit(docPath: string, score = 0.5, sourceKey = SWG): Hit {
  return {
    chunkId: docPath,
    sourceKey,
    docPath,
    docUrl: `https://t.test${docPath}`,
    score,
  }
}

/** Hits where the given relevant paths land at the given 1-indexed ranks; fill the rest with misses. */
function hitsWith(
  at: Record<number, string | [string, string]>,
  len = 10,
): Hit[] {
  return Array.from({ length: len }, (_, i) => {
    const expected = at[i + 1]
    return Array.isArray(expected)
      ? hit(expected[1], 0.5, expected[0])
      : expected
        ? hit(expected)
        : hit(`/miss-${i}.html`)
  })
}

function result(
  c: GoldenCase,
  hits: Hit[],
  language: string | null = "en",
): CaseResult {
  return {
    case: c,
    hits,
    matchedRank: firstMatchingRank(hits, c),
    returnedRelevant: returnedRelevant(hits, c),
    language,
  }
}

describe("GoldenCaseSchema", () => {
  it("accepts a well-formed multi-source case", () => {
    expect(GoldenCaseSchema.safeParse(gcase()).success).toBe(true)
  })

  it("rejects an empty relevant map", () => {
    expect(
      GoldenCaseSchema.safeParse({ id: "c", question: "q", relevant: {} })
        .success,
    ).toBe(false)
  })

  it("rejects a source with no paths", () => {
    expect(
      GoldenCaseSchema.safeParse({
        id: "c",
        question: "q",
        relevant: { [SWG]: [] },
      }).success,
    ).toBe(false)
  })
})

describe("allRelevantDocuments / returnedRelevant / firstMatchingRank", () => {
  it("flattens relevant paths across sources", () => {
    expect(allRelevantDocuments(gcase())).toEqual([
      { sourceKey: SWG, docPath: "/a.html" },
      { sourceKey: SWG, docPath: "/b.html" },
      { sourceKey: CRU, docPath: "/x.html" },
    ])
  })

  it("matches a hit against any relevant path and finds the first rank", () => {
    const hits = hitsWith({ 2: [CRU, "/x.html"], 5: "/a.html" })
    expect(firstMatchingRank(hits, gcase())).toBe(2)
    expect(returnedRelevant(hits, gcase())).toEqual([
      { sourceKey: CRU, docPath: "/x.html" },
      { sourceKey: SWG, docPath: "/a.html" },
    ])
  })

  it("does not credit the right pathname from the wrong source", () => {
    const c = gcase({ relevant: { [CRU]: ["/shared.html"] } })
    const hits = hitsWith({ 1: [SWG, "/shared.html"] })
    expect(firstMatchingRank(hits, c)).toBeNull()
    expect(returnedRelevant(hits, c)).toEqual([])
  })

  it("returns null rank + empty returned set on a miss", () => {
    const hits = hitsWith({})
    expect(firstMatchingRank(hits, gcase())).toBeNull()
    expect(returnedRelevant(hits, gcase())).toEqual([])
  })
})

describe("computeMetrics", () => {
  it("computes recall@3/@10, coverage, MRR, P@1", () => {
    const c = gcase() // 3 relevant paths
    const results = [
      result(c, hitsWith({ 1: "/a.html", 4: [CRU, "/x.html"] })), // rank 1; 2/3 covered
      result(c, hitsWith({ 9: "/b.html" })), // rank 9 (in @10, not @3); 1/3 covered
      result(c, hitsWith({})), // miss; 0/3
    ]
    const m = computeMetrics(results)
    expect(m.cases).toBe(3)
    expect(m.recall_at_3).toBeCloseTo(1 / 3, 5) // only the rank-1 case
    expect(m.recall_at_10).toBeCloseTo(2 / 3, 5) // rank 1 and rank 9
    expect(m.precision_at_1).toBeCloseTo(1 / 3, 5)
    expect(m.mrr).toBeCloseTo((1 + 1 / 9) / 3, 5)
    expect(m.coverage).toBeCloseTo((2 / 3 + 1 / 3 + 0) / 3, 5)
  })

  it("is zero (not NaN) for an empty set", () => {
    expect(computeMetrics([])).toMatchObject({
      cases: 0,
      recall_at_10: 0,
      coverage: 0,
    })
  })

  it("counts a shared pathname once per source identity", () => {
    const c = gcase({
      relevant: { [SWG]: ["/shared.html"], [CRU]: ["/shared.html"] },
    })
    expect(allRelevantDocuments(c)).toHaveLength(2)
    const m = computeMetrics([result(c, hitsWith({ 1: "/shared.html" }))])
    expect(m.coverage).toBeCloseTo(0.5, 5)
  })
})

describe("coverageBySource", () => {
  it("reports per-source recall + coverage over cases where the source is relevant", () => {
    // c1: SWG[/a,/b] + CRU[/x]; c2: CRU[/x,/y] only
    const c1 = gcase({ id: "c1" })
    const c2 = gcase({ id: "c2", relevant: { [CRU]: ["/x.html", "/y.html"] } })
    const results = [
      result(c1, hitsWith({ 1: "/a.html", 2: [CRU, "/x.html"] })), // SWG 1/2, CRU 1/1
      result(c2, hitsWith({ 3: [CRU, "/x.html"] })), // CRU 1/2
    ]
    const bd = coverageBySource(results)
    expect(bd.map((b) => b.source)).toEqual([CRU, SWG]) // sorted

    const cru = bd.find((b) => b.source === CRU)!
    expect(cru.cases).toBe(2) // relevant in both
    expect(cru.recall).toBeCloseTo(2 / 2, 5) // got >=1 in both
    expect(cru.coverage).toBeCloseTo((1 / 1 + 1 / 2) / 2, 5)

    const swg = bd.find((b) => b.source === SWG)!
    expect(swg.cases).toBe(1) // only c1 has SWG
    expect(swg.coverage).toBeCloseTo(1 / 2, 5) // /a returned, /b not
  })
})

describe("coverageByLanguage — a multi-language source blends its languages in the per-source view", () => {
  it("splits cases by their resolved retrieval language", () => {
    // Both cases credit ONLY cru, but in different languages — exactly the
    // ADR-0006 shape the per-source view cannot distinguish.
    const en = gcase({ id: "en1", relevant: { [CRU]: ["/x.html"] } })
    const es = gcase({ id: "es1", relevant: { [CRU]: ["/y.html"] } })
    const results = [
      result(en, hitsWith({ 1: [CRU, "/x.html"] }), "en"), // hit
      result(es, hitsWith({}), "es"), // miss — the es half is unhealthy
    ]

    // The per-source view averages the two into a misleading middle.
    const bySource = coverageBySource(results).find((s) => s.source === CRU)!
    expect(bySource.recall).toBeCloseTo(0.5, 5)

    // The per-language view exposes which half is broken.
    const byLang = coverageByLanguage(results)
    expect(byLang.map((l) => l.language)).toEqual(["en", "es"]) // sorted
    expect(byLang.find((l) => l.language === "en")!.recall_at_10).toBeCloseTo(
      1,
      5,
    )
    expect(byLang.find((l) => l.language === "es")!.recall_at_10).toBeCloseTo(
      0,
      5,
    )
  })

  it("surfaces cases with no derivable language under (unscoped) rather than dropping them", () => {
    const c = gcase({ id: "amb", relevant: { [CRU]: ["/x.html"] } })
    const byLang = coverageByLanguage([
      result(c, hitsWith({ 1: [CRU, "/x.html"] }), null),
    ])
    expect(byLang.map((l) => l.language)).toEqual(["(unscoped)"])
    expect(byLang[0].cases).toBe(1)
  })
})

describe("coverageByTier — machine-translated evidence is never averaged into checked evidence", () => {
  it("splits cases by evidence_tier and keeps untagged cases in their own bucket", () => {
    // The campaign shape: a language the operator can check retrieves well, one
    // they approved on a machine translation does not. A single mean would read
    // as 0.5 and say nothing about which half to trust.
    const checked = gcase({
      id: "de1",
      evidence_tier: "human-verified",
      relevant: { [CRU]: ["/x.html"] },
    })
    const translated = gcase({
      id: "ti1",
      evidence_tier: "llm-translated",
      relevant: { [CRU]: ["/y.html"] },
    })
    const legacy = gcase({ id: "old1", relevant: { [CRU]: ["/z.html"] } })
    const results = [
      result(checked, hitsWith({ 1: [CRU, "/x.html"] }), "de"),
      result(translated, hitsWith({}), "ti"),
      result(legacy, hitsWith({ 1: [CRU, "/z.html"] }), "en"),
    ]

    const byTier = coverageByTier(results)
    expect(byTier.map((t) => t.tier)).toEqual([
      "(untagged)",
      "human-verified",
      "llm-translated",
    ])
    expect(
      byTier.find((t) => t.tier === "human-verified")!.recall_at_10,
    ).toBeCloseTo(1, 5)
    expect(
      byTier.find((t) => t.tier === "llm-translated")!.recall_at_10,
    ).toBeCloseTo(0, 5)
  })

  it("does NOT retro-label an untagged case as human-verified", () => {
    // The 130 pre-campaign cases predate the tier. Defaulting them to
    // "human-verified" would assert something nobody can now check.
    const byTier = coverageByTier([
      result(gcase({ id: "old" }), hitsWith({ 1: "/a.html" })),
    ])
    expect(byTier.map((t) => t.tier)).toEqual(["(untagged)"])
  })

  it("rejects an evidence_tier outside the sanctioned set", () => {
    const parsed = GoldenCaseSchema.safeParse({
      id: "c",
      question: "q",
      evidence_tier: "vibes",
      relevant: { [CRU]: ["/a.html"] },
    })
    expect(parsed.success).toBe(false)
  })
})

describe("renderMarkdown", () => {
  it("includes coverage, per-source + per-language + per-tier coverage, and a per-case coverage column", () => {
    const c = gcase()
    const results = [result(c, hitsWith({ 1: "/a.html", 2: "/x.html" }))]
    const md = renderMarkdown({
      modelId: "openai/text-embedding-3-small",
      topK: 10,
      scope: null,
      results,
      metrics: computeMetrics(results),
      perSource: coverageBySource(results),
      perLanguage: coverageByLanguage(results),
      perTier: coverageByTier(results),
    })
    expect(md).toContain("| coverage |")
    expect(md).toContain("## Per-source coverage")
    expect(md).toContain("## Per-language coverage")
    expect(md).toContain("## Per-evidence-tier coverage")
    expect(md).toContain("first rank")
  })

  it("escapes backslashes and table separators in case questions", () => {
    const c = gcase({ question: String.raw`path\name | question` })
    const results = [result(c, hitsWith({ 1: "/a.html" }))]
    const md = renderMarkdown({
      modelId: "model",
      topK: 10,
      scope: null,
      results,
      metrics: computeMetrics(results),
      perSource: coverageBySource(results),
      perLanguage: coverageByLanguage(results),
      perTier: coverageByTier(results),
    })

    expect(md).toContain(String.raw`path\\name \| question`)
  })
})

describe("safePathname", () => {
  it("extracts the pathname", () => {
    expect(safePathname("https://x.test/a/b.html?q=1")).toBe("/a/b.html")
  })

  it("falls back to the raw string on a non-URL", () => {
    expect(safePathname("not a url")).toBe("not a url")
  })
})

describe("caseLanguage — per-case retrieval language scoping (eval must search the case's source language only)", () => {
  const LANGS = {
    "starting-with-god": ["en"],
    cru: ["en"],
    "thelife-fr": ["fr"],
    "thelife-zh": ["zh"],
  }

  it("derives the single language shared by every relevant source", () => {
    const c = gcase({ relevant: { "thelife-fr": ["/dieu-existe-t-il"] } })
    expect(caseLanguage(c, LANGS)).toBe("fr")
  })

  it("derives 'en' for a case spanning multiple English sources", () => {
    const c = gcase() // SWG + CRU, both en
    expect(caseLanguage(c, LANGS)).toBe("en")
  })

  it("returns null (no filter) when relevant sources span languages", () => {
    const c = gcase({
      relevant: { "starting-with-god": ["/a.html"], "thelife-zh": ["/pray"] },
    })
    expect(caseLanguage(c, LANGS)).toBeNull()
  })

  it("returns null when a relevant source is unknown to the registry map", () => {
    const c = gcase({ relevant: { "not-registered": ["/a.html"] } })
    expect(caseLanguage(c, LANGS)).toBeNull()
  })

  it("returns null for a single multilingual source (ambiguous without an explicit language)", () => {
    const c = gcase({ relevant: { multi: ["/a.html"] } })
    expect(caseLanguage(c, { multi: ["en", "fr"] })).toBeNull()
  })

  it("intersects multilingual sources with monolingual ones (familylife en+es ∩ thelife en = en)", () => {
    const c = gcase({
      relevant: { familylife: ["/a.html"], thelife: ["/b.html"] },
    })
    expect(caseLanguage(c, { familylife: ["en", "es"], thelife: ["en"] })).toBe(
      "en",
    )
  })

  it("returns null when the intersection is empty", () => {
    const c = gcase({ relevant: { a: ["/a.html"], b: ["/b.html"] } })
    expect(caseLanguage(c, { a: ["fr"], b: ["zh"] })).toBeNull()
  })

  it("an explicit case language always wins", () => {
    const c = gcase({
      language: "en",
      relevant: { multi: ["/a.html"] },
    })
    expect(caseLanguage(c, { multi: ["en", "es"] })).toBe("en")
  })
})
