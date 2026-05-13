import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { renderConsoleSummary, writeRunJson } from "./reporter"
import type { Outcome, RunReport, SearchResult, Verdict } from "./types"

function r(id: string): SearchResult {
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
  }
}

function makeWin(query: string, locale: string): Outcome {
  return {
    kind: "win",
    query,
    locale,
    tier: 1,
    source: "synthetic",
    baselineResults: [r(`base_${query}`)],
    currentResults: [r(`curr_${query}`)],
    verdicts: ["clearly-B-better", "clearly-A-better"] as [Verdict, Verdict],
    rationale: "current list is clearly more relevant",
  }
}

function makeLoss(
  query: string,
  locale: string,
  confidence: "clearly" | "slightly" = "clearly",
): Outcome {
  return {
    kind: "loss",
    query,
    locale,
    tier: 1,
    source: "synthetic",
    baselineResults: [r(`base_${query}`)],
    currentResults: [r(`curr_${query}`)],
    verdicts:
      confidence === "clearly"
        ? (["clearly-A-better", "clearly-B-better"] as [Verdict, Verdict])
        : (["slightly-A-better", "slightly-B-better"] as [Verdict, Verdict]),
    rationale: `baseline ${confidence} preferred for ${query}`,
  }
}

function makeReport(overrides: Partial<RunReport> = {}): RunReport {
  return {
    schemaVersion: "1",
    runId: "2026-05-07-1430-abc12345",
    startedAt: "2026-05-07T14:30:00.000Z",
    finishedAt: "2026-05-07T14:35:00.000Z",
    gitSha: "abc12345",
    mode: "full",
    filterLocale: null,
    judgeModel: "anthropic/claude-haiku-4-5",
    baseline: {
      name: "default",
      capturedAt: "2026-05-01T00:00:00.000Z",
      gitSha: "base1234",
    },
    contentFingerprint: {
      sceneEmbeddings: { count: 100, maxUpdatedAt: null },
      transcriptEmbeddings: { count: 200, maxUpdatedAt: null },
      experiences: { count: 10, maxUpdatedAt: null },
    },
    drift: { detected: false, details: "no drift since baseline" },
    calibration: { passed: true, matched: 10, total: 10, cases: [] },
    totals: {
      queries: 4,
      wins: 2,
      losses: 1,
      ties: 1,
      bothIrrelevant: 0,
      judgeDisagreements: 0,
      netWinRate: 0.25,
    },
    perLocale: {
      en: {
        tier: 1,
        queries: 2,
        wins: 1,
        losses: 1,
        ties: 0,
        bothIrrelevant: 0,
        netWinRate: 0,
      },
      fr: {
        tier: 1,
        queries: 2,
        wins: 1,
        losses: 0,
        ties: 1,
        bothIrrelevant: 0,
        netWinRate: 0.5,
      },
    },
    cost: { inputTokens: 12345, outputTokens: 1234, totalUsd: 0.018 },
    snippetImprovementHeuristic: false,
    outcomes: [
      makeWin("hope", "en"),
      makeLoss("forgiveness", "en"),
      makeWin("espoir", "fr"),
      {
        kind: "tie",
        query: "amour",
        locale: "fr",
        tier: 1,
        source: "synthetic",
        baselineResults: [r("base_amour")],
        currentResults: [r("base_amour")],
        verdicts: ["tie", "tie"],
        rationale: "lists are equivalent",
      },
    ],
    ...overrides,
  }
}

describe("writeRunJson", () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "reporter-test-"))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it("writes a JSON file at runs/{runId}.json", async () => {
    const report = makeReport()
    const { path: written } = await writeRunJson(report, { directory: tmp })
    expect(written).toBe(path.join(tmp, `${report.runId}.json`))
    const round = JSON.parse(await readFile(written, "utf8"))
    expect(round.runId).toBe(report.runId)
    expect(round.totals.netWinRate).toBe(0.25)
  })

  it("creates the directory if missing", async () => {
    const nested = path.join(tmp, "deep/nested/runs")
    const report = makeReport()
    await writeRunJson(report, { directory: nested })
    const round = JSON.parse(
      await readFile(path.join(nested, `${report.runId}.json`), "utf8"),
    )
    expect(round.runId).toBe(report.runId)
  })
})

describe("renderConsoleSummary", () => {
  it("includes header + headline + per-locale + cost + JSON path", () => {
    const out = renderConsoleSummary(makeReport())
    expect(out).toContain("Semantic search eval")
    expect(out).toContain("runId:")
    expect(out).toContain("Net win rate: +0.250")
    expect(out).toContain("2 wins")
    expect(out).toContain("1 losses")
    expect(out).toContain("Per-locale")
    expect(out).toContain("Cost:")
    expect(out).toContain(
      "apps/admin/.tmp/eval/runs/2026-05-07-1430-abc12345.json",
    )
  })

  it("uses '+' for positive and '−'-style for negative net win rate", () => {
    const positive = renderConsoleSummary(
      makeReport({
        totals: {
          ...makeReport().totals,
          netWinRate: 0.3,
        },
      }),
    )
    const negative = renderConsoleSummary(
      makeReport({
        totals: {
          ...makeReport().totals,
          netWinRate: -0.3,
        },
      }),
    )
    const zero = renderConsoleSummary(
      makeReport({
        totals: {
          ...makeReport().totals,
          netWinRate: 0,
        },
      }),
    )
    expect(positive).toContain("Net win rate: +0.300")
    expect(negative).toContain("Net win rate: -0.300")
    expect(zero).toContain("Net win rate: ±0.000")
  })

  it("renders drift warning when drift detected", () => {
    const out = renderConsoleSummary(
      makeReport({
        drift: { detected: true, details: "Δrows: scene+512" },
      }),
    )
    expect(out).toContain("INDEXED CONTENT DRIFTED")
    expect(out).toContain("scene+512")
  })

  it("does NOT render drift warning when no drift", () => {
    const out = renderConsoleSummary(makeReport())
    expect(out).not.toContain("INDEXED CONTENT DRIFTED")
  })

  it("renders calibration PASS line", () => {
    const out = renderConsoleSummary(makeReport())
    expect(out).toContain("Calibration: PASS")
  })

  it("renders calibration FAIL line + failed-case detail", () => {
    const out = renderConsoleSummary(
      makeReport({
        calibration: {
          passed: false,
          matched: 5,
          total: 10,
          cases: [
            {
              id: "c1",
              expected: "tie",
              observed: "clearly-A-better",
              pass: false,
            },
            { id: "c2", expected: "tie", observed: "tie", pass: true },
          ],
        },
      }),
    )
    expect(out).toContain("JUDGE CALIBRATION FAILED")
    expect(out).toContain("c1: expected=tie observed=clearly-A-better")
  })

  it("renders top regressions sorted by judge confidence", () => {
    const out = renderConsoleSummary(
      makeReport({
        outcomes: [
          makeLoss("low-conf", "en", "slightly"),
          makeLoss("high-conf", "en", "clearly"),
        ],
      }),
    )
    const lowIdx = out.indexOf("low-conf")
    const highIdx = out.indexOf("high-conf")
    expect(highIdx).toBeLessThan(lowIdx)
    expect(highIdx).toBeGreaterThan(-1)
  })

  it("limits regressions to top 10", () => {
    const losses = Array.from({ length: 15 }, (_, i) =>
      makeLoss(`loss-${i}`, "en"),
    )
    const out = renderConsoleSummary(makeReport({ outcomes: losses }))
    // Each rendered regression spans two lines (title + rationale)
    // and the query token appears in both, so dedupe via a set.
    const matches = out.match(/loss-\d+/g) ?? []
    expect(new Set(matches).size).toBe(10)
  })

  it("includes snippet-improvement caveat when flag is true", () => {
    const out = renderConsoleSummary(
      makeReport({ snippetImprovementHeuristic: true }),
    )
    expect(out).toContain("Snippet-improvement heuristic triggered")
  })

  it("omits snippet-improvement caveat when flag is false", () => {
    const out = renderConsoleSummary(makeReport())
    expect(out).not.toContain("Snippet-improvement heuristic")
  })

  it("flags judge disagreements when nonzero", () => {
    const out = renderConsoleSummary(
      makeReport({
        totals: {
          ...makeReport().totals,
          judgeDisagreements: 3,
        },
      }),
    )
    expect(out).toContain("judge disagreements: 3")
  })

  it("renders SKIPPED calibration when total=0", () => {
    const out = renderConsoleSummary(
      makeReport({
        calibration: { passed: true, matched: 0, total: 0, cases: [] },
      }),
    )
    expect(out).toContain("Calibration: SKIPPED")
  })

  it("sorts per-locale rows by |net win rate| descending", () => {
    const out = renderConsoleSummary(
      makeReport({
        perLocale: {
          en: {
            tier: 1,
            queries: 1,
            wins: 0,
            losses: 0,
            ties: 1,
            bothIrrelevant: 0,
            netWinRate: 0,
          },
          fr: {
            tier: 1,
            queries: 1,
            wins: 1,
            losses: 0,
            ties: 0,
            bothIrrelevant: 0,
            netWinRate: 1,
          },
          de: {
            tier: 1,
            queries: 1,
            wins: 0,
            losses: 1,
            ties: 0,
            bothIrrelevant: 0,
            netWinRate: -1,
          },
        },
      }),
    )
    // |fr|=1 and |de|=1 should both come before |en|=0.
    const enIdx = out.indexOf("en  ")
    const frIdx = out.indexOf("fr  ")
    const deIdx = out.indexOf("de  ")
    expect(Math.max(frIdx, deIdx)).toBeLessThan(enIdx)
  })
})
