// TV has no @testing-library/react-native, so the provider stays a thin shell
// over PURE exported helpers that we unit-test directly here (per U3). Each
// helper backs one provider behavior; the mapping is noted per describe block.

// Import from the React-free helper module (not the .tsx provider) — the jest
// transform can't load the provider's React/JSX module graph, and the provider
// re-exports these same symbols, so the public surface is identical.
import {
  clampVariantIndex,
  selectActiveVariant,
  resolveDefaultVariantIndex,
  resolveDefaultSubtitleSlug,
  selectDubMediaState,
} from "./watchSessionState"
import type { WatchVideoRecord, VariantMedia } from "../lib/normalizeVideo"

// ── Builders ────────────────────────────────────────────────────────

function makeVariant(
  overrides: Partial<WatchVideoRecord["variants"][number]> = {},
): WatchVideoRecord["variants"][number] {
  return {
    documentId: "dub-1",
    slug: "video-1/english",
    published: true,
    hls: "https://stream.mux.com/abc.m3u8",
    duration: 100,
    languageCoreId: "529",
    languageBcp47: "en",
    languageSlug: "english",
    languageName: "English",
    languageNameNative: null,
    muxPlaybackId: "abc",
    ...overrides,
  }
}

function makeVideo(
  variants: WatchVideoRecord["variants"],
  overrides: Partial<WatchVideoRecord> = {},
): WatchVideoRecord {
  return {
    documentId: "vid-1",
    slug: "video-1",
    label: "FEATURE_FILM",
    title: "Video 1",
    description: null,
    snippet: null,
    posterUrl: null,
    streamingUrl: null,
    muxPlaybackId: null,
    duration: null,
    primaryLanguageBcp47: "en",
    siblings: [],
    chapters: [],
    variants,
    studyQuestions: [],
    bibleCitations: [],
    ...overrides,
  }
}

function makeSubtitle(
  slug: string,
  bcp47: string,
): VariantMedia["subtitles"][number] {
  return {
    documentId: `sub-${slug}`,
    languageSlug: slug,
    languageName: slug,
    languageNameNative: null,
    languageBcp47: bcp47,
    vttSrc: `https://x/${slug}.vtt`,
    primary: false,
    aiGenerated: false,
  }
}

// ── clampVariantIndex / selectActiveVariant (active index clamps) ────

describe("clampVariantIndex", () => {
  it("returns -1 when there are no variants", () => {
    expect(clampVariantIndex(0, 0)).toBe(-1)
    expect(clampVariantIndex(5, 0)).toBe(-1)
  })

  it("clamps an over-long index to the last variant", () => {
    expect(clampVariantIndex(9, 3)).toBe(2)
  })

  it("clamps a negative index to 0", () => {
    expect(clampVariantIndex(-3, 3)).toBe(0)
  })

  it("passes through an in-range index", () => {
    expect(clampVariantIndex(1, 3)).toBe(1)
  })
})

describe("selectActiveVariant", () => {
  it("is null when video is absent (inert)", () => {
    expect(selectActiveVariant(null, 0)).toBeNull()
  })

  it("is null when the video has no variants", () => {
    expect(selectActiveVariant(makeVideo([]), 0)).toBeNull()
  })

  it("clamps a stale over-long index from a prior video to the new last variant", () => {
    const video = makeVideo([
      makeVariant({ documentId: "a" }),
      makeVariant({ documentId: "b" }),
    ])
    // index 7 left over from a longer prior video — clamps, no undefined.
    expect(selectActiveVariant(video, 7)?.documentId).toBe("b")
  })

  it("returns the variant at the in-range index", () => {
    const video = makeVideo([
      makeVariant({ documentId: "a" }),
      makeVariant({ documentId: "b" }),
    ])
    expect(selectActiveVariant(video, 1)?.documentId).toBe("b")
  })
})

// ── resolveDefaultVariantIndex (default audio dub, slug-keyed) ───────

describe("resolveDefaultVariantIndex", () => {
  it("defaults to English when no preference and English exists", () => {
    const video = makeVideo([
      makeVariant({
        documentId: "es",
        slug: "v/spanish",
        languageBcp47: "es",
        languageSlug: "spanish",
      }),
      makeVariant({
        documentId: "en",
        slug: "v/english",
        languageBcp47: "en",
        languageSlug: "english",
      }),
    ])
    // primary is "en" → matches English at index 1.
    expect(resolveDefaultVariantIndex(video, [])).toBe(1)
  })

  it("matches the persisted preference by language SLUG, not bcp47 — ko vs ko-kmr do not collide", () => {
    const video = makeVideo(
      [
        makeVariant({
          documentId: "ko",
          slug: "v/korean",
          languageBcp47: "ko",
          languageSlug: "korean",
        }),
        makeVariant({
          documentId: "kmr",
          slug: "v/kurmanji",
          languageBcp47: "ko-kmr",
          languageSlug: "kurdish-kurmanji",
        }),
      ],
      { primaryLanguageBcp47: "fr" },
    )
    // Preferring "kurdish-kurmanji" must select the Kurmanji dub (index 1),
    // never the Korean one whose bcp47 prefix "ko" would collide.
    expect(resolveDefaultVariantIndex(video, ["kurdish-kurmanji"])).toBe(1)
    expect(resolveDefaultVariantIndex(video, ["korean"])).toBe(0)
  })

  it("falls back to index 0 when nothing resolves", () => {
    const video = makeVideo(
      [
        makeVariant({
          documentId: "fr",
          slug: "v/french",
          languageBcp47: "fr",
          languageSlug: "french",
        }),
        makeVariant({
          documentId: "de",
          slug: "v/german",
          languageBcp47: "de",
          languageSlug: "german",
        }),
      ],
      { primaryLanguageBcp47: "zz" },
    )
    expect(resolveDefaultVariantIndex(video, [])).toBe(0)
  })

  it("returns 0 for a variant-less video", () => {
    expect(resolveDefaultVariantIndex(makeVideo([]), [])).toBe(0)
  })
})

// ── resolveDefaultSubtitleSlug (subtitle default, slug-keyed) ────────

describe("resolveDefaultSubtitleSlug", () => {
  it("is null when there are no subtitles (loaded-empty dub)", () => {
    expect(resolveDefaultSubtitleSlug([], "en", null)).toBeNull()
    expect(resolveDefaultSubtitleSlug(null, "en", null)).toBeNull()
  })

  it("defaults to English subtitles when present", () => {
    const subs = [makeSubtitle("spanish", "es"), makeSubtitle("english", "en")]
    expect(resolveDefaultSubtitleSlug(subs, "en", null)).toBe("english")
  })

  it("honors a persisted subtitle slug preference exactly", () => {
    const subs = [makeSubtitle("korean", "ko"), makeSubtitle("english", "en")]
    expect(resolveDefaultSubtitleSlug(subs, "en", "korean")).toBe("korean")
  })
})

// ── selectDubMediaState (null / loading / error / loaded-empty) ──────

describe("selectDubMediaState", () => {
  const emptyMedia: VariantMedia = { downloads: [], subtitles: [] }

  it("is null/false/false when there is no active dub (inert)", () => {
    expect(selectDubMediaState(null, {}, {}, {})).toEqual({
      media: null,
      loading: false,
      error: false,
    })
  })

  it("distinguishes NOT-LOADED (null media) from LOADED-EMPTY ({[],[]})", () => {
    // Not loaded: no entry in any map → media is null.
    expect(selectDubMediaState("dub-1", {}, {}, {})).toEqual({
      media: null,
      loading: false,
      error: false,
    })
    // Loaded-empty: an explicit empty-arrays entry → media is the object,
    // NOT null. This is the load-bearing distinction the panels rely on to
    // show "No subtitles available" vs a spinner.
    const loadedEmpty = selectDubMediaState(
      "dub-1",
      { "dub-1": emptyMedia },
      {},
      {},
    )
    expect(loadedEmpty.media).toBe(emptyMedia)
    expect(loadedEmpty.media).not.toBeNull()
    expect(loadedEmpty.loading).toBe(false)
    expect(loadedEmpty.error).toBe(false)
  })

  it("reports loading", () => {
    expect(selectDubMediaState("dub-1", {}, { "dub-1": true }, {})).toEqual({
      media: null,
      loading: true,
      error: false,
    })
  })

  it("reports error", () => {
    expect(selectDubMediaState("dub-1", {}, {}, { "dub-1": true })).toEqual({
      media: null,
      loading: false,
      error: true,
    })
  })

  it("reads media for the ACTIVE id only — a prior video's id is isolated", () => {
    // After a video change the provider clears these maps; even before that,
    // selecting by active id means the new dub reads null while the old dub's
    // entry is never surfaced as the active media (per-id isolation).
    const maps = { "old-dub": emptyMedia }
    expect(selectDubMediaState("new-dub", maps, {}, {}).media).toBeNull()
    expect(selectDubMediaState("old-dub", maps, {}, {}).media).toBe(emptyMedia)
  })
})
