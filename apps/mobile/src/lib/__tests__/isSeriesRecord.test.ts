import {
  isEpisodicSeriesLabel,
  isSeriesLabel,
  isSeriesRecord,
  isSeriesSearchResult,
} from "../isSeriesRecord"
import { labelText } from "../videoLabel"

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
    expect(isSeriesRecord({ label: "", episodes: [{}] })).toBe(true)
  })

  // REGRESSION GUARD (mirrors apps/tv #1767): JESUS is a FEATURE_FILM carrying
  // 61 chapter clips. Routing on "has children" billed it a SERIES and opened
  // the episode grid instead of the film. A record that HAS a label is
  // classified by that label alone.
  it("is false for a leaf label that carries children", () => {
    const chapters = Array.from({ length: 61 }, () => ({}))
    expect(isSeriesRecord({ label: "FEATURE_FILM", episodes: chapters })).toBe(
      false,
    )
    expect(isSeriesRecord({ label: "EPISODE", episodes: [{}] })).toBe(false)
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

  it("is true only for an UNLABELED result with a positive childCount", () => {
    // The childCount branch exists for records the wire left unlabeled; it must
    // not override a label that is present.
    expect(isSeriesSearchResult({ label: null, childCount: 1 })).toBe(true)
    expect(isSeriesSearchResult({ label: "", childCount: 1 })).toBe(true)
  })

  // REGRESSION GUARD: the form HomeCard passes — a DISPLAY label ("Feature
  // film", via labelText) plus the real child count. This is the exact tuple
  // that sent JESUS (61) and Life of Jesus (49) to /series/[slug], where the
  // screen has no player, so back showed a plain chevron and published no
  // mini-player session.
  it("is false for a labelled feature film that carries chapter clips", () => {
    expect(
      isSeriesSearchResult({ label: "Feature film", childCount: 61 }),
    ).toBe(false)
    expect(
      isSeriesSearchResult({ label: "FEATURE_FILM", childCount: 49 }),
    ).toBe(false)
    expect(isSeriesSearchResult({ label: "EPISODE", childCount: 3 })).toBe(
      false,
    )
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

// The predicate answers correctly; the hazard is WHICH value a caller feeds it.
// labelText maps an absent admin label to the string "Video", so display text
// makes every record look labelled and kills the childCount branch.
describe("display text is not a classification label", () => {
  it("treats labelText's absent-label sentinel as a real label", () => {
    expect(labelText(null)).toBe("Video")
    // Feeding that sentinel strands an unlabeled-with-children record on
    // /watch, where the lean fragment omits children so no redirect can save it.
    expect(
      isSeriesSearchResult({ label: labelText(null), childCount: 12 }),
    ).toBe(false)
    // The raw enum is null for the same record, so childCount still decides.
    expect(isSeriesSearchResult({ label: null, childCount: 12 })).toBe(true)
  })
})
