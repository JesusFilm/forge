import { describe, expect, it } from "vitest"
import {
  buildProvenanceMap,
  computeThreeWayDiff,
  computeTopKDiff,
} from "./diff"

describe("computeTopKDiff", () => {
  it("returns full overlap when inputs are identical", () => {
    const a = ["1", "2", "3"]
    expect(computeTopKDiff(a, a, 10)).toEqual({
      both: ["1", "2", "3"],
      aOnly: [],
      bOnly: [],
    })
  })

  it("returns disjoint sets when inputs share nothing", () => {
    expect(computeTopKDiff(["1", "2"], ["3", "4"], 10)).toEqual({
      both: [],
      aOnly: ["1", "2"],
      bOnly: ["3", "4"],
    })
  })

  it("classifies partial overlap and preserves input order", () => {
    expect(
      computeTopKDiff(["1", "2", "3", "4"], ["3", "5", "1", "6"], 10),
    ).toEqual({
      both: ["1", "3"],
      aOnly: ["2", "4"],
      bOnly: ["5", "6"],
    })
  })

  it("considers only the first k of each list", () => {
    // Even though "9" appears in both inputs, k=2 ignores it on both sides.
    expect(computeTopKDiff(["1", "2", "9"], ["7", "8", "9"], 2)).toEqual({
      both: [],
      aOnly: ["1", "2"],
      bOnly: ["7", "8"],
    })
  })

  it("handles k larger than input length without crashing", () => {
    expect(computeTopKDiff(["1"], ["1", "2"], 100)).toEqual({
      both: ["1"],
      aOnly: [],
      bOnly: ["2"],
    })
  })

  it("returns empty sets for empty inputs", () => {
    expect(computeTopKDiff([], [], 10)).toEqual({
      both: [],
      aOnly: [],
      bOnly: [],
    })
  })

  it("puts a single non-empty input entirely in its own bucket", () => {
    expect(computeTopKDiff(["1", "2"], [], 10)).toEqual({
      both: [],
      aOnly: ["1", "2"],
      bOnly: [],
    })
    expect(computeTopKDiff([], ["1", "2"], 10)).toEqual({
      both: [],
      aOnly: [],
      bOnly: ["1", "2"],
    })
  })

  it("dedupes within each input (first occurrence wins)", () => {
    expect(computeTopKDiff(["1", "1", "2"], ["2", "2", "3"], 10)).toEqual({
      both: ["2"],
      aOnly: ["1"],
      bOnly: ["3"],
    })
  })

  it("returns empty sets for k <= 0", () => {
    expect(computeTopKDiff(["1", "2"], ["1", "2"], 0)).toEqual({
      both: [],
      aOnly: [],
      bOnly: [],
    })
    expect(computeTopKDiff(["1"], ["1"], -5)).toEqual({
      both: [],
      aOnly: [],
      bOnly: [],
    })
  })
})

describe("computeThreeWayDiff", () => {
  const empty = {
    inAll: [],
    hybridKeyword: [],
    hybridAlgolia: [],
    keywordAlgolia: [],
    hybridOnly: [],
    keywordOnly: [],
    algoliaOnly: [],
  }

  it("places identical inputs entirely in inAll", () => {
    const ids = ["a", "b", "c"]
    expect(computeThreeWayDiff(ids, ids, ids, 10)).toEqual({
      ...empty,
      inAll: ["a", "b", "c"],
    })
  })

  it("classifies disjoint inputs into per-source-only buckets", () => {
    expect(computeThreeWayDiff(["a"], ["b"], ["c"], 10)).toEqual({
      ...empty,
      hybridOnly: ["a"],
      keywordOnly: ["b"],
      algoliaOnly: ["c"],
    })
  })

  it("classifies pairwise overlaps without leaking into inAll", () => {
    // a: H+K, b: H+A, c: K+A, d: only H, e: only K, f: only A
    expect(
      computeThreeWayDiff(
        ["a", "b", "d"],
        ["a", "c", "e"],
        ["b", "c", "f"],
        10,
      ),
    ).toEqual({
      inAll: [],
      hybridKeyword: ["a"],
      hybridAlgolia: ["b"],
      keywordAlgolia: ["c"],
      hybridOnly: ["d"],
      keywordOnly: ["e"],
      algoliaOnly: ["f"],
    })
  })

  it("respects per-source top-k truncation independently", () => {
    // k=2 — "z" only appears via hybrid index 2 + algolia index 2,
    // both truncated. So z drops out entirely.
    expect(
      computeThreeWayDiff(["a", "b", "z"], ["a"], ["c", "d", "z"], 2),
    ).toEqual({
      ...empty,
      hybridKeyword: ["a"],
      hybridOnly: ["b"],
      algoliaOnly: ["c", "d"],
    })
  })

  it("dedupes within each source (first occurrence wins)", () => {
    expect(
      computeThreeWayDiff(["a", "a", "b"], ["b", "b"], ["a", "c"], 10),
    ).toEqual({
      inAll: [],
      hybridKeyword: ["b"],
      hybridAlgolia: ["a"],
      keywordAlgolia: [],
      hybridOnly: [],
      keywordOnly: [],
      algoliaOnly: ["c"],
    })
  })

  it("returns all empty buckets for k <= 0", () => {
    expect(computeThreeWayDiff(["a"], ["b"], ["c"], 0)).toEqual(empty)
    expect(computeThreeWayDiff(["a"], ["b"], ["c"], -3)).toEqual(empty)
  })

  it("handles empty inputs without throwing", () => {
    expect(computeThreeWayDiff([], [], [], 5)).toEqual(empty)
  })
})

describe("buildProvenanceMap", () => {
  it("records source membership per id within top-k", () => {
    const map = buildProvenanceMap(["a", "b"], ["a", "c"], ["b", "c"], 10)
    expect(Array.from(map.get("a") ?? [])).toEqual(["H", "K"])
    expect(Array.from(map.get("b") ?? [])).toEqual(["H", "A"])
    expect(Array.from(map.get("c") ?? [])).toEqual(["K", "A"])
  })

  it("respects k truncation per source", () => {
    const map = buildProvenanceMap(["a", "b"], ["b"], ["a"], 1)
    // Only the first id of each source counts at k=1:
    // hybrid -> a, keyword -> b, algolia -> a
    expect(Array.from(map.get("a") ?? [])).toEqual(["H", "A"])
    expect(Array.from(map.get("b") ?? [])).toEqual(["K"])
  })

  it("returns an empty map for k <= 0", () => {
    expect(buildProvenanceMap(["a"], ["b"], ["c"], 0).size).toBe(0)
  })
})
