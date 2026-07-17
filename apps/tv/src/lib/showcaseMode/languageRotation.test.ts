import { pickViewerLanguage, type ShowcaseDubInput } from "./languageRotation"

// resolveDefaultSlug reads the device locale from Intl.DateTimeFormat; override it
// per-test so the asserted default-chain rung is unambiguous (Jest resolves en-US).
const realDateTimeFormat = Intl.DateTimeFormat
function mockDeviceLocale(locale: string) {
  Intl.DateTimeFormat = (() => ({
    resolvedOptions: () => ({ locale }),
  })) as unknown as typeof Intl.DateTimeFormat
}
afterEach(() => {
  Intl.DateTimeFormat = realDateTimeFormat
})

// A playable dub: admin's contract is published === true AND a non-empty hls. Pass a
// full `language` override to attach a bcp47 (default fixtures carry none).
function dub(
  languageSlug: string | null,
  overrides: Partial<ShowcaseDubInput> = {},
): ShowcaseDubInput {
  return {
    published: true,
    hls: `https://stream/${languageSlug ?? "none"}.m3u8`,
    duration: 600,
    language: languageSlug
      ? { slug: languageSlug, name: { en: languageSlug.toUpperCase() } }
      : null,
    muxVideo: { playbackId: `pb-${languageSlug ?? "none"}` },
    ...overrides,
  }
}

describe("pickViewerLanguage — playability", () => {
  it("returns null when the video has no dubs at all", () => {
    expect(pickViewerLanguage([], "english")).toBeNull()
    expect(pickViewerLanguage(null, "english")).toBeNull()
    expect(pickViewerLanguage(undefined, null)).toBeNull()
  })

  // The playable test is `published === true && hls != null && hls !== ""` —
  // an empty-string hls is NOT playable (normalizeVideo.ts's contract).
  it("rejects unpublished dubs and empty-string hls", () => {
    const unplayable = [
      dub("english", { published: false }),
      dub("spanish", { hls: "" }),
      dub("french", { hls: null }),
    ]
    expect(pickViewerLanguage(unplayable, "english")).toBeNull()
  })

  it("picks the one playable dub past unplayable siblings", () => {
    const dubs = [dub("english", { published: false }), dub("spanish")]
    const result = pickViewerLanguage(dubs, "spanish")
    expect(result?.hls).toBe("https://stream/spanish.m3u8")
    expect(result?.muxPlaybackId).toBe("pb-spanish")
  })

  // Language.name is admin's jsonb locale map, not a String — it must be read
  // through pickLocalizedName, never rendered raw.
  it("resolves the jsonb locale-map language name to a display string", () => {
    const dubs = [
      dub("spanish", {
        language: { slug: "spanish", name: { en: "Spanish" } },
      }),
    ]
    expect(pickViewerLanguage(dubs, "spanish")?.languageName).toBe("Spanish")
  })
})

describe("pickViewerLanguage — AE1: the viewer's chosen language plays", () => {
  it("plays the viewer's language when a playable dub carries it", () => {
    const dubs = [dub("english"), dub("russian")]
    const result = pickViewerLanguage(dubs, "russian")
    expect(result?.languageSlug).toBe("russian")
    expect(result?.hls).toBe("https://stream/russian.m3u8")
  })

  // Ordinary excerpts never rotate, so the lower-third makes no breadth claim.
  it("never claims a language, even across a multi-language video", () => {
    const dubs = [dub("english"), dub("spanish"), dub("french")]
    expect(pickViewerLanguage(dubs, "spanish")?.claimsLanguage).toBe(false)
    expect(pickViewerLanguage(dubs, "english")?.claimsLanguage).toBe(false)
  })

  // Identity is language.slug, NEVER bcp47: ko-kmr collides with ko, so matching on
  // the tag would let a "korean" preference grab the Kurmanji dub, and vice versa.
  it("keys the preference on language.slug, not the colliding bcp47", () => {
    const dubs = [
      dub("korean", {
        language: { slug: "korean", bcp47: "ko", name: { en: "Korean" } },
      }),
      dub("kurmanji", {
        language: { slug: "kurmanji", bcp47: "ko", name: { en: "Kurmanji" } },
      }),
    ]
    expect(pickViewerLanguage(dubs, "korean")?.languageSlug).toBe("korean")
    expect(pickViewerLanguage(dubs, "kurmanji")?.languageSlug).toBe("kurmanji")
  })
})

describe("pickViewerLanguage — AE2: default resolution when the language is absent", () => {
  it("resolves the device-locale dub by bcp47 when the viewer has no preference", () => {
    // Device en-US must pick English over the first-listed Spanish — proof the bcp47
    // device-locale rung fires (Spanish is options[0], so a blind first-pick would take it).
    mockDeviceLocale("en-US")
    const dubs = [
      dub("spanish", {
        language: { slug: "spanish", bcp47: "es", name: { en: "Spanish" } },
      }),
      dub("english", {
        language: { slug: "english", bcp47: "en", name: { en: "English" } },
      }),
    ]
    const result = pickViewerLanguage(dubs, null)
    expect(result?.languageSlug).toBe("english")
    expect(result?.claimsLanguage).toBe(false)
  })

  it("falls to the default chain when the preference has no playable dub here — never errors", () => {
    mockDeviceLocale("en-US")
    const dubs = [
      dub("spanish", {
        language: { slug: "spanish", bcp47: "es", name: { en: "Spanish" } },
      }),
      dub("english", {
        language: { slug: "english", bcp47: "en", name: { en: "English" } },
      }),
    ]
    // Viewer picked Russian; this video has none, so the chain resolves to English.
    const result = pickViewerLanguage(dubs, "russian")
    expect(result?.languageSlug).toBe("english")
    expect(result?.claimsLanguage).toBe(false)
  })

  it("resolves the English rung by bcp47 when the device locale matches nothing", () => {
    // Device de-DE cannot match; only the English fallback rung can pick English here.
    mockDeviceLocale("de-DE")
    const dubs = [
      dub("french", {
        language: { slug: "french", bcp47: "fr", name: { en: "French" } },
      }),
      dub("english", {
        language: { slug: "english", bcp47: "en", name: { en: "English" } },
      }),
    ]
    expect(pickViewerLanguage(dubs, null)?.languageSlug).toBe("english")
  })

  // This is exactly why showcaseVideoFragment must select the dubs' bcp47: with it
  // absent, the device-locale and English rungs have no inputs and the chain silently
  // degrades to the first-listed dub regardless of the viewer's device.
  it("degrades to the first dub when no dub carries a bcp47", () => {
    mockDeviceLocale("en-US")
    const dubs = [
      dub("spanish", {
        language: { slug: "spanish", name: { en: "Spanish" } },
      }),
      dub("english", {
        language: { slug: "english", name: { en: "English" } },
      }),
    ]
    expect(pickViewerLanguage(dubs, null)?.languageSlug).toBe("spanish")
  })
})

describe("pickViewerLanguage — slug-less dubs", () => {
  it("plays a slug-less dub without claiming a language", () => {
    mockDeviceLocale("en-US")
    const result = pickViewerLanguage([dub(null)], null)
    expect(result?.hls).toBe("https://stream/none.m3u8")
    expect(result?.languageSlug).toBeNull()
    expect(result?.claimsLanguage).toBe(false)
  })

  it("prefers a slug-bearing dub over a slug-less one", () => {
    mockDeviceLocale("en-US")
    const result = pickViewerLanguage([dub(null), dub("spanish")], null)
    expect(result?.languageSlug).toBe("spanish")
  })
})

// Excerpt windows (R6) are not language policy — they live in sourceResolution.ts
// and are covered by sourceResolution.test.ts.
