import {
  resolveSearchMeta,
  resultChipLabel,
  resultKindLabel,
} from "./searchDisplay"

describe("resolveSearchMeta", () => {
  it("stays quiet (unlabelled) for the idle/browse state", () => {
    // The browse panel below is self-evident, so the meta line carries no
    // "BROWSE" eyebrow — empty query and mid-type debounce both stay quiet.
    expect(resolveSearchMeta("idle", 0)).toBe("")
    // resultCount is irrelevant while idle (the old hasQuery split is gone) —
    // a non-zero count must not resurrect a label.
    expect(resolveSearchMeta("idle", 5)).toBe("")
  })

  it("pluralizes the ready-state result count", () => {
    expect(resolveSearchMeta("ready", 1)).toBe("1 RESULT")
    expect(resolveSearchMeta("ready", 12)).toBe("12 RESULTS")
  })

  it("stays quiet for ready with zero results", () => {
    expect(resolveSearchMeta("ready", 0)).toBe("")
  })

  it("stays quiet while loading, on empty, and on error", () => {
    expect(resolveSearchMeta("loading", 0)).toBe("")
    expect(resolveSearchMeta("empty", 0)).toBe("")
    expect(resolveSearchMeta("error", 0)).toBe("")
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

  // Agrees with searchResultPath, which no longer routes on children: an
  // unlabeled result opens /watch, so the kind line must say Video.
  it("falls back to Video for unlabeled results", () => {
    expect(resultKindLabel({ type: "VIDEO", label: null })).toBe("Video")
    expect(resultKindLabel({ type: "VIDEO", label: "" })).toBe("Video")
  })

  // The mislabel this fix targets: JESUS reads "Feature Film", never "Series".
  it("reads a feature film with chapter clips as Feature Film", () => {
    expect(resultKindLabel({ type: "VIDEO", label: "FEATURE_FILM" })).toBe(
      "Feature Film",
    )
  })
})
