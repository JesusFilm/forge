import { print } from "graphql"

import { GET_WATCH_SETTING, GET_WATCH_HOME_VIDEOS } from "../queries"
import {
  selectHeroStreamUrl,
  type HeroStreamVariantInput,
} from "../watchHome/heroStream"

// Real-shape variant fixture mirroring GET_VIDEO_BY_SLUG's `variants: dubs`
// entries (extra fields included so the structural slice is exercised against
// the production shape, not a minimal mock).
function variant(
  overrides: Partial<HeroStreamVariantInput> & {
    documentId?: string
    slug?: string
    muxVideo?: { playbackId: string | null } | null
  } = {},
): HeroStreamVariantInput {
  return {
    documentId: "dub-1",
    slug: "video-slug/english",
    published: true,
    hls: "https://stream.mux.com/abc123.m3u8",
    language: { slug: "english" },
    muxVideo: { playbackId: "abc123" },
    ...overrides,
  }
}

describe("GET_WATCH_HOME_VIDEOS — lean payload guard", () => {
  const printed = print(GET_WATCH_HOME_VIDEOS)

  it("selects no dubs anywhere (the 9.5MB bulk-payload trap stays fixed)", () => {
    expect(printed).not.toMatch(/\bdubs\b/)
    expect(printed).not.toMatch(/\bvariants\b/)
    expect(printed).not.toMatch(/\bdownloads\b/)
    expect(printed).not.toMatch(/\bsubtitles\b/)
  })

  it("selects watchHomeVideos and declares $coreIds/$locale/$languageSlug", () => {
    expect(printed).toContain("query GetWatchHomeVideos")
    expect(printed).toContain("watchHomeVideos(coreIds: $coreIds)")
    expect(printed).toContain("$coreIds: [String!]!")
    expect(printed).toContain("$locale: String!")
    expect(printed).toMatch(/\$languageSlug: String(?!!)/)
  })

  it("narrows locales by the locale pair on parents and children", () => {
    const localeSelections = printed.match(
      /locales\(locale: \$locale, languageSlug: \$languageSlug\)/g,
    )
    expect(localeSelections).toHaveLength(2)
  })
})

// The Home Experience body rides the SAME public, no-bearer surface as TV: only
// watchSetting / experienceBySlug (never the editor-gated `experiences` list),
// and never a dubs/variants selection (the bulk-payload trap the hero fetch also
// guards). A regression that pulls the gated list or a heavy media join here
// would 401 the anonymous fleet or reinflate the payload — this fails first.
describe("GET_WATCH_SETTING — home Experience public-query guard", () => {
  const printed = print(GET_WATCH_SETTING)

  it("reads the homepage Experience via the public watchSetting query", () => {
    expect(printed).toContain("query GetWatchSetting")
    expect(printed).toContain("watchSetting(locale: $locale)")
    expect(printed).toContain("homepageExperience")
  })

  it("never touches the editor-gated experiences list", () => {
    expect(printed).not.toMatch(/\bexperiences\s*\(/)
  })

  it("selects no dubs/variants (the heavy-media-join trap stays out)", () => {
    expect(printed).not.toMatch(/\bdubs\b/)
    expect(printed).not.toMatch(/\bvariants\b/)
  })
})

describe("selectHeroStreamUrl — lazy hero stream selection", () => {
  it("returns null for a missing or empty variant list", () => {
    expect(selectHeroStreamUrl(null)).toBeNull()
    expect(selectHeroStreamUrl(undefined)).toBeNull()
    expect(selectHeroStreamUrl([])).toBeNull()
  })

  it("the english languageSlug match wins, even listed after other playable variants", () => {
    const variants = [
      variant({
        documentId: "dub-fr",
        language: { slug: "french" },
        hls: "https://stream.mux.com/french.m3u8",
      }),
      variant({
        documentId: "dub-en",
        language: { slug: "english" },
        hls: "https://stream.mux.com/english.m3u8",
      }),
    ]
    expect(selectHeroStreamUrl(variants)).toBe(
      "https://stream.mux.com/english.m3u8",
    )
  })

  it("falls back to the first published variant with hls when english is absent", () => {
    const variants = [
      variant({
        documentId: "dub-ko",
        language: { slug: "korean" },
        hls: "https://stream.mux.com/korean.m3u8",
      }),
      variant({
        documentId: "dub-fr",
        language: { slug: "french" },
        hls: "https://stream.mux.com/french.m3u8",
      }),
    ]
    expect(selectHeroStreamUrl(variants)).toBe(
      "https://stream.mux.com/korean.m3u8",
    )
  })

  it("skips unpublished variants — an unpublished english dub never wins", () => {
    const variants = [
      variant({
        documentId: "dub-en",
        published: false,
        language: { slug: "english" },
        hls: "https://stream.mux.com/english.m3u8",
      }),
      variant({
        documentId: "dub-fr",
        language: { slug: "french" },
        hls: "https://stream.mux.com/french.m3u8",
      }),
    ]
    expect(selectHeroStreamUrl(variants)).toBe(
      "https://stream.mux.com/french.m3u8",
    )
  })

  it("skips variants without hls", () => {
    const variants = [
      variant({
        documentId: "dub-en",
        language: { slug: "english" },
        hls: null,
      }),
      variant({
        documentId: "dub-fr",
        language: { slug: "french" },
        hls: "https://stream.mux.com/french.m3u8",
      }),
    ]
    expect(selectHeroStreamUrl(variants)).toBe(
      "https://stream.mux.com/french.m3u8",
    )
  })

  it("gates every candidate through validateStreamingUrl — a non-Mux hls falls through", () => {
    const variants = [
      variant({
        documentId: "dub-en",
        language: { slug: "english" },
        hls: "https://evil.example.com/english.m3u8",
      }),
      variant({
        documentId: "dub-fr",
        language: { slug: "french" },
        hls: "https://stream.mux.com/french.m3u8",
      }),
    ]
    expect(selectHeroStreamUrl(variants)).toBe(
      "https://stream.mux.com/french.m3u8",
    )
  })

  // Prod regression: the jesus English dub shipped "…m3u8\n". WHATWG URL
  // validation strips the newline but the raw string reached the native
  // player → Mux 400 → instant STREAM_ERROR skipped the hero slide.
  it("returns a TRIMMED url when the winning hls carries stray whitespace", () => {
    const variants = [
      variant({
        documentId: "dub-en",
        language: { slug: "english" },
        hls: "https://stream.mux.com/english.m3u8\n",
      }),
      variant({
        documentId: "dub-fr",
        language: { slug: "french" },
        hls: "https://stream.mux.com/french.m3u8",
      }),
    ]
    expect(selectHeroStreamUrl(variants)).toBe(
      "https://stream.mux.com/english.m3u8",
    )
  })

  it("treats a whitespace-only hls as unplayable", () => {
    const variants = [
      variant({
        documentId: "dub-en",
        language: { slug: "english" },
        hls: "  \n",
      }),
      variant({
        documentId: "dub-fr",
        language: { slug: "french" },
        hls: "https://stream.mux.com/french.m3u8",
      }),
    ]
    expect(selectHeroStreamUrl(variants)).toBe(
      "https://stream.mux.com/french.m3u8",
    )
  })

  it("returns null when nothing playable remains (slide-skip path)", () => {
    const variants = [
      variant({ documentId: "dub-1", published: false }),
      variant({
        documentId: "dub-2",
        language: { slug: "french" },
        hls: null,
      }),
      variant({
        documentId: "dub-3",
        language: { slug: "korean" },
        hls: "https://not-mux.example.com/korean.m3u8",
      }),
    ]
    expect(selectHeroStreamUrl(variants)).toBeNull()
  })
})
