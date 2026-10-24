import {
  PREVIEW_HOLD_MS,
  PREVIEW_START_DELAY_MS,
  advancePreview,
  buildPreviewQueue,
  isPreviewEligible,
} from "../previewCycle"

const video = (playbackId: string | null = "pb1") => ({
  label: "shortFilm",
  childCount: 0,
  playbackId,
})
const series = (playbackId: string | null = null, childCount = 6) => ({
  label: "series",
  childCount,
  playbackId,
})
// The discriminating shape: a feature film OWNS its chapter clips, so it has
// children and is still a single playable video. Real rows, measured against
// admin: JESUS 61, Book of Acts 73, Magdalena 46.
const featureFilmWithChapters = (childCount = 61) => ({
  label: "featureFilm",
  childCount,
  playbackId: "pb-jesus",
})

describe("isPreviewEligible", () => {
  it("previews a leaf video that carries a playback id", () => {
    expect(isPreviewEligible(video())).toBe(true)
  })

  it("skips a leaf video with no playback id", () => {
    expect(isPreviewEligible(video(null))).toBe(false)
  })

  // The discriminating case: gating on the playback id alone would preview
  // this row. 1 of 22 series rows carried one when measured against admin.
  it("skips a series EVEN when it carries a playback id", () => {
    expect(isPreviewEligible(series("pb-series"))).toBe(false)
  })

  // The counterpart: gating on childCount alone would skip this row. Only a
  // label-first predicate gets both this and the case above right.
  it("previews a feature film that owns chapter clips", () => {
    expect(isPreviewEligible(featureFilmWithChapters())).toBe(true)
  })

  it("previews an unlabeled leaf, and skips an unlabeled row with children", () => {
    expect(
      isPreviewEligible({ label: null, childCount: 0, playbackId: "pb1" }),
    ).toBe(true)
    expect(
      isPreviewEligible({ label: null, childCount: 4, playbackId: "pb1" }),
    ).toBe(false)
  })

  it("treats a null childCount as a leaf, not a series", () => {
    expect(
      isPreviewEligible({ label: null, childCount: null, playbackId: "pb1" }),
    ).toBe(true)
  })
})

describe("buildPreviewQueue", () => {
  const results = [
    video("a"), // 0
    series("pb-series"), // 1 — eligible only if the series gate is missing
    video("c"), // 2
    video(null), // 3 — no id
    video("e"), // 4
    featureFilmWithChapters(), // 5 — children, but still a playable film
  ]

  it("keeps only eligible rows, in ascending index order", () => {
    expect(buildPreviewQueue(results, [5, 4, 0, 2, 1, 3])).toEqual([0, 2, 4, 5])
  })

  it("restricts the queue to visible rows", () => {
    expect(buildPreviewQueue(results, [2, 4])).toEqual([2, 4])
  })

  it("drops duplicate and out-of-range indices", () => {
    expect(buildPreviewQueue(results, [0, 0, 99, -1])).toEqual([0])
  })

  it("is empty when nothing visible can preview", () => {
    expect(buildPreviewQueue(results, [1, 3])).toEqual([])
  })
})

describe("advancePreview", () => {
  it("starts at the first eligible card — the top-left of the grid", () => {
    expect(advancePreview([0, 2, 4], null)).toBe(0)
  })

  it("moves along the row, then down to the next row", () => {
    expect(advancePreview([0, 1, 2, 3], 0)).toBe(1)
    expect(advancePreview([0, 1, 2, 3], 1)).toBe(2)
  })

  it("stops after a single pass rather than cycling", () => {
    expect(advancePreview([0, 2, 4], 4)).toBeNull()
  })

  it("returns null when nothing is eligible", () => {
    expect(advancePreview([], null)).toBeNull()
  })

  // A scroll rebuilds the queue mid-pass. Comparing by index (not by position)
  // means the pass keeps moving forward and never replays a shown card.
  it("never goes backwards when the visible set changes under it", () => {
    expect(advancePreview([6, 7, 8], 4)).toBe(6)
    expect(advancePreview([0, 1, 2], 4)).toBeNull()
  })

  // "Load More" appends higher indices and the cycle resumes from the last card
  // it showed, so the appended page previews and page one does not replay.
  it("resumes into an appended page from the last card shown", () => {
    const firstPage = [0, 1, 2, 3]
    expect(advancePreview(firstPage, 3)).toBeNull()

    const withSecondPage = [0, 1, 2, 3, 4, 5, 6]
    expect(advancePreview(withSecondPage, 3)).toBe(4)
    expect(advancePreview(withSecondPage, 4)).toBe(5)
  })
})

describe("timings", () => {
  // 4s is the length of the clip the preview URL asks Mux for (start=2,
  // end=6), so a turn is exactly one loop. Move both together.
  it("holds each card for 4s after a 1s settle", () => {
    expect(PREVIEW_START_DELAY_MS).toBe(1000)
    expect(PREVIEW_HOLD_MS).toBe(4000)
  })
})
