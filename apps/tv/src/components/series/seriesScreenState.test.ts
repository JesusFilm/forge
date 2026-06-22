import {
  pickDefaultTrailer,
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

// ── pickDefaultTrailer ─────────────────────────────────────────────

function langDub(
  slug: string,
  languageSlug: string,
  bcp47: string,
  overrides: Partial<{ published: boolean; hls: string | null }> = {},
) {
  return {
    slug,
    languageSlug,
    languageBcp47: bcp47,
    published: true,
    hls: HLS,
    ...overrides,
  }
}

describe("pickDefaultTrailer", () => {
  it("prefers the default-language chain over array order", () => {
    const german = langDub("d1", "german-standard", "de")
    const english = langDub("d2", "english", "en")
    expect(
      pickDefaultTrailer({
        variants: [german, english],
        primaryLanguageBcp47: null,
      }),
    ).toBe(english)
  })

  it("falls back to the first playable dub when the chain misses", () => {
    const german = langDub("d1", "german-standard", "de")
    const englishUnplayable = langDub("d2", "english", "en", { hls: null })
    expect(
      pickDefaultTrailer({
        variants: [german, englishUnplayable],
        primaryLanguageBcp47: null,
      }),
    ).toBe(german)
  })

  it("returns null when no dub is playable", () => {
    expect(
      pickDefaultTrailer({
        variants: [langDub("d1", "german-standard", "de", { hls: "" })],
        primaryLanguageBcp47: null,
      }),
    ).toBeNull()
    expect(pickDefaultTrailer(null)).toBeNull()
  })

  // Chain: device locale -> video primary -> English -> first. With no English
  // dub (non-de/-fr device locale), video primary decides — the branch other
  // cases skipped by passing primaryLanguageBcp47: null (English/first arm won).
  it("falls back to the video's primary language when the chain has no English", () => {
    const german = langDub("d1", "german-standard", "de")
    const french = langDub("d2", "french", "fr")
    expect(
      pickDefaultTrailer({
        variants: [german, french],
        primaryLanguageBcp47: "de",
      }),
    ).toBe(german)
  })
})

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
    // Regression (review finding #1): a warm videoBySlug partial (label, no series
    // selection) replays loading=false and looks leaf-shaped; a labeled-with-children
    // series would be ejected to /watch unrecoverably (once-guarded). Stay pending.
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
