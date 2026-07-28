// U2 audio-preference threading, proven on the PURE helpers (the provider is a
// thin shell; TV has no @testing-library/react-native). Two concerns:
//   1. resolveDefaultVariantIndex's [carried, persisted] precedence over the
//      default-dub chain (carried → persisted → device → primary → English → first).
//   2. slugToPersistForPick — the slug an explicit pick should persist app-wide.
// The device-locale rung reads Intl, which under jest resolves to the runner's
// locale; every test stubs it to a non-matching "zz-ZZ" so rung outcomes are
// unambiguous and a preference is the ONLY thing that can move off the fallback.

import {
  resolveDefaultVariantIndex,
  slugToPersistForPick,
} from "./watchSessionState"
import type { WatchVideoRecord } from "../lib/normalizeVideo"

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

// urdu(0) / korean(1) / spanish(2); primary "fr" and no en/fr variant so the
// device (stubbed zz), primary, and English rungs all miss — only an explicit
// preference can move off the index-0 fallback.
function multiLangVideo(): WatchVideoRecord {
  return makeVideo(
    [
      makeVariant({
        documentId: "ur",
        slug: "v/urdu",
        languageBcp47: "ur",
        languageSlug: "urdu",
      }),
      makeVariant({
        documentId: "ko",
        slug: "v/korean",
        languageBcp47: "ko",
        languageSlug: "korean",
      }),
      makeVariant({
        documentId: "es",
        slug: "v/spanish",
        languageBcp47: "es",
        languageSlug: "spanish",
      }),
    ],
    { primaryLanguageBcp47: "fr" },
  )
}

beforeEach(() => {
  // Stub the device locale to a language present on no fixture, so device-rung
  // outcomes never depend on the CI runner's locale (Intl → en-US typically).
  jest.spyOn(Intl, "DateTimeFormat").mockImplementation(
    () =>
      ({
        resolvedOptions: () => ({ locale: "zz-ZZ" }),
      }) as unknown as Intl.DateTimeFormat,
  )
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ── resolveDefaultVariantIndex — [carried, persisted] precedence ─────

describe("resolveDefaultVariantIndex — carried/persisted precedence", () => {
  it("prefers the carried slug over the persisted one when both match", () => {
    // carried=korean(1) beats persisted=spanish(2).
    expect(
      resolveDefaultVariantIndex(multiLangVideo(), ["korean", "spanish"]),
    ).toBe(1)
  })

  it("uses the persisted slug when the carried one is null", () => {
    expect(
      resolveDefaultVariantIndex(multiLangVideo(), [null, "spanish"]),
    ).toBe(2)
  })

  it("uses the persisted slug when the carried one has no match on this video (soft fall-through)", () => {
    // carried=french is absent → skipped; persisted=spanish(2) wins.
    expect(
      resolveDefaultVariantIndex(multiLangVideo(), ["french", "spanish"]),
    ).toBe(2)
  })

  it("falls through the rest of the chain, without error, when no preference matches", () => {
    // Neither preference is present; device(zz)/primary(fr)/English all miss →
    // first variant (index 0).
    expect(
      resolveDefaultVariantIndex(multiLangVideo(), ["french", "german"]),
    ).toBe(0)
  })

  it("matches each list entry EXACTLY on languageSlug — ko must not match ko-kmr", () => {
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
    expect(resolveDefaultVariantIndex(video, ["kurdish-kurmanji"])).toBe(1)
    expect(resolveDefaultVariantIndex(video, ["korean"])).toBe(0)
  })
})

// ── resolveDefaultVariantIndex — existing chain behavior unchanged ───

describe("resolveDefaultVariantIndex — no preferences (unchanged)", () => {
  it("defaults to English via the primary-language rung when no preference is given", () => {
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
    // primary "en" → English at index 1, whether the list is empty or all-null.
    expect(resolveDefaultVariantIndex(video, [])).toBe(1)
    expect(resolveDefaultVariantIndex(video, [null, null])).toBe(1)
  })

  it("returns 0 for a variant-less video", () => {
    expect(resolveDefaultVariantIndex(makeVideo([]), [])).toBe(0)
  })
})

// ── slugToPersistForPick — write seam ───────────────────────────────

describe("slugToPersistForPick", () => {
  it("returns the picked variant's languageSlug for a valid index", () => {
    const video = makeVideo([
      makeVariant({ languageSlug: "english" }),
      makeVariant({ documentId: "ko", languageSlug: "korean" }),
    ])
    expect(slugToPersistForPick(video, 1)).toBe("korean")
  })

  it("returns null (no write) for a variant that carries no languageSlug", () => {
    const video = makeVideo([makeVariant({ languageSlug: null })])
    expect(slugToPersistForPick(video, 0)).toBeNull()
  })

  it("returns null (no write) for an out-of-range index", () => {
    const video = makeVideo([makeVariant()])
    expect(slugToPersistForPick(video, 5)).toBeNull()
    expect(slugToPersistForPick(video, -1)).toBeNull()
  })

  it("returns null when there is no video", () => {
    expect(slugToPersistForPick(null, 0)).toBeNull()
  })
})
