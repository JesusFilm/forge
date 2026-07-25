import type { ShowcaseDubInput } from "./languageRotation"
import {
  buildInterstitialContent,
  countDistinctLanguages,
  MAX_AUTHORED_STAT_LINES,
} from "./statLines"

// A playable dub: admin's contract is published === true AND a non-empty hls.
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

describe("countDistinctLanguages", () => {
  // The claim is "available in N languages", so the unit is the LANGUAGE, not the
  // dub row — several dubs can carry one slug and would inflate the number.
  it("counts distinct language slugs, not dub rows", () => {
    const dubs = [dub("english"), dub("english"), dub("spanish")]
    expect(countDistinctLanguages(dubs)).toBe(2)
  })

  it("excludes unpublished dubs and empty-string hls from the count", () => {
    const dubs = [
      dub("english"),
      dub("spanish", { published: false }),
      dub("french", { hls: "" }),
      dub("german", { hls: null }),
    ]
    expect(countDistinctLanguages(dubs)).toBe(1)
  })

  it("ignores playable dubs that carry no language slug", () => {
    expect(countDistinctLanguages([dub(null), dub("english")])).toBe(1)
  })

  it("returns 0 for empty, null and undefined dub lists", () => {
    expect(countDistinctLanguages([])).toBe(0)
    expect(countDistinctLanguages(null)).toBe(0)
    expect(countDistinctLanguages(undefined)).toBe(0)
  })
})

describe("buildInterstitialContent — authored lines (R9)", () => {
  it("keeps one authored claim per line", () => {
    const content = buildInterstitialContent({
      authoredLines: ["2,100+ languages", "60 felt needs"],
    })
    expect(content?.authoredLines).toEqual([
      "2,100+ languages",
      "60 felt needs",
    ])
  })

  it("drops blank and whitespace-only lines", () => {
    const content = buildInterstitialContent({
      authoredLines: ["2,100+ languages", "", "   ", "\t", "60 felt needs"],
    })
    expect(content?.authoredLines).toEqual([
      "2,100+ languages",
      "60 felt needs",
    ])
  })

  it("trims surrounding whitespace off each claim", () => {
    const content = buildInterstitialContent({
      authoredLines: ["  2,100+ languages  "],
    })
    expect(content?.authoredLines).toEqual(["2,100+ languages"])
  })

  // The interstitial is a fixed full-screen card with no scroll: past the cap the
  // lines would render off the bottom of a 1080p TV.
  it("caps the authored lines a curator can push onto one card", () => {
    const authored = Array.from({ length: 9 }, (_, i) => `claim ${i}`)
    const content = buildInterstitialContent({ authoredLines: authored })
    expect(content?.authoredLines).toHaveLength(MAX_AUTHORED_STAT_LINES)
    expect(content?.authoredLines[0]).toBe("claim 0")
  })

  it("counts blanks out before the cap, never against it", () => {
    const content = buildInterstitialContent({
      authoredLines: ["a", "", "b", "   ", "c", "", "d"],
    })
    expect(content?.authoredLines).toEqual(["a", "b", "c", "d"])
  })
})

describe("buildInterstitialContent — R9's skip-interstitials signal", () => {
  // R9: authored globals ARE the breadth claim. One video's dub count is not, so
  // an interstitial without authored stats must not render at all.
  it("returns null when no authored stats exist", () => {
    expect(buildInterstitialContent({ authoredLines: [] })).toBeNull()
  })

  it("returns null rather than a live-only interstitial", () => {
    const content = buildInterstitialContent({
      authoredLines: [],
      liveTitle: "The Birth of Jesus",
      liveLanguageCount: 42,
    })
    expect(content).toBeNull()
  })

  it("returns null when the authored lines are all blank", () => {
    expect(
      buildInterstitialContent({
        authoredLines: ["", "   "],
        liveTitle: "The Birth of Jesus",
        liveLanguageCount: 42,
      }),
    ).toBeNull()
  })

  it("returns null for a missing stats section (null / undefined lines)", () => {
    expect(buildInterstitialContent({ authoredLines: null })).toBeNull()
    expect(buildInterstitialContent({ authoredLines: undefined })).toBeNull()
  })
})

describe("buildInterstitialContent — the live line (R9)", () => {
  it("formats the plural live line from the current video's language count", () => {
    const content = buildInterstitialContent({
      authoredLines: ["60 felt needs"],
      liveTitle: "The Birth of Jesus",
      liveLanguageCount: 42,
    })
    expect(content?.liveLine).toBe(
      "The Birth of Jesus is available in 42 languages",
    )
  })

  it("formats the singular live line for a one-language video", () => {
    const content = buildInterstitialContent({
      authoredLines: ["60 felt needs"],
      liveTitle: "The Birth of Jesus",
      liveLanguageCount: 1,
    })
    expect(content?.liveLine).toBe(
      "The Birth of Jesus is available in 1 language",
    )
  })

  // Hermes: the repo keeps number formatting Intl-free (see clockFormat.ts), and
  // JESUS-scale videos really do reach four digits.
  it("groups thousands without Intl", () => {
    const content = buildInterstitialContent({
      authoredLines: ["60 felt needs"],
      liveTitle: "JESUS",
      liveLanguageCount: 2259,
    })
    expect(content?.liveLine).toBe("JESUS is available in 2,259 languages")
  })

  it("renders the authored card with no live line when the count is zero", () => {
    const content = buildInterstitialContent({
      authoredLines: ["60 felt needs"],
      liveTitle: "The Birth of Jesus",
      liveLanguageCount: 0,
    })
    expect(content?.authoredLines).toEqual(["60 felt needs"])
    expect(content?.liveLine).toBeNull()
  })

  it("makes no live claim when the title or the count is unknown", () => {
    expect(
      buildInterstitialContent({
        authoredLines: ["60 felt needs"],
        liveTitle: null,
        liveLanguageCount: 42,
      })?.liveLine,
    ).toBeNull()
    expect(
      buildInterstitialContent({
        authoredLines: ["60 felt needs"],
        liveTitle: "The Birth of Jesus",
        liveLanguageCount: null,
      })?.liveLine,
    ).toBeNull()
    expect(
      buildInterstitialContent({
        authoredLines: ["60 felt needs"],
        liveTitle: "   ",
        liveLanguageCount: 42,
      })?.liveLine,
    ).toBeNull()
  })
})
