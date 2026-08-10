import { describe, expect, it } from "vitest"

import { AbsoluteSearchEvalReportSchema } from "./absolute-artifacts"

const report = {
  schemaVersion: "1",
  kind: "absolute-report",
  reportId: "absolute-run",
  querySetVersion: "public-watch-absolute/v2",
  split: "development",
  backendMode: "modern",
  startedAt: "2026-08-05T00:00:00.000Z",
  finishedAt: "2026-08-05T00:00:01.000Z",
  adminSearchUrl: "https://admin.example.com/search",
  relevanceJudgmentSetVersion: "public-watch-qrels/reviewed-v1",
  judgeModel: "judge-model",
  judgeProvider: "openrouter",
  candidateIdentity: null,
  observedServerRevisions: ["abcdef123456"],
  operatorReview: null,
  observations: [
    {
      caseId: "seed-jesus",
      split: "development",
      intent: "product-title",
      locale: "en",
      expectedLanguageSlug: "english",
      expectedNoResult: false,
      multilingual: false,
      queryText: "jesus",
      languageSlug: "english",
      results: [],
      relevance: { "core:4_jesus": 3 },
      latencyMs: 40,
      roundTripLatencyMs: 50,
      serverLatencyMs: 40,
      requestId: "request-1",
      serverRevision: "abcdef123456",
      laneStatuses: [],
      degraded: false,
    },
  ],
  quality: {
    queries: 1,
    evaluatedRelevanceCases: 1,
    successAt1: 0,
    successAt10: 0,
    mrr: 0,
    ndcgAt10: 0,
    productTitleSuccessAt1: 0,
    semanticIntentSuccessAt10: 0,
    multilingualSuccessAt10: 0,
    noResultRate: 1,
    expectedNoResultCases: 0,
    expectedNoResultAccuracy: 0,
    languageCorrectness: 0,
    canonicalDuplicateRate: 0,
    degradationRate: 0,
    pointwiseUsefulRate: 0,
    pointwiseUnacceptableRate: 0,
    latency: { p50Ms: 40, p95Ms: 40, p99Ms: 40 },
  },
  relevanceCoverage: 1,
  gate: { passed: false, reasons: ["development_split_not_promotable"] },
  cost: { inputTokens: 0, outputTokens: 0, reportedUsd: null },
  timings: { searchMs: 50, judgeMs: 0, totalMs: 50 },
} as const

describe("absolute search eval artifacts", () => {
  it("accepts the complete strict report contract", () => {
    expect(AbsoluteSearchEvalReportSchema.safeParse(report).success).toBe(true)
  })

  it("rejects drift inside observations and quality metrics", () => {
    expect(
      AbsoluteSearchEvalReportSchema.safeParse({
        ...report,
        observations: [{ arbitrary: true }],
      }).success,
    ).toBe(false)
    expect(
      AbsoluteSearchEvalReportSchema.safeParse({
        ...report,
        quality: { ...report.quality, inventedMetric: 1 },
      }).success,
    ).toBe(false)
  })
})
