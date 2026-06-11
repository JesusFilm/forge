import {
  pickPlayableTrailer,
  resolveLeafBounce,
  resolveScreenState,
} from "./seriesScreenState"

// ── pickPlayableTrailer ────────────────────────────────────────────

const HLS = "https://stream.mux.com/abc123.m3u8"

function dub(
  overrides: Partial<{ published: boolean; hls: string | null }> = {},
) {
  return { published: true, hls: HLS, ...overrides }
}

describe("pickPlayableTrailer", () => {
  it("returns the dub when published with a non-empty hls", () => {
    const playable = dub()
    expect(pickPlayableTrailer({ variants: [playable] })).toBe(playable)
  })

  it("returns null for an unpublished dub even with an hls", () => {
    expect(
      pickPlayableTrailer({ variants: [dub({ published: false })] }),
    ).toBeNull()
  })

  it("returns null for a published dub with an empty-string hls", () => {
    expect(pickPlayableTrailer({ variants: [dub({ hls: "" })] })).toBeNull()
  })

  it("returns null for a published dub with a null hls", () => {
    expect(pickPlayableTrailer({ variants: [dub({ hls: null })] })).toBeNull()
  })

  it("returns null when the record has no dubs", () => {
    expect(pickPlayableTrailer({ variants: [] })).toBeNull()
  })

  it("returns null for a missing record", () => {
    expect(pickPlayableTrailer(null)).toBeNull()
    expect(pickPlayableTrailer(undefined)).toBeNull()
  })

  it("picks the FIRST playable dub, skipping unplayable ones before it", () => {
    const first = dub()
    const second = dub()
    expect(
      pickPlayableTrailer({
        variants: [dub({ published: false }), dub({ hls: "" }), first, second],
      }),
    ).toBe(first)
  })
})

// ── resolveLeafBounce ──────────────────────────────────────────────

describe("resolveLeafBounce", () => {
  it("renders a series-shaped record (label), even before the series query answers", () => {
    expect(resolveLeafBounce({ label: "SERIES", episodes: [] }, false)).toBe(
      "render",
    )
    expect(resolveLeafBounce({ label: "COLLECTION", episodes: [] }, true)).toBe(
      "render",
    )
  })

  it("renders an unlabeled record that has episodes", () => {
    expect(resolveLeafBounce({ label: null, episodes: [{}] }, true)).toBe(
      "render",
    )
  })

  it("bounces a labeled leaf once the series query has answered", () => {
    expect(
      resolveLeafBounce({ label: "FEATURE_FILM", episodes: [] }, true),
    ).toBe("bounce")
    expect(resolveLeafBounce({ label: "EPISODE", episodes: [] }, true)).toBe(
      "bounce",
    )
  })

  it("bounces an unlabeled leaf once the series query has answered", () => {
    expect(resolveLeafBounce({ label: null, episodes: [] }, true)).toBe(
      "bounce",
    )
  })

  it("is pending for a warm watch-fragment partial, even when it carries a leaf label", () => {
    // Regression (review finding #1): a prior watch-screen visit caches
    // videoBySlug with a label but NO series selection; cache-first +
    // returnPartialData replays it with loading=false. A labeled-with-children
    // series (e.g. FEATURE_FILM with 49 episodes) looks leaf-shaped on that
    // partial — bouncing here would eject it to /watch unrecoverably (the
    // replace is once-guarded). It must stay pending until the series query
    // delivers the children.
    expect(
      resolveLeafBounce({ label: "FEATURE_FILM", episodes: [] }, false),
    ).toBe("pending")
  })

  it("is pending for partial data that lacks a label", () => {
    expect(resolveLeafBounce({ label: null, episodes: [] }, false)).toBe(
      "pending",
    )
  })

  it("is pending when there is no record yet", () => {
    expect(resolveLeafBounce(null, false)).toBe("pending")
    expect(resolveLeafBounce(null, true)).toBe("pending")
    expect(resolveLeafBounce(undefined, false)).toBe("pending")
  })
})

// ── resolveScreenState ─────────────────────────────────────────────

const RECORD = { documentId: "vid-1" }
const SEED = { slug: "gospel-of-john" }

describe("resolveScreenState", () => {
  it("errors when the query failed and nothing is renderable", () => {
    expect(
      resolveScreenState({
        record: null,
        seed: null,
        error: new Error("boom"),
        loading: false,
      }),
    ).toBe("error")
  })

  it("keeps showing a stale record even when a refetch errored", () => {
    expect(
      resolveScreenState({
        record: RECORD,
        seed: null,
        error: new Error("boom"),
        loading: false,
      }),
    ).toBe("content")
  })

  it("is loading while the query is in flight with nothing renderable", () => {
    expect(
      resolveScreenState({
        record: null,
        seed: null,
        error: null,
        loading: true,
      }),
    ).toBe("loading")
  })

  it("renders content from a seed alone — the seed paints the hero", () => {
    expect(
      resolveScreenState({
        record: null,
        seed: SEED,
        error: new Error("boom"),
        loading: false,
      }),
    ).toBe("content")
  })

  it("shows the spinner (not an error flash) while a retry is in flight", () => {
    expect(
      resolveScreenState({
        record: null,
        seed: null,
        error: new Error("boom"),
        loading: true,
      }),
    ).toBe("loading")
  })
})
