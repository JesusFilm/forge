import { describe, expect, it, vi } from "vitest"

import type { Judge } from "./judge"
import { _internal, runEval } from "./runner"
import type { SearchClient } from "./search-client"
import type {
  Baseline,
  CalibrationReport,
  Fingerprint,
  SearchResult,
  Verdict,
} from "./types"

const baselineFp: Fingerprint = {
  sceneEmbeddings: { count: 100, maxUpdatedAt: "2026-05-01T00:00:00.000Z" },
  transcriptEmbeddings: {
    count: 200,
    maxUpdatedAt: "2026-05-01T00:00:00.000Z",
  },
  experiences: { count: 10, maxUpdatedAt: "2026-05-01T00:00:00.000Z" },
}

function r(id: string, overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    type: "video",
    id,
    slug: id,
    title: `Title ${id}`,
    imageUrl: null,
    snippet: `Snippet ${id}`,
    startSeconds: 0,
    playbackId: null,
    score: 0.5,
    ...overrides,
  }
}

function makeBaseline(): Baseline {
  return {
    schemaVersion: "1",
    name: "default",
    capturedAt: "2026-05-07T00:00:00.000Z",
    gitSha: "base1234",
    contentFingerprint: baselineFp,
    queries: [
      {
        locale: "en",
        query: "hope",
        source: "synthetic",
        results: [r("a"), r("b")],
      },
      {
        locale: "fr",
        query: "espoir",
        source: "synthetic",
        results: [r("c"), r("d")],
      },
      {
        locale: "fr",
        query: "regression-1",
        source: "regression",
        results: [r("e")],
      },
    ],
  }
}

function judgeStub(plan: Record<string, [Verdict, Verdict]>): Judge {
  // Map keyed by query text; values are [forward, swapped] verdicts.
  // Stateful: first call per-query returns the forward verdict, second
  // returns the swapped verdict.
  const counts: Record<string, number> = {}
  const stateful = vi.fn(async (input: { query: string }) => {
    const idx = counts[input.query] ?? 0
    counts[input.query] = idx + 1
    const pair = plan[input.query]
    if (!pair) throw new Error(`no plan for query ${input.query}`)
    const verdict = pair[idx as 0 | 1]
    return {
      verdict,
      rationale: `stub for ${input.query}/${idx === 0 ? "forward" : "swapped"}`,
      tokens: { input: 100, output: 50 },
      attempts: 1,
      model: "stub-model",
    }
  })
  return {
    model: "stub-model",
    judgePair: stateful as unknown as Judge["judgePair"],
  }
}

function searchClientStub(
  byQuery: Record<string, SearchResult[]>,
): SearchClient {
  return {
    search: vi.fn(async (query: string) => {
      if (!(query in byQuery)) {
        throw new Error(`no stub for ${query}`)
      }
      return byQuery[query]!
    }),
  }
}

const calibrationStub: CalibrationReport = {
  passed: true,
  matched: 3,
  total: 3,
  cases: [],
}

async function runWithFixture(opts: {
  judge: Judge
  searchClient: SearchClient
  fingerprint?: Fingerprint
  mode?: "quick" | "full" | "locale"
  filterLocale?: string
  baseline?: Baseline
}) {
  return runEval({
    mode: opts.mode ?? "full",
    filterLocale: opts.filterLocale,
    judge: opts.judge,
    searchClient: opts.searchClient,
    baselineOverride: opts.baseline ?? makeBaseline(),
    readFingerprintImpl: async () => opts.fingerprint ?? baselineFp,
    runCalibrationImpl: async () => calibrationStub,
    now: () => new Date("2026-05-07T12:34:56.000Z"),
    gitSha: "test1234",
  })
}

describe("runEval", () => {
  it("returns a fully populated RunReport on a happy path", async () => {
    const judge = judgeStub({
      hope: ["clearly-B-better", "clearly-A-better"], // current better both ways → win
      espoir: ["clearly-A-better", "clearly-B-better"], // baseline better both ways → loss
      "regression-1": ["tie", "tie"], // tie
    })
    const search = searchClientStub({
      hope: [r("a"), r("b")],
      espoir: [r("c"), r("d")],
      "regression-1": [r("e")],
    })

    const report = await runWithFixture({ judge, searchClient: search })

    expect(report.totals.queries).toBe(3)
    expect(report.totals.wins).toBe(1)
    expect(report.totals.losses).toBe(1)
    expect(report.totals.ties).toBe(1)
    expect(report.totals.bothIrrelevant).toBe(0)
    expect(report.totals.netWinRate).toBe(0)
    expect(report.cost.totalUsd).toBeGreaterThan(0)
    expect(report.runId).toContain("test1234")
    expect(report.judgeModel).toBe("stub-model")
    expect(report.calibration).toEqual(calibrationStub)
  })

  it("collapses A/B-swap disagreement into judge-disagreement", async () => {
    const judge = judgeStub({
      hope: ["clearly-B-better", "clearly-B-better"], // current better; baseline better — disagreement
      espoir: ["tie", "tie"],
      "regression-1": ["tie", "tie"],
    })
    const search = searchClientStub({
      hope: [r("a")],
      espoir: [r("c")],
      "regression-1": [r("e")],
    })

    const report = await runWithFixture({ judge, searchClient: search })
    const disagreementOutcome = report.outcomes.find(
      (o) => o.kind === "judge-disagreement",
    )
    expect(disagreementOutcome).toBeDefined()
    expect(report.totals.judgeDisagreements).toBe(1)
    expect(report.totals.ties).toBeGreaterThanOrEqual(1)
  })

  it("excludes both-irrelevant from net-win-rate denominator", async () => {
    const judge = judgeStub({
      hope: ["clearly-B-better", "clearly-A-better"],
      espoir: ["both-irrelevant", "both-irrelevant"],
      "regression-1": ["both-irrelevant", "both-irrelevant"],
    })
    const search = searchClientStub({
      hope: [r("a")],
      espoir: [r("c")],
      "regression-1": [r("e")],
    })

    const report = await runWithFixture({ judge, searchClient: search })
    expect(report.totals.bothIrrelevant).toBe(2)
    expect(report.totals.wins).toBe(1)
    // 1 win, 0 losses, 2 both-irrelevant → denom = 3 - 2 = 1; net = 1/1 = 1
    expect(report.totals.netWinRate).toBe(1)
  })

  it("reports drift when fingerprint diverges from baseline", async () => {
    const judge = judgeStub({
      hope: ["tie", "tie"],
      espoir: ["tie", "tie"],
      "regression-1": ["tie", "tie"],
    })
    const search = searchClientStub({
      hope: [r("a")],
      espoir: [r("c")],
      "regression-1": [r("e")],
    })
    const driftedFp: Fingerprint = {
      ...baselineFp,
      sceneEmbeddings: { ...baselineFp.sceneEmbeddings, count: 1000 },
    }
    const report = await runWithFixture({
      judge,
      searchClient: search,
      fingerprint: driftedFp,
    })
    expect(report.drift.detected).toBe(true)
    expect(report.drift.details).toContain("scene+900")
  })

  it("filters by --quick (drops non-quick locales)", async () => {
    // Add a Tier-3 locale ("pl") to the baseline; quick mode should
    // drop it and keep only the en/fr queries which are in QUICK_LOCALES.
    const baselineWithTier3 = makeBaseline()
    baselineWithTier3.queries.push({
      locale: "pl",
      query: "polish-only",
      source: "synthetic",
      results: [r("p1")],
    })
    const judge = judgeStub({
      hope: ["tie", "tie"],
      espoir: ["tie", "tie"],
      "regression-1": ["tie", "tie"],
    })
    const search = searchClientStub({
      hope: [r("a")],
      espoir: [r("c")],
      "regression-1": [r("e")],
    })
    const report = await runWithFixture({
      judge,
      searchClient: search,
      baseline: baselineWithTier3,
      mode: "quick",
    })
    expect(report.totals.queries).toBe(3) // en + fr + fr; pl dropped
    const localesSeen = new Set(report.outcomes.map((o) => o.locale))
    expect(localesSeen.has("pl")).toBe(false)
  })

  it("filters by --locale=fr", async () => {
    const judge = judgeStub({
      espoir: ["tie", "tie"],
      "regression-1": ["tie", "tie"],
    })
    const search = searchClientStub({
      espoir: [r("c")],
      "regression-1": [r("e")],
    })
    const report = await runWithFixture({
      judge,
      searchClient: search,
      mode: "locale",
      filterLocale: "fr",
    })
    expect(report.totals.queries).toBe(2)
    for (const o of report.outcomes) {
      expect(o.locale).toBe("fr")
    }
  })

  it("treats search failures as ties (run continues)", async () => {
    const judge = judgeStub({
      hope: ["tie", "tie"],
      espoir: ["tie", "tie"],
      "regression-1": ["tie", "tie"],
    })
    const failingSearch: SearchClient = {
      search: vi.fn(async (query: string) => {
        if (query === "hope") throw new Error("admin unreachable")
        return [r(`x_${query}`)]
      }),
    }
    const report = await runWithFixture({ judge, searchClient: failingSearch })
    expect(report.totals.queries).toBe(3)
    // hope's outcome should be a "tie" with rationale mentioning the
    // search failure (it never reached the judge).
    const hopeOutcome = report.outcomes.find((o) => o.query === "hope")
    expect(hopeOutcome?.kind).toBe("tie")
  })
})

describe("collapseSwapVerdicts (internal)", () => {
  const c = _internal.collapseSwapVerdicts

  it("treats forward=B-better + swapped=A-better as win", () => {
    expect(c("clearly-B-better", "clearly-A-better")).toBe("win")
    expect(c("slightly-B-better", "slightly-A-better")).toBe("win")
  })

  it("treats forward=A-better + swapped=B-better as loss", () => {
    expect(c("clearly-A-better", "clearly-B-better")).toBe("loss")
  })

  it("treats both-tie as tie", () => {
    expect(c("tie", "tie")).toBe("tie")
  })

  it("treats both-both-irrelevant as both-irrelevant", () => {
    expect(c("both-irrelevant", "both-irrelevant")).toBe("both-irrelevant")
  })

  it("mismatched 'both-irrelevant' on one side becomes disagreement", () => {
    expect(c("both-irrelevant", "tie")).toBe("judge-disagreement")
  })

  it("mismatched directions become judge-disagreement", () => {
    expect(c("clearly-A-better", "tie")).toBe("judge-disagreement")
    expect(c("tie", "clearly-A-better")).toBe("judge-disagreement")
    expect(c("clearly-A-better", "clearly-A-better")).toBe("judge-disagreement")
  })
})

describe("snippet-improvement heuristic", () => {
  it("triggers when most baseline IDs reappear AND net win rate is high", async () => {
    const judge = judgeStub({
      hope: ["clearly-B-better", "clearly-A-better"],
      espoir: ["clearly-B-better", "clearly-A-better"],
      "regression-1": ["clearly-B-better", "clearly-A-better"],
    })
    // current results contain the same IDs as baseline (high overlap)
    const search = searchClientStub({
      hope: [r("a"), r("b")],
      espoir: [r("c"), r("d")],
      "regression-1": [r("e")],
    })
    const report = await runWithFixture({ judge, searchClient: search })
    expect(report.totals.netWinRate).toBe(1)
    expect(report.snippetImprovementHeuristic).toBe(true)
  })

  it("does NOT trigger when current results are entirely new", async () => {
    const judge = judgeStub({
      hope: ["clearly-B-better", "clearly-A-better"],
      espoir: ["clearly-B-better", "clearly-A-better"],
      "regression-1": ["clearly-B-better", "clearly-A-better"],
    })
    // current results have different IDs from baseline
    const search = searchClientStub({
      hope: [r("xa"), r("xb")],
      espoir: [r("xc"), r("xd")],
      "regression-1": [r("xe")],
    })
    const report = await runWithFixture({ judge, searchClient: search })
    expect(report.totals.netWinRate).toBe(1)
    expect(report.snippetImprovementHeuristic).toBe(false)
  })
})
