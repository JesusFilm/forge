import { describe, expect, it } from "vitest"
import { computeTopKDiff } from "./diff"

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
