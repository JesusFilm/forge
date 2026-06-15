import {
  resolveSearchMeta,
  resultChipLabel,
  resultKindLabel,
} from "./searchDisplay"

describe("resolveSearchMeta", () => {
  it("shows BROWSE for the empty-query idle state", () => {
    expect(resolveSearchMeta("idle", 0, false)).toBe("BROWSE")
  })

  it("stays quiet for idle with a non-empty query (no BROWSE flash)", () => {
    // After the first keystroke the state is idle (debounce pending) with a
    // non-empty query — labelling it BROWSE flashed the browse label across
    // the results region. Only the genuinely-empty browse state shows BROWSE.
    expect(resolveSearchMeta("idle", 0, true)).toBe("")
  })

  it("pluralizes the ready-state result count", () => {
    expect(resolveSearchMeta("ready", 1, true)).toBe("1 RESULT")
    expect(resolveSearchMeta("ready", 12, true)).toBe("12 RESULTS")
  })

  it("stays quiet for ready with zero results", () => {
    expect(resolveSearchMeta("ready", 0, true)).toBe("")
  })

  it("stays quiet while loading, on empty, and on error", () => {
    expect(resolveSearchMeta("loading", 0, true)).toBe("")
    expect(resolveSearchMeta("empty", 0, true)).toBe("")
    expect(resolveSearchMeta("error", 0, true)).toBe("")
  })
})

describe("resultChipLabel", () => {
  it("shows the episode count when the result carries one", () => {
    expect(resultChipLabel({ childCount: 12 })).toBe("12 EP")
    expect(resultChipLabel({ childCount: 1 })).toBe("1 EP")
  })

  it("returns null for leaf results (0 / null / absent childCount)", () => {
    expect(resultChipLabel({ childCount: 0 })).toBeNull()
    expect(resultChipLabel({ childCount: null })).toBeNull()
    expect(resultChipLabel({})).toBeNull()
  })
})

describe("resultKindLabel", () => {
  it("humanizes wire labels", () => {
    expect(resultKindLabel({ type: "VIDEO", label: "FEATURE_FILM" })).toBe(
      "Feature Film",
    )
    expect(resultKindLabel({ type: "VIDEO", label: "SERIES" })).toBe("Series")
    expect(resultKindLabel({ type: "VIDEO", label: "COLLECTION" })).toBe(
      "Collection",
    )
  })

  it("labels experiences regardless of label", () => {
    expect(resultKindLabel({ type: "EXPERIENCE", label: null })).toBe(
      "Experience",
    )
  })

  // Agrees with searchResultPath: unlabeled childCount > 0 routes to
  // /series, so the kind line must say Series, not Video.
  it("reads unlabeled results with children as Series", () => {
    expect(resultKindLabel({ type: "VIDEO", label: null, childCount: 8 })).toBe(
      "Series",
    )
  })

  it("falls back to Video for unlabeled leaf results", () => {
    expect(resultKindLabel({ type: "VIDEO", label: null, childCount: 0 })).toBe(
      "Video",
    )
    expect(resultKindLabel({ type: "VIDEO", label: null })).toBe("Video")
  })
})
