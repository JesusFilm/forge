import { isSeriesLabel, isSeriesRecord } from "../isSeriesRecord"

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
