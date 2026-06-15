import {
  isSeriesLabel,
  isSeriesRecord,
  isSeriesSearchResult,
} from "./isSeriesRecord"

describe("isSeriesLabel", () => {
  it("matches the uppercase wire enums SERIES and COLLECTION", () => {
    expect(isSeriesLabel("SERIES")).toBe(true)
    expect(isSeriesLabel("COLLECTION")).toBe(true)
  })

  // The fixture where ONLY the strict-uppercase branch can match: mobile's
  // case-folding predicate would accept these, but the wire never sends them.
  it("rejects lowercase/mixed-case labels (strict uppercase, unlike mobile)", () => {
    expect(isSeriesLabel("series")).toBe(false)
    expect(isSeriesLabel("collection")).toBe(false)
    expect(isSeriesLabel("Collection")).toBe(false)
  })

  it("rejects single-video labels and absent labels", () => {
    expect(isSeriesLabel("EPISODE")).toBe(false)
    expect(isSeriesLabel("SEGMENT")).toBe(false)
    expect(isSeriesLabel("FEATURE_FILM")).toBe(false)
    expect(isSeriesLabel(null)).toBe(false)
    expect(isSeriesLabel(undefined)).toBe(false)
  })
})

describe("isSeriesRecord", () => {
  it("is true for a SERIES/COLLECTION label", () => {
    expect(isSeriesRecord({ label: "SERIES", episodes: [] })).toBe(true)
    expect(isSeriesRecord({ label: "COLLECTION", episodes: [] })).toBe(true)
  })

  it("is true for an unlabeled record that has episodes", () => {
    expect(isSeriesRecord({ label: null, episodes: [{}, {}] })).toBe(true)
    expect(isSeriesRecord({ label: "EPISODE", episodes: [{}] })).toBe(true)
  })

  it("is false for a single video with no episodes", () => {
    expect(isSeriesRecord({ label: "FEATURE_FILM", episodes: [] })).toBe(false)
    expect(isSeriesRecord({ label: null, episodes: [] })).toBe(false)
  })

  it("treats absent/null episodes as no children (lean watch record)", () => {
    expect(isSeriesRecord({ label: "SERIES" })).toBe(true)
    expect(isSeriesRecord({ label: "EPISODE" })).toBe(false)
    expect(isSeriesRecord({ label: null, episodes: null })).toBe(false)
  })
})

describe("isSeriesSearchResult", () => {
  it("is true for a SERIES/COLLECTION label regardless of childCount", () => {
    expect(isSeriesSearchResult({ label: "SERIES", childCount: 0 })).toBe(true)
    expect(
      isSeriesSearchResult({ label: "COLLECTION", childCount: null }),
    ).toBe(true)
  })

  it("is true for a null label with a positive childCount", () => {
    expect(isSeriesSearchResult({ label: null, childCount: 3 })).toBe(true)
    expect(isSeriesSearchResult({ label: "EPISODE", childCount: 1 })).toBe(true)
  })

  it("is false for a single video (no series label, zero/absent childCount)", () => {
    expect(isSeriesSearchResult({ label: "FEATURE_FILM", childCount: 0 })).toBe(
      false,
    )
    expect(isSeriesSearchResult({ label: "SEGMENT", childCount: null })).toBe(
      false,
    )
    expect(isSeriesSearchResult({ label: null })).toBe(false)
    expect(isSeriesSearchResult({})).toBe(false)
  })

  it("is false for a lowercase label with no children (strict uppercase)", () => {
    expect(isSeriesSearchResult({ label: "series", childCount: 0 })).toBe(false)
  })
})
