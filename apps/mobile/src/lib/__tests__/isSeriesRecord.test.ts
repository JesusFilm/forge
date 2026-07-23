import {
  isEpisodicSeriesLabel,
  isSeriesLabel,
  isSeriesRecord,
  isSeriesSearchResult,
} from "../isSeriesRecord"

describe("isSeriesLabel", () => {
  it("matches SERIES and COLLECTION case-insensitively", () => {
    expect(isSeriesLabel("SERIES")).toBe(true)
    expect(isSeriesLabel("COLLECTION")).toBe(true)
    expect(isSeriesLabel("series")).toBe(true)
    expect(isSeriesLabel("Collection")).toBe(true)
  })

  it("rejects single-video labels and absent labels", () => {
    expect(isSeriesLabel("EPISODE")).toBe(false)
    expect(isSeriesLabel("SEGMENT")).toBe(false)
    expect(isSeriesLabel("FEATURE_FILM")).toBe(false)
    expect(isSeriesLabel(null)).toBe(false)
    expect(isSeriesLabel(undefined)).toBe(false)
  })
})

describe("isEpisodicSeriesLabel", () => {
  it("matches only SERIES (case-insensitive), never COLLECTION", () => {
    expect(isEpisodicSeriesLabel("SERIES")).toBe(true)
    expect(isEpisodicSeriesLabel("series")).toBe(true)
    expect(isEpisodicSeriesLabel("Series")).toBe(true)
    // The whole point: a collection of standalone films is NOT a series folder.
    expect(isEpisodicSeriesLabel("COLLECTION")).toBe(false)
    expect(isEpisodicSeriesLabel("Collection")).toBe(false)
  })

  it("rejects single-video labels and absent labels", () => {
    expect(isEpisodicSeriesLabel("FEATURE_FILM")).toBe(false)
    expect(isEpisodicSeriesLabel("SHORT_FILM")).toBe(false)
    expect(isEpisodicSeriesLabel("EPISODE")).toBe(false)
    expect(isEpisodicSeriesLabel(null)).toBe(false)
    expect(isEpisodicSeriesLabel(undefined)).toBe(false)
  })
})

describe("isSeriesRecord", () => {
  it("is true for a SERIES/COLLECTION label", () => {
    expect(isSeriesRecord({ label: "SERIES", episodes: [] })).toBe(true)
    expect(isSeriesRecord({ label: "COLLECTION", episodes: [] })).toBe(true)
  })

  it("is true for an unlabeled record that has children", () => {
    expect(isSeriesRecord({ label: null, episodes: [{}, {}] })).toBe(true)
    expect(isSeriesRecord({ label: "EPISODE", episodes: [{}] })).toBe(true)
  })

  it("is false for a single video with no children", () => {
    expect(isSeriesRecord({ label: "EPISODE", episodes: [] })).toBe(false)
    expect(isSeriesRecord({ label: null, episodes: [] })).toBe(false)
  })
})

describe("isSeriesSearchResult", () => {
  it("is true for a SERIES/COLLECTION label regardless of childCount", () => {
    expect(isSeriesSearchResult({ label: "SERIES", childCount: 0 })).toBe(true)
    expect(
      isSeriesSearchResult({ label: "COLLECTION", childCount: null }),
    ).toBe(true)
  })

  it("is true for a non-series label with a positive childCount", () => {
    // The childCount branch — distinct from the redirect's episodes.length path.
    expect(isSeriesSearchResult({ label: "EPISODE", childCount: 3 })).toBe(true)
    expect(isSeriesSearchResult({ label: null, childCount: 1 })).toBe(true)
  })

  it("is false for a single video (no series label, zero/absent childCount)", () => {
    expect(isSeriesSearchResult({ label: "SHORT_FILM", childCount: 0 })).toBe(
      false,
    )
    expect(isSeriesSearchResult({ label: "SEGMENT", childCount: null })).toBe(
      false,
    )
    expect(isSeriesSearchResult({ label: null })).toBe(false)
  })
})
