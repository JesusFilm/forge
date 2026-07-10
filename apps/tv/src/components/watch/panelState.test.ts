import type { DubMediaState } from "../../contexts/watchSessionState"
import type {
  VariantMedia,
  WatchSubtitle,
  WatchVariant,
} from "../../lib/normalizeVideo"
import {
  annotateVariantRows,
  deriveSubtitlePanelState,
  isSubtitleRowActive,
  isVariantPlayable,
} from "./panelState"

// ── Fixtures ───────────────────────────────────────────────────────────────

function subtitle(slug: string): WatchSubtitle {
  return {
    documentId: `sub-${slug}`,
    languageSlug: slug,
    languageName: slug,
    languageNameNative: null,
    languageBcp47: slug,
    vttSrc: `https://example.test/${slug}.vtt`,
    primary: false,
    aiGenerated: false,
  }
}

function media(subtitles: WatchSubtitle[]): VariantMedia {
  return { downloads: [], subtitles }
}

function variant(overrides: Partial<WatchVariant> = {}): WatchVariant {
  return {
    documentId: "v1",
    slug: "english",
    published: true,
    hls: "https://stream.mux.com/v1.m3u8",
    duration: 100,
    languageCoreId: null,
    languageBcp47: "en",
    languageSlug: "english",
    languageName: "English",
    languageNameNative: null,
    muxPlaybackId: null,
    ...overrides,
  }
}

const NOT_LOADED: DubMediaState = { media: null, loading: false, error: false }

// ── deriveSubtitlePanelState ─────────────────────────────────────────────────

describe("deriveSubtitlePanelState", () => {
  it("maps not-loaded (media null, no flags) → loading", () => {
    // media == null is "not yet fetched"; render as loading so the panel never
    // flashes an empty list before the lazy fetch resolves.
    expect(deriveSubtitlePanelState(NOT_LOADED)).toEqual({ kind: "loading" })
  })

  it("maps loading flag → loading", () => {
    expect(
      deriveSubtitlePanelState({ media: null, loading: true, error: false }),
    ).toEqual({ kind: "loading" })
  })

  it("maps error flag → error", () => {
    expect(
      deriveSubtitlePanelState({ media: null, loading: false, error: true }),
    ).toEqual({ kind: "error" })
  })

  it("loading takes precedence over error", () => {
    expect(
      deriveSubtitlePanelState({ media: null, loading: true, error: true }),
    ).toEqual({ kind: "loading" })
  })

  it("maps loaded-empty (media non-null, subtitles []) → loaded with empty list", () => {
    expect(
      deriveSubtitlePanelState({
        media: media([]),
        loading: false,
        error: false,
      }),
    ).toEqual({ kind: "loaded", subtitles: [] })
  })

  it("maps loaded-list → loaded with the subtitle rows, sorted A→Z by name", () => {
    // Source order is spanish-then-french; the panel state returns them sorted.
    expect(
      deriveSubtitlePanelState({
        media: media([subtitle("spanish"), subtitle("french")]),
        loading: false,
        error: false,
      }),
    ).toEqual({
      kind: "loaded",
      subtitles: [subtitle("french"), subtitle("spanish")],
    })
  })

  it("sorts an unordered subtitle list A→Z by display name", () => {
    const result = deriveSubtitlePanelState({
      media: media([subtitle("zulu"), subtitle("arabic"), subtitle("french")]),
      loading: false,
      error: false,
    })
    expect(result).toEqual({
      kind: "loaded",
      subtitles: [subtitle("arabic"), subtitle("french"), subtitle("zulu")],
    })
  })

  it("does not mutate the source subtitle array when sorting", () => {
    const subs = [subtitle("zulu"), subtitle("arabic")]
    deriveSubtitlePanelState({
      media: media(subs),
      loading: false,
      error: false,
    })
    expect(subs.map((s) => s.languageSlug)).toEqual(["zulu", "arabic"])
  })
})

// ── isSubtitleRowActive ──────────────────────────────────────────────────────

describe("isSubtitleRowActive", () => {
  it("is active only when enabled AND slug matches", () => {
    expect(isSubtitleRowActive(subtitle("spanish"), true, "spanish")).toBe(true)
  })

  it("is inactive when subtitles are off, even if the slug matches", () => {
    expect(isSubtitleRowActive(subtitle("spanish"), false, "spanish")).toBe(
      false,
    )
  })

  it("is inactive when the slug does not match", () => {
    expect(isSubtitleRowActive(subtitle("spanish"), true, "french")).toBe(false)
    expect(isSubtitleRowActive(subtitle("spanish"), true, null)).toBe(false)
  })
})

// ── isVariantPlayable / annotateVariantRows ─────────────────────────────────

describe("isVariantPlayable", () => {
  it("is playable with a Mux-hosted HLS url the player accepts", () => {
    expect(isVariantPlayable({ hls: "https://stream.mux.com/v.m3u8" })).toBe(
      true,
    )
  })

  it("is not playable when hls is null or empty", () => {
    expect(isVariantPlayable({ hls: null })).toBe(false)
    expect(isVariantPlayable({ hls: "" })).toBe(false)
  })

  it("is not playable for a non-Mux url the player would reject", () => {
    // Raw CMS hls can be a non-Mux host; the player's validateStreamingUrl
    // rejects it, so the row must be disabled rather than selectable-but-dead.
    expect(isVariantPlayable({ hls: "https://example.test/v.m3u8" })).toBe(
      false,
    )
  })
})

describe("annotateVariantRows", () => {
  it("disables unplayable rows (null / empty / non-Mux) and keeps Mux rows enabled", () => {
    const rows = annotateVariantRows(
      [
        variant({ documentId: "v1", hls: "https://stream.mux.com/v1.m3u8" }),
        variant({ documentId: "v2", hls: null }),
        variant({ documentId: "v3", hls: "" }),
        variant({ documentId: "v4", hls: "https://example.test/v4.m3u8" }),
      ],
      0,
    )
    expect(rows.map((r) => r.disabled)).toEqual([false, true, true, true])
  })

  it("preserves the original index for write-back", () => {
    const rows = annotateVariantRows(
      [
        variant({ documentId: "v1" }),
        variant({ documentId: "v2" }),
        variant({ documentId: "v3" }),
      ],
      1,
    )
    expect(rows.map((r) => r.index)).toEqual([0, 1, 2])
  })

  it("marks the active index active and nothing else", () => {
    const rows = annotateVariantRows(
      [
        variant({ documentId: "v1" }),
        variant({ documentId: "v2" }),
        variant({ documentId: "v3" }),
      ],
      1,
    )
    expect(rows.map((r) => r.active)).toEqual([false, true, false])
  })

  it("returns an empty list for no variants", () => {
    expect(annotateVariantRows([], 0)).toEqual([])
  })

  it("sorts rows A→Z by display name while preserving each row's source index", () => {
    // Source order: Spanish(0), Arabic(1), French(2); French is the active dub.
    const rows = annotateVariantRows(
      [
        variant({ documentId: "v1", languageName: "Spanish" }),
        variant({ documentId: "v2", languageName: "Arabic" }),
        variant({ documentId: "v3", languageName: "French" }),
      ],
      2,
    )
    // Display order is alphabetical…
    expect(rows.map((r) => r.variant.languageName)).toEqual([
      "Arabic",
      "French",
      "Spanish",
    ])
    // …but each row keeps its ORIGINAL index, so selection writes back the
    // right variant: French stays index 2 (the active one), Spanish stays 0.
    expect(rows.map((r) => r.index)).toEqual([1, 2, 0])
    expect(rows.map((r) => r.active)).toEqual([false, true, false])
  })

  it("falls back to slug, then slug-derived name, when languageName is null", () => {
    const rows = annotateVariantRows(
      [
        variant({ documentId: "v1", languageName: null, languageSlug: "zulu" }),
        variant({
          documentId: "v2",
          languageName: null,
          languageSlug: "amharic",
        }),
      ],
      0,
    )
    expect(rows.map((r) => r.variant.languageSlug)).toEqual(["amharic", "zulu"])
  })
})
