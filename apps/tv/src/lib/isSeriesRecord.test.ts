import { isSeriesLabel } from "./isSeriesRecord"

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
    expect(isSeriesLabel("SHORT_FILM")).toBe(false)
    expect(isSeriesLabel(null)).toBe(false)
    expect(isSeriesLabel(undefined)).toBe(false)
  })
})

// The regression this module exists to prevent. Every one of these is a real
// catalog title that has its own published HLS AND its own chapter clips; a
// predicate that counted children billed all of them as series.
describe("films that carry their own chapter clips", () => {
  it.each([
    ["jesus", "FEATURE_FILM", 61],
    ["book-of-acts", "FEATURE_FILM", 73],
    ["life-of-jesus-gospel-of-john", "FEATURE_FILM", 49],
    ["the-savior", "FEATURE_FILM", 55],
    ["magdalena", "FEATURE_FILM", 46],
    ["my-last-day", "SHORT_FILM", 1],
  ])("%s (%s, %i children) is not series-shaped", (_slug, label) => {
    expect(isSeriesLabel(label)).toBe(false)
  })

  it("still treats a labelled container as series-shaped with no children at all", () => {
    expect(isSeriesLabel("SERIES")).toBe(true)
    expect(isSeriesLabel("COLLECTION")).toBe(true)
  })
})
