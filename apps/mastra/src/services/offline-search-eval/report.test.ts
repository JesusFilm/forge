import { describe, expect, it } from "vitest"

import {
  assertContentSearchEvalGateDocsReportIsSafe,
  buildContentSearchEvalGateDocsReport,
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
  callerTrack: "public-watch",
  promptSetVersion: "seed/v1",
  adminSearchUrl: "https://admin.internal/api/internal/search-eval/search",
  servingRevision: null,
  judgeModel: "judge",
  search: { limit: 20, mode: null, contentType: null },
} satisfies SearchEvalReport["metadata"]

const contentEmbeddingProvider = {
  provider: "jesus-film-ai-gateway",
  model: "embeddings",
  requestModel: "embeddings",
  nativeDimensions: 1536,
  finalDimensions: 1536,
  transformVersion: null,
} as const

const result = {
  type: "video",
  id: "video-1",
  slug: "video-slug",
  title: "Search Result Title",
  imageUrl: null,
  snippet: "Private source snippet that should not be committed.",
  startSeconds: null,
  playbackId: null,
  score: 0.9,
  label: null,
  durationSeconds: null,
  childCount: null,
} satisfies SearchEvalReport["outcomes"][number]["baselineResults"][number]

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
          callerTrack: "public-watch",
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
        name: "search-eval:default:public-watch:hybrid",
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
        name: "search-eval-compare:default:public-watch:hybrid:run-1",
        experimentId: null,
        status: "not_created",
        mode: "comparison",
      },
    })
    expect(report.callerTrackMix).toEqual({ "public-watch": 1 })
    expect(report.trackSummaries[0]).toMatchObject({
      callerTrack: "public-watch",
      mode: null,
      suitableMode: false,
      noResultCases: 1,
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
          callerTrack: "public-watch",
          baselineResults: [],
          currentResults: [],
        },
        {
          kind: "judge-disagreement",
          caseId: "seed-disagreement",
          locale: "en",
          queryText: "Jesus",
          source: "seed",
          callerTrack: "public-watch",
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
          callerTrack: "public-watch",
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

  it("builds a sanitized content search-eval gate report for docs", () => {
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
          queryText: "Private user search query",
          source: "seed",
          callerTrack: "public-watch",
          baselineResults: [result],
          currentResults: [result],
          verdicts: ["slightly-B-better", "slightly-A-better"],
          rationale: "The private query matched the current list.",
        },
      ],
      exploratoryGenerated: [],
    })

    const docsReport = buildContentSearchEvalGateDocsReport({
      exportedAt: "2026-06-03T00:00:00.000Z",
      mastraRunId: "run-orchestrator",
      report,
      contentEmbeddingProvider,
      summary: {
        passFail: { state: "passed", reasons: [] },
        artifacts: { reportPath: "/tmp/search-eval/reports/run-1.json" },
      },
    })

    const serialized = JSON.stringify(docsReport)
    expect(docsReport.contentEmbeddingProvider).toEqual(
      contentEmbeddingProvider,
    )
    expect(docsReport.gate).toMatchObject({
      backfillReady: true,
      judgeModel: "judge",
      reportId: "run-1",
      passFailState: "passed",
      comparableQueries: 1,
    })
    expect(serialized).not.toContain("Private user search query")
    expect(serialized).not.toContain("Private source snippet")
    expect(serialized).not.toContain("private query matched")
    expect(serialized).toContain(_internal.REDACTED_QUERY_TEXT)
    expect(serialized).toContain(_internal.REDACTED_RESULT_SNIPPET)
  })

  it("marks docs gate reports blocked when the comparison has no judge", () => {
    const report = finalizeReport({
      schemaVersion: "1",
      kind: "comparison-report",
      reportId: "run-no-judge",
      metadata: { ...metadata, judgeModel: null },
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
          caseId: "seed-1",
          locale: "en",
          queryText: "Jesus",
          source: "seed",
          callerTrack: "public-watch",
          baselineResults: [result],
          currentResults: [result],
        },
      ],
      exploratoryGenerated: [],
    })

    const docsReport = buildContentSearchEvalGateDocsReport({
      mastraRunId: "run-orchestrator",
      report,
      contentEmbeddingProvider,
      summary: { passFail: { state: "passed", reasons: [] } },
    })

    expect(docsReport.gate.backfillReady).toBe(false)
    expect(docsReport.gate.reasons).toContain(
      "migration gate requires an assigned judge model",
    )
  })

  it("allows a docs gate when every judge disagreement is human-adjudicated", () => {
    const report = finalizeReport({
      schemaVersion: "1",
      kind: "comparison-report",
      reportId: "run-adjudicated",
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
          caseId: "seed-win",
          locale: "en",
          queryText: "Jesus",
          source: "seed",
          callerTrack: "public-watch",
          baselineResults: [result],
          currentResults: [result],
        },
        {
          kind: "judge-disagreement",
          caseId: "seed-new-believer",
          locale: "en",
          queryText: "new believer",
          source: "seed",
          callerTrack: "public-watch",
          baselineResults: [result],
          currentResults: [result],
          verdicts: ["clearly-A-better", "clearly-A-better"],
        },
      ],
      exploratoryGenerated: [],
    })

    const docsReport = buildContentSearchEvalGateDocsReport({
      exportedAt: "2026-06-03T00:00:00.000Z",
      mastraRunId: "run-orchestrator",
      report,
      contentEmbeddingProvider,
      summary: {
        passFail: {
          state: "failed",
          reasons: ["judge disagreements 1 exceeded max 0"],
        },
      },
      humanAdjudications: [
        {
          caseId: "seed-new-believer",
          acceptedOutcome: "current-better",
          reviewer: "search-quality-review",
          reason:
            "Current results include the exact course and related follow-up resources.",
        },
      ],
    })

    expect(docsReport.gate).toMatchObject({
      backfillReady: true,
      passFailState: "passed",
      orchestratorPassFailState: "failed",
      comparableQueries: 2,
      judgeDisagreements: 0,
      rawJudgeDisagreements: 1,
      adjudicatedJudgeDisagreements: 1,
      netWinRate: 1,
    })
    expect(docsReport.humanAdjudications?.judgeDisagreements).toEqual([
      expect.objectContaining({
        caseId: "seed-new-believer",
        locale: "en",
        acceptedOutcome: "current-better",
        rawOutcomeKind: "judge-disagreement",
        verdicts: ["clearly-A-better", "clearly-A-better"],
      }),
    ])
  })

  it("rejects prohibited secrets and raw vector keys in docs reports", () => {
    expect(() =>
      assertContentSearchEvalGateDocsReportIsSafe({
        schemaVersion: "1",
        kind: "content-search-eval-gate-report",
        apiKey: "sk-secret123",
      }),
    ).toThrow(/prohibited key: apiKey/)

    expect(() =>
      assertContentSearchEvalGateDocsReportIsSafe({
        schemaVersion: "1",
        kind: "content-search-eval-gate-report",
        result: { embedding: [0.1, 0.2] },
      }),
    ).toThrow(/prohibited key: embedding/)

    expect(() =>
      assertContentSearchEvalGateDocsReportIsSafe({
        schemaVersion: "1",
        kind: "content-search-eval-gate-report",
        metadata: {
          adminSearchUrl:
            "https://user:pass@example.test/search?api_key=secret",
        },
      }),
    ).toThrow(/prohibited string pattern/)
  })
})
