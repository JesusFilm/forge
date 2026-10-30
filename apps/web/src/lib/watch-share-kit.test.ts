import { describe, expect, it } from "vitest"

import {
  WATCH_SHARE_KIT_EDITORIAL_PROMPTS,
  WATCH_SHARE_KIT_SOURCES,
  buildShareKitInvitation,
  buildShareKitLink,
  resolveShareKitLanguages,
  resolveShareKitPrompts,
  resolveShareKitSources,
} from "./watch-share-kit"
import type { WatchLanguagePickerVariant } from "./content"

const ORIGIN = "https://share.example"

function variant(
  slug: string | null,
  name: string | null,
  overrides: Partial<WatchLanguagePickerVariant> = {},
): WatchLanguagePickerVariant {
  return {
    documentId: `doc-${slug}`,
    hls: "https://stream.example/a.m3u8",
    published: true,
    language: { slug, name },
    ...overrides,
  }
}

describe("buildShareKitLink", () => {
  it("builds the recipient audio link while the sender's page language is untouched", () => {
    const senderPageLanguage = "english"
    const recipient = buildShareKitLink({
      origin: ORIGIN,
      videoSlug: "seed-demo-video",
      languageSlug: "spanish-latin-american",
    })
    const sender = buildShareKitLink({
      origin: ORIGIN,
      videoSlug: "seed-demo-video",
      languageSlug: senderPageLanguage,
    })

    expect(recipient).toBe(
      "https://share.example/watch/seed-demo-video.html/spanish-latin-american.html?playback_source=share",
    )
    expect(sender).toBe(
      "https://share.example/watch/seed-demo-video.html?playback_source=share",
    )
    expect(senderPageLanguage).toBe("english")
  })

  it("returns null instead of a malformed link for an invalid identity", () => {
    expect(
      buildShareKitLink({
        origin: ORIGIN,
        videoSlug: "Not A Slug",
        languageSlug: "english",
      }),
    ).toBeNull()
  })
})

describe("resolveShareKitLanguages", () => {
  it("offers only playable catalog languages, the sender's own first, without duplicates", () => {
    const options = resolveShareKitLanguages({
      current: { slug: "english", name: "English" },
      variants: [
        variant("spanish-latin-american", "Spanish, Latin American"),
        variant("english", "English"),
        variant("french", "French", { published: false }),
        variant("german", "German", { hls: null }),
        variant(null, "No slug"),
        variant("spanish-latin-american", "Spanish, Latin American"),
        variant("arabic", "Arabic"),
      ],
    })

    expect(options.map((option) => option.slug)).toEqual([
      "english",
      "arabic",
      "spanish-latin-american",
    ])
  })

  it("keeps the sender's language available before the catalog list has loaded", () => {
    expect(
      resolveShareKitLanguages({
        current: { slug: "english", name: null },
        variants: [],
      }),
    ).toEqual([{ slug: "english", name: "English", nativeName: null }])
  })

  it("carries the native name through for display", () => {
    const [, spanish] = resolveShareKitLanguages({
      current: { slug: "english", name: "English" },
      variants: [
        {
          ...variant("spanish", "Spanish"),
          language: { slug: "spanish", name: "Spanish", nativeName: "Español" },
        },
      ],
    })

    expect(spanish).toEqual({
      slug: "spanish",
      name: "Spanish",
      nativeName: "Español",
    })
  })
})

describe("resolveShareKitPrompts", () => {
  it("uses authored study questions when the film has them", () => {
    expect(
      resolveShareKitPrompts([" Who is Jesus to you? ", "", "Why?"]),
    ).toEqual({ source: "authored", prompts: ["Who is Jesus to you?", "Why?"] })
  })

  it("labels original editorial suggestions when no study questions are authored", () => {
    const result = resolveShareKitPrompts([" ", ""])

    expect(result.source).toBe("editorial")
    expect(result.prompts).toEqual([...WATCH_SHARE_KIT_EDITORIAL_PROMPTS])
    expect(result.prompts.length).toBeGreaterThan(0)
  })
})

describe("buildShareKitInvitation", () => {
  it("names the film, runtime, audio language and carries the link", () => {
    const text = buildShareKitInvitation({
      title: "My Last Day",
      url: "https://share.example/watch/my-last-day.html/spanish.html?playback_source=share",
      runtimeMinutes: 4,
      languageName: "Spanish",
    })

    expect(text).toContain("My Last Day")
    expect(text).toContain("4 minutes")
    expect(text).toContain("Spanish")
    expect(text.endsWith("playback_source=share")).toBe(true)
  })

  it("omits the runtime when it is not known", () => {
    const text = buildShareKitInvitation({
      title: "My Last Day",
      url: "https://share.example/x",
      runtimeMinutes: null,
      languageName: "English",
    })

    expect(text).not.toMatch(/minutes?/)
  })
})

describe("resolveShareKitSources", () => {
  it("ships real guide pages and PDFs with attribution metadata", () => {
    const sources = resolveShareKitSources(WATCH_SHARE_KIT_SOURCES)

    expect(sources.map((source) => source.id)).toEqual([
      "short-film-gathering",
      "amazing-question",
    ])
    for (const source of sources) {
      expect(source.publisher).toBe("Jesus Film Project")
      expect(source.language).toBe("English")
      expect(source.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(new URL(source.pageHref).host).toBe("www.jesusfilm.org")
      expect(new URL(source.pdfHref!).pathname).toMatch(/\.pdf$/)
    }
  })

  it("removes unusable resources and unusable PDFs without dropping the rest", () => {
    const [good] = WATCH_SHARE_KIT_SOURCES
    const sources = resolveShareKitSources([
      { ...good, id: "http", pageHref: "http://www.jesusfilm.org/guide/" },
      { ...good, id: "script", pageHref: "javascript:alert(1)" },
      { ...good, id: "foreign", pageHref: "https://evil.example/guide/" },
      { ...good, id: "bad-pdf", pdfHref: "https://www.jesusfilm.org/page/" },
      good,
    ])

    expect(sources.map((source) => source.id)).toEqual(["bad-pdf", good.id])
    expect(sources[0].pdfHref).toBeUndefined()
    expect(sources[1].pdfHref).toBe(good.pdfHref)
  })
})
