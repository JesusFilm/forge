import { describe, expect, it } from "vitest"
import {
  CompositionThresholds,
  compositionDigest,
  decideComposition,
  MMR_CONFIG,
  observeComposition,
  summarizeComposition,
} from "./policy"
import { slate, thresholds } from "./test-helpers"

describe("separate composition evidence", () => {
  it("binds weights, exact input and output without changing the candidate contract", () => {
    const input = { ...slate(), historyAvailable: true }
    const observed = observeComposition(input, 2)
    expect(observed.metrics).toMatchObject({
      missingTheme: false,
      missingInterest: false,
      missingHistory: false,
      fallback: false,
    })
    expect(observed.inputDigest).toBe(observeComposition(input, 8).inputDigest)
    expect(observed.inputDigest).not.toBe(
      observeComposition({ ...input, limit: 1 }, 2).inputDigest,
    )
    expect(MMR_CONFIG.weights).toEqual({
      relevance: 0.75,
      themeSimilarity: -0.2,
      source: 0.025,
      interest: 0.025,
    })
    expect(compositionDigest({ a: 1, b: 2 })).toBe(
      compositionDigest({ b: 2, a: 1 }),
    )
  })
  it("distinguishes all terminal decisions without a usefulness threshold", () => {
    const metrics = observeComposition(
      { ...slate(), historyAvailable: true },
      2,
    ).metrics
    expect(
      decideComposition(summarizeComposition([]), thresholds).decision,
    ).toBe("inconclusive")
    expect(
      decideComposition(
        summarizeComposition([{ ...metrics, structuralFailure: true }]),
        thresholds,
      ).decision,
    ).toBe("retire")
    expect(
      decideComposition(
        summarizeComposition([{ ...metrics, missingHistory: true }]),
        thresholds,
      ).decision,
    ).toBe("inconclusive")
    expect(
      decideComposition(
        summarizeComposition([{ ...metrics, latencyMs: 201 }]),
        thresholds,
      ).decision,
    ).toBe("revise")
    expect(
      decideComposition(summarizeComposition([metrics]), thresholds).decision,
    ).toBe("qualify_for_controlled_study")
    expect(
      CompositionThresholds.safeParse({ ...thresholds, usefulness: 0.01 })
        .success,
    ).toBe(false)
  })
  it("declares missing history and sparse comparisons as fallback", () => {
    expect(
      observeComposition({ ...slate(), historyAvailable: false, limit: 6 }, 1)
        .metrics,
    ).toMatchObject({ fallback: true, missingHistory: true, fillRate: 0.5 })
  })
})
