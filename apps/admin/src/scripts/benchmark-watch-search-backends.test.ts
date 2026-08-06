import { describe, expect, it } from "vitest"
import { percentile, resultOverlap } from "./benchmark-watch-search-backends"
import type { WatchSearchResponse } from "@/services/watch-search.service"

describe("Watch Search backend benchmark", () => {
  it("uses nearest-rank percentiles", () => {
    expect(percentile([100, 10, 50, 20], 0.5)).toBe(20)
    expect(percentile([100, 10, 50, 20], 0.95)).toBe(100)
  })

  it("measures top-result Jaccard overlap", () => {
    const response = (ids: string[]) =>
      ({ results: ids.map((id) => ({ id })) }) as WatchSearchResponse
    expect(resultOverlap(response(["a", "b"]), response(["b", "c"]))).toBe(
      1 / 3,
    )
    expect(resultOverlap(response([]), response([]))).toBe(1)
  })
})
