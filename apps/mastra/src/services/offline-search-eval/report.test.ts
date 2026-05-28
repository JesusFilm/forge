import { describe, expect, it } from "vitest"

import {
  collapseSwapVerdicts,
  finalizeReport,
  hashQuery,
  _internal,
} from "./report"
import type { SearchEvalReport } from "./types"

const metadata = {
  mastraRunId: "run-1",
  startedAt: "2026-05-27T00:00:00.000Z",
  finishedAt: "2026-05-27T00:00:01.000Z",
  baselineName: "default",
  promptSetVersion: "seed/v1",
  adminSearchUrl: "https://admin.internal/api/internal/search-eval/search",
  judgeModel: "judge",
  search: { limit: 20, mode: null, contentType: null },
} satisfies SearchEvalReport["metadata"]

describe("offline search eval reports", () => {
  it("collapses swapped verdicts into comparison categories", () => {
    expect(collapseSwapVerdicts("clearly-B-better", "slightly-A-better")).toBe(
      "win",
    )
    expect(collapseSwapVerdicts("clearly-A-better", "slightly-B-better")).toBe(
      "loss",
    )
    expect(collapseSwapVerdicts("tie", "tie")).toBe("tie")
    expect(collapseSwapVerdicts("both-irrelevant", "both-irrelevant")).toBe(
      "both-irrelevant",
    )
    expect(collapseSwapVerdicts("both-irrelevant", "tie")).toBe(
      "judge-disagreement",
    )
  })

  it("redacts trace-derived generated query text in durable reports", () => {
    const report = finalizeReport({
      schemaVersion: "1",
      kind: "comparison-report",
      reportId: "run-1",
      metadata,
      calibration: { passed: true, matched: 1, total: 1, skipped: false },
      judgeFailures: [],
      cost: {
        inputTokens: 0,
        outputTokens: 0,
        totalUsd: 0,
        pricingModel: null,
        estimated: false,
      },
      timings: { searchMs: 0, judgeMs: 0, totalMs: 0 },
      outcomes: [
        {
          kind: "win",
          caseId: "seed-1",
          locale: "en",
          queryText: "Jesus",
          source: "seed",
          baselineResults: [],
          currentResults: [],
        },
      ],
      exploratoryGenerated: [
        {
          candidateId: "candidate-1",
          locale: "en",
          source: "generated_trace",
          traceDerived: true,
          queryText: "private-ish trace text",
          queryHash: hashQuery("private-ish trace text"),
          retentionExpiresAt: "2026-06-01T00:00:00.000Z",
          skippedReason: "trace_derived_not_judged_or_searched",
          results: [{ title: "Should be stripped" } as never],
        },
      ],
    })

    expect(JSON.stringify(report)).not.toContain("private-ish trace text")
    expect(JSON.stringify(report)).not.toContain(
      hashQuery("private-ish trace text"),
    )
    expect(report.exploratoryGenerated[0]?.queryText).toBe(
      _internal.REDACTED_TRACE_QUERY,
    )
    expect(report.exploratoryGenerated[0]?.queryHash).toBeNull()
    expect(report.exploratoryGenerated[0]?.results).toEqual([])
    expect(report.generatedCandidateBehavior).toMatchObject({
      included: 1,
      traceDerived: 1,
      skippedTraceDerived: 1,
    })
    expect(report.mastraEvaluation).toMatchObject({
      integrationStatus: "custom_artifact_only",
      dataset: {
        name: "search-eval:default",
        datasetId: null,
        source: "seed_prompt_set",
        targetType: "workflow",
        targetId: "offline-search-eval",
      },
      scorers: [
        {
          id: "search-result-pairwise-judge",
          scorerId: null,
          status: "not_registered",
        },
      ],
      experiment: {
        name: "search-eval-compare:default:run-1",
        experimentId: null,
        status: "not_created",
        mode: "comparison",
      },
    })
    expect(report.totals.netWinRate).toBe(1)
  })

  it("separates judge disagreements from ties and win-rate scoring", () => {
    const report = finalizeReport({
      schemaVersion: "1",
      kind: "comparison-report",
      reportId: "run-1",
      metadata,
      calibration: { passed: true, matched: 1, total: 1, skipped: false },
      judgeFailures: [],
      cost: {
        inputTokens: 0,
        outputTokens: 0,
        totalUsd: 0,
        pricingModel: null,
        estimated: false,
      },
      timings: { searchMs: 0, judgeMs: 0, totalMs: 0 },
      outcomes: [
        {
          kind: "tie",
          caseId: "seed-tie",
          locale: "en",
          queryText: "Jesus",
          source: "seed",
          baselineResults: [],
          currentResults: [],
        },
        {
          kind: "judge-disagreement",
          caseId: "seed-disagreement",
          locale: "en",
          queryText: "Jesus",
          source: "seed",
          baselineResults: [],
          currentResults: [],
        },
      ],
      exploratoryGenerated: [],
    })

    expect(report.totals).toMatchObject({
      ties: 1,
      judgeDisagreements: 1,
      judgeFailures: 0,
      netWinRate: 0,
    })
  })

  it("separates provider judge failures from verdict disagreements", () => {
    const report = finalizeReport({
      schemaVersion: "1",
      kind: "comparison-report",
      reportId: "run-1",
      metadata,
      calibration: { passed: true, matched: 1, total: 1, skipped: false },
      judgeFailures: [
        { code: "judge_failed", retryable: true, message: "transport" },
      ],
      cost: {
        inputTokens: 0,
        outputTokens: 0,
        totalUsd: 0,
        pricingModel: null,
        estimated: false,
      },
      timings: { searchMs: 0, judgeMs: 0, totalMs: 0 },
      outcomes: [
        {
          kind: "judge-failure",
          caseId: "seed-provider-outage",
          locale: "en",
          queryText: "Jesus",
          source: "seed",
          baselineResults: [],
          currentResults: [],
          searchFailure: { code: "judge_failed", retryable: true },
        },
      ],
      exploratoryGenerated: [],
    })

    expect(report.totals).toMatchObject({
      judgeDisagreements: 0,
      judgeFailures: 1,
      netWinRate: 0,
    })
  })
})
