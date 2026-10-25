import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  __resetForTests,
  EMBEDDING_COST_USD_PER_QUERY,
  getStats,
  recordQuery,
  subscribe,
} from "./demo-search-metrics"

describe("demo-search-metrics", () => {
  beforeEach(() => {
    __resetForTests()
  })

  afterEach(() => {
    __resetForTests()
  })

  it("returns an empty stats shape when no samples have been recorded", () => {
    const stats = getStats()
    expect(stats).toEqual({
      count: 0,
      p50Ms: null,
      p95Ms: null,
      totalEmbeddingCostUsd: 0,
    })
  })

  it("records samples and computes p50 / p95 / embedding cost", () => {
    for (const n of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) {
      recordQuery(n)
    }
    const stats = getStats()
    expect(stats.count).toBe(10)
    expect(stats.p50Ms).toBeCloseTo(55)
    expect(stats.p95Ms).toBeCloseTo(95.5)
    expect(stats.totalEmbeddingCostUsd).toBeCloseTo(
      10 * EMBEDDING_COST_USD_PER_QUERY,
    )
  })

  it("ignores non-finite or negative durations", () => {
    recordQuery(Number.NaN)
    recordQuery(Number.POSITIVE_INFINITY)
    recordQuery(-5)
    expect(getStats().count).toBe(0)
  })

  it("notifies subscribers when samples are recorded", () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    recordQuery(12)
    recordQuery(34)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    recordQuery(56)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("returns a stable reference across reads when samples unchanged", () => {
    // useSyncExternalStore does Object.is on the snapshot; returning a fresh
    // object every call causes an infinite re-render loop.
    const first = getStats()
    expect(getStats()).toBe(first)
    recordQuery(10)
    const afterRecord = getStats()
    expect(afterRecord).not.toBe(first)
    expect(getStats()).toBe(afterRecord)
  })

  it("degrades gracefully without window.sessionStorage", () => {
    // Module is imported once — reset clears state, and because there is no
    // window in the Node vitest env, hydrate() short-circuits. Recording a
    // sample after reset must still work.
    recordQuery(42)
    expect(getStats().count).toBe(1)
  })
})
