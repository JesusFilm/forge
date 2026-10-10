import { describe, expect, it } from "vitest"

import { computeAbsoluteSearchQuality } from "./absolute-quality"

const result = (
  id: string,
  options: {
    canonicalVideoId?: string
    languageSlug?: string
  } = {},
) => ({
  type: "video" as const,
  id,
  slug: id,
  title: id,
  imageUrl: null,
  snippet: "",
  startSeconds: null,
  playbackId: null,
  score: 1,
  label: null,
  durationSeconds: null,
  childCount: null,
  ...options,
})

describe("absolute search quality", () => {
  it("computes success, reciprocal rank, and normalized discounted gain", () => {
    const quality = computeAbsoluteSearchQuality([
      {
        caseId: "title",
        split: "development",
        intent: "product-title",
        locale: "en",
        expectedLanguageSlug: "english",
        multilingual: false,
        results: [
          result("weak", { languageSlug: "english" }),
          result("best", { languageSlug: "english" }),
        ],
        relevance: { weak: 1, best: 3 },
        latencyMs: 120,
      },
    ])

    expect(quality.evaluatedRelevanceCases).toBe(1)
    expect(quality.successAt1).toBe(1)
    expect(quality.successAt10).toBe(1)
    expect(quality.mrr).toBe(1)
    expect(quality.ndcgAt10).toBeLessThan(1)
    expect(quality.ndcgAt10).toBeGreaterThan(0.7)
    expect(quality.productTitleSuccessAt1).toBe(1)
    expect(quality.languageCorrectness).toBe(1)
    expect(quality.latency.p95Ms).toBe(120)
  })

  it("uses the first relevant rank and reports canonical duplicates", () => {
    const quality = computeAbsoluteSearchQuality([
      {
        caseId: "semantic",
        split: "held-out",
        intent: "semantic-intent",
        locale: "th",
        expectedLanguageSlug: "thai",
        multilingual: true,
        results: [
          result("variant-a", {
            canonicalVideoId: "core-1",
            languageSlug: "thai",
          }),
          result("variant-b", {
            canonicalVideoId: "core-1",
            languageSlug: "english",
          }),
          result("relevant", {
            canonicalVideoId: "core-2",
            languageSlug: "thai",
          }),
        ],
        relevance: { "core-2": 3 },
        latencyMs: 300,
        degraded: true,
      },
    ])

    expect(quality.successAt1).toBe(0)
    expect(quality.successAt10).toBe(1)
    expect(quality.mrr).toBeCloseTo(1 / 3)
    expect(quality.canonicalDuplicateRate).toBeCloseTo(1 / 3)
    expect(quality.languageCorrectness).toBe(0)
    expect(quality.degradationRate).toBe(1)
    expect(quality.semanticIntentSuccessAt10).toBe(1)
    expect(quality.multilingualSuccessAt10).toBe(1)
  })

  it("scores expected no-result restraint without inventing relevance", () => {
    const quality = computeAbsoluteSearchQuality([
      {
        caseId: "no-result-pass",
        split: "development",
        intent: "confusing-or-no-result",
        locale: "en",
        expectedNoResult: true,
        multilingual: false,
        results: [],
        relevance: {},
        latencyMs: 20,
      },
      {
        caseId: "unjudged",
        split: "development",
        intent: "semantic-intent",
        locale: "en",
        multilingual: false,
        results: [result("candidate")],
        relevance: {},
        latencyMs: 30,
      },
    ])

    expect(quality.evaluatedRelevanceCases).toBe(0)
    expect(quality.expectedNoResultAccuracy).toBe(1)
    expect(quality.expectedNoResultCases).toBe(1)
    expect(quality.noResultRate).toBe(0.5)
  })
})
