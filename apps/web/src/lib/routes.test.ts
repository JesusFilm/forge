import { describe, expect, it } from "vitest"

import {
  WATCH_BASE_PATH,
  WATCH_CANONICAL_ORIGIN,
  asContentSlug,
  asLocaleSlug,
  languagesIndexPath,
  localizedHistoryPath,
  localizedLanguagesPath,
  languageVideosIndexPath,
  localizedHomeAbsolute,
  localizedHomePath,
  parseWatchPath,
  searchPath,
  isLanguageLessWatchEpisodePathEligible,
  tryAsContentSlug,
  tryAsLocaleSlug,
  videosIndexPath,
  watchEpisodeAbsolute,
  watchEpisodeExplicitLanguagePath,
  watchEpisodePath,
  watchVideoAbsolute,
  watchVideoExplicitLanguagePath,
  watchVideoPath,
} from "./routes"

const jesus = asContentSlug("jesus")
const lumo = asContentSlug("lumo-the-gospel-of-john")
const wedding = asContentSlug("wedding-in-cana")
const english = asLocaleSlug("english")
const romanian = asLocaleSlug("romanian")
const russian = asLocaleSlug("russian")
const spanishCastilian = asLocaleSlug("spanish-castilian")
const portugueseBrazil = asLocaleSlug("portuguese-brazil")

describe("tryAsContentSlug / tryAsLocaleSlug (Result-shape)", () => {
  it("returns branded slug on valid input", () => {
    expect(tryAsContentSlug("jesus")).toBe("jesus")
    expect(tryAsContentSlug("soccer_event_collection")).toBe(
      "soccer_event_collection",
    )
    expect(tryAsLocaleSlug("portuguese-brazil")).toBe("portuguese-brazil")
  })

  it("keeps public language slugs kebab-case", () => {
    expect(tryAsLocaleSlug("soccer_event_collection")).toBeNull()
  })

  it("returns null on uppercase", () => {
    expect(tryAsContentSlug("Jesus")).toBeNull()
    expect(tryAsLocaleSlug("English")).toBeNull()
  })

  it("returns null on dot", () => {
    expect(tryAsContentSlug("jesus.html")).toBeNull()
  })

  it("returns null on slash", () => {
    expect(tryAsContentSlug("foo/bar")).toBeNull()
  })

  it("returns null on empty", () => {
    expect(tryAsLocaleSlug("")).toBeNull()
  })

  it("does not throw on bad input (unlike asContentSlug)", () => {
    expect(() => tryAsContentSlug("BAD")).not.toThrow()
  })
})

describe("asContentSlug / asLocaleSlug guards", () => {
  it("accepts safe slug shape", () => {
    expect(asContentSlug("jesus")).toBe("jesus")
    expect(asContentSlug("soccer_event_collection")).toBe(
      "soccer_event_collection",
    )
    expect(asLocaleSlug("portuguese-brazil")).toBe("portuguese-brazil")
  })

  it("rejects underscores in locale slugs", () => {
    expect(() => asLocaleSlug("soccer_event_collection")).toThrow()
  })

  it("rejects uppercase", () => {
    expect(() => asContentSlug("Jesus")).toThrow()
    expect(() => asLocaleSlug("English")).toThrow()
  })

  it("rejects dot", () => {
    expect(() => asContentSlug("jesus.html")).toThrow()
  })

  it("rejects slash", () => {
    expect(() => asContentSlug("foo/bar")).toThrow()
  })

  it("rejects empty", () => {
    expect(() => asLocaleSlug("")).toThrow()
  })

  it("rejects percent-encoding", () => {
    expect(() => asContentSlug("foo%2Fbar")).toThrow()
  })
})

describe("localizedHomePath", () => {
  it("returns /lang.html shape", () => {
    expect(localizedHomePath(russian)).toBe("/russian.html")
    expect(localizedHomePath(portugueseBrazil)).toBe("/portuguese-brazil.html")
  })
})

describe("watchVideoPath", () => {
  it("omits English from the eligible canonical shape", () => {
    expect(watchVideoPath(jesus, english)).toBe("/jesus.html")
  })

  it("keeps international routes language-explicit", () => {
    expect(watchVideoPath(jesus, spanishCastilian)).toBe(
      "/jesus.html/spanish-castilian.html",
    )
    expect(watchVideoPath(jesus, romanian)).toBe("/jesus.html/romanian.html")
    expect(watchVideoPath(jesus, russian)).toBe("/jesus.html/russian.html")
  })

  it("keeps English explicit for a public language-home collision", () => {
    expect(watchVideoPath(asContentSlug("russian"), english)).toBe(
      "/russian.html/english.html",
    )
  })

  it("keeps non-language one-segment Experiences eligible", () => {
    expect(watchVideoPath(asContentSlug("easter"), english)).toBe(
      "/easter.html",
    )
  })

  it("appends t and autoplay one-shots", () => {
    expect(watchVideoPath(jesus, english, { t: 120, autoplay: true })).toBe(
      "/jesus.html?t=120&autoplay=1",
    )
  })

  it("emits _lr=1 when reason is set", () => {
    expect(watchVideoPath(jesus, english, { reason: "locale-resolved" })).toBe(
      "/jesus.html?_lr=1",
    )
  })

  it("does not emit _lr=1 when reason is undefined", () => {
    expect(watchVideoPath(jesus, english)).toBe("/jesus.html")
    expect(watchVideoPath(jesus, english, {})).toBe("/jesus.html")
  })

  it("preserves t and autoplay alongside reason", () => {
    expect(
      watchVideoPath(jesus, english, {
        t: 42,
        autoplay: true,
        reason: "locale-resolved",
      }),
    ).toBe("/jesus.html?t=42&autoplay=1&_lr=1")
  })
})

describe("watchVideoExplicitLanguagePath", () => {
  it("always emits the language segment", () => {
    expect(watchVideoExplicitLanguagePath(jesus, english)).toBe(
      "/jesus.html/english.html",
    )
  })

  it("serializes one-shot query options identically", () => {
    expect(
      watchVideoExplicitLanguagePath(jesus, english, {
        t: 42,
        autoplay: true,
        reason: "locale-resolved",
      }),
    ).toBe("/jesus.html/english.html?t=42&autoplay=1&_lr=1")
  })
})

describe("watchEpisodePath", () => {
  it("omits English for an eligible contextual episode", () => {
    expect(watchEpisodePath(lumo, wedding, english)).toBe(
      "/lumo-the-gospel-of-john.html/wedding-in-cana.html",
    )
  })

  it("keeps international contextual routes explicit", () => {
    expect(watchEpisodePath(lumo, wedding, russian, { t: 10 })).toBe(
      "/lumo-the-gospel-of-john.html/wedding-in-cana/russian.html?t=10",
    )
    expect(watchEpisodePath(lumo, wedding, romanian)).toBe(
      "/lumo-the-gospel-of-john.html/wedding-in-cana/romanian.html",
    )
    expect(watchEpisodePath(lumo, wedding, spanishCastilian)).toBe(
      "/lumo-the-gospel-of-john.html/wedding-in-cana/spanish-castilian.html",
    )
  })

  it("keeps English explicit for public-language and legacy-alias episode slugs", () => {
    for (const episode of [
      asContentSlug("russian"),
      asContentSlug("chinese-mandarin"),
    ]) {
      expect(watchEpisodePath(lumo, episode, english)).toBe(
        `/lumo-the-gospel-of-john.html/${episode}/english.html`,
      )
      expect(isLanguageLessWatchEpisodePathEligible(episode)).toBe(false)
    }
  })

  it("serializes one-shot query options on the short form", () => {
    expect(
      watchEpisodePath(lumo, wedding, english, {
        t: 42,
        autoplay: true,
        reason: "locale-resolved",
      }),
    ).toBe(
      "/lumo-the-gospel-of-john.html/wedding-in-cana.html?t=42&autoplay=1&_lr=1",
    )
  })
})

describe("watchEpisodeExplicitLanguagePath", () => {
  it("always emits the explicit contextual language segment", () => {
    expect(watchEpisodeExplicitLanguagePath(lumo, wedding, english)).toBe(
      "/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
    )
  })
})

describe("videosIndexPath", () => {
  it("returns the canonical /languages path for compatibility", () => {
    expect(videosIndexPath()).toBe("/languages")
  })
})

describe("languagesIndexPath", () => {
  it("returns /languages (no .html)", () => {
    expect(languagesIndexPath()).toBe("/languages")
  })
})

describe("localized utility paths", () => {
  it("builds language-bearing all-languages and history paths", () => {
    expect(localizedLanguagesPath(portugueseBrazil)).toBe(
      "/portuguese-brazil.html/languages",
    )
    expect(localizedHistoryPath(russian)).toBe("/russian.html/history")
  })
})

describe("languageVideosIndexPath", () => {
  it("returns /lang.html/videos", () => {
    expect(languageVideosIndexPath(portugueseBrazil)).toBe(
      "/portuguese-brazil.html/videos",
    )
  })
})

describe("searchPath", () => {
  it("returns the root modal fallback path", () => {
    expect(searchPath()).toBe("/")
  })
})

describe("WATCH_CANONICAL_ORIGIN integration with env.ts", () => {
  it("equals env.NEXT_PUBLIC_CANONICAL_ORIGIN (single source of truth)", async () => {
    const { env } = await import("@/env")
    expect(WATCH_CANONICAL_ORIGIN).toBe(env.NEXT_PUBLIC_CANONICAL_ORIGIN)
  })
})

describe("absolute URL builders", () => {
  it("watchVideoAbsolute prepends origin + basePath", () => {
    expect(watchVideoAbsolute(jesus, english)).toBe(
      `${WATCH_CANONICAL_ORIGIN}${WATCH_BASE_PATH}/jesus.html`,
    )
  })

  it("watchEpisodeAbsolute uses the short public English shape", () => {
    expect(watchEpisodeAbsolute(lumo, wedding, english)).toBe(
      `${WATCH_CANONICAL_ORIGIN}${WATCH_BASE_PATH}/lumo-the-gospel-of-john.html/wedding-in-cana.html`,
    )
  })

  it("localizedHomeAbsolute matches localized-home shape with origin", () => {
    expect(localizedHomeAbsolute(russian)).toBe(
      `${WATCH_CANONICAL_ORIGIN}${WATCH_BASE_PATH}/russian.html`,
    )
  })

  it("WATCH_BASE_PATH matches Next.js basePath", () => {
    expect(WATCH_BASE_PATH).toBe("/watch")
  })
})

describe("parseWatchPath", () => {
  it("parses / as home", () => {
    expect(parseWatchPath("/")).toEqual({ kind: "home" })
    expect(parseWatchPath("")).toEqual({ kind: "home" })
  })

  it("parses reserved prefixes (api, _next, assets, etc.)", () => {
    expect(parseWatchPath("/api/preview")).toEqual({
      kind: "reserved",
      prefix: "api",
    })
    expect(parseWatchPath("/_next/data/foo.json")).toEqual({
      kind: "reserved",
      prefix: "_next",
    })
    expect(parseWatchPath("/assets/favicon-180.png")).toEqual({
      kind: "reserved",
      prefix: "assets",
    })
    expect(parseWatchPath("/images/jesusfilm-sign.svg")).toEqual({
      kind: "reserved",
      prefix: "images",
    })
    expect(parseWatchPath("/fonts/Montserrat-VariableFont_wght.woff2")).toEqual(
      {
        kind: "reserved",
        prefix: "fonts",
      },
    )
    expect(parseWatchPath("/favicon.ico")).toEqual({
      kind: "reserved",
      prefix: "favicon.ico",
    })
  })

  it("parses /languages as languages", () => {
    expect(parseWatchPath("/languages")).toEqual({ kind: "languages" })
  })

  it("parses localized utility routes without treating them as videos", () => {
    expect(parseWatchPath("/french.html/languages")).toEqual({
      kind: "localized-languages",
      lang: "french",
    })
    expect(parseWatchPath("/spanish-latin-american.html/history")).toEqual({
      kind: "localized-history",
      lang: "spanish-latin-american",
    })
  })

  it("parses legacy /videos as languages", () => {
    expect(parseWatchPath("/videos")).toEqual({ kind: "languages" })
  })

  it("parses /spanish-latin-american.html/videos as language videos", () => {
    expect(parseWatchPath("/spanish-latin-american.html/videos")).toEqual({
      kind: "language-videos",
      lang: "spanish-latin-american",
    })
  })

  it("parses deprecated /search without query state", () => {
    expect(parseWatchPath("/search")).toEqual({
      kind: "search",
    })
  })

  it("parses /russian.html as localized-home", () => {
    expect(parseWatchPath("/russian.html")).toEqual({
      kind: "localized-home",
      lang: "russian",
    })
  })

  it("parses bare /jesus as localized-home (transitional shape, stripped)", () => {
    expect(parseWatchPath("/jesus")).toEqual({
      kind: "localized-home",
      lang: "jesus",
    })
  })

  it("parses /jesus.html/english.html as video", () => {
    expect(parseWatchPath("/jesus.html/english.html")).toEqual({
      kind: "video",
      slug: "jesus",
      lang: "english",
    })
  })

  it("parses a non-language two-segment path as an English episode", () => {
    expect(
      parseWatchPath("/lumo-the-gospel-of-john.html/wedding-in-cana.html"),
    ).toEqual({
      kind: "episode",
      series: "lumo-the-gospel-of-john",
      episode: "wedding-in-cana",
      lang: "english",
    })
  })

  it("preserves current and legacy language precedence in two segments", () => {
    expect(parseWatchPath("/jesus.html/russian.html")).toEqual({
      kind: "video",
      slug: "jesus",
      lang: "russian",
    })
    expect(parseWatchPath("/jesus.html/chinese-mandarin.html")).toEqual({
      kind: "video",
      slug: "jesus",
      lang: "chinese-mandarin",
    })
  })

  it("parses three-segment as episode (with .html on first + third only)", () => {
    expect(
      parseWatchPath(
        "/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
      ),
    ).toEqual({
      kind: "episode",
      series: "lumo-the-gospel-of-john",
      episode: "wedding-in-cana",
      lang: "english",
    })
  })

  it("parses four-or-more segments as unknown", () => {
    expect(parseWatchPath("/a/b/c/d")).toEqual({
      kind: "unknown",
      raw: "/a/b/c/d",
    })
  })

  it("keeps language-less canonical parsing syntax-only until admission", () => {
    const emitted = watchVideoPath(jesus, english)
    const parsed = parseWatchPath(emitted)
    expect(parsed).toEqual({ kind: "localized-home", lang: "jesus" })
  })

  it("inverts the explicit-language video path", () => {
    const emitted = watchVideoExplicitLanguagePath(jesus, english)
    expect(parseWatchPath(emitted)).toEqual({
      kind: "video",
      slug: "jesus",
      lang: "english",
    })
  })

  it("inverts watchEpisodePath", () => {
    const emitted = watchEpisodePath(lumo, wedding, english)
    const parsed = parseWatchPath(emitted)
    expect(parsed).toEqual({
      kind: "episode",
      series: "lumo-the-gospel-of-john",
      episode: "wedding-in-cana",
      lang: "english",
    })
  })

  it("inverts the explicit-language episode path", () => {
    const emitted = watchEpisodeExplicitLanguagePath(lumo, wedding, english)
    expect(parseWatchPath(emitted)).toEqual({
      kind: "episode",
      series: "lumo-the-gospel-of-john",
      episode: "wedding-in-cana",
      lang: "english",
    })
  })

  it("inverts languageVideosIndexPath", () => {
    const emitted = languageVideosIndexPath(portugueseBrazil)
    const parsed = parseWatchPath(emitted)
    expect(parsed).toEqual({
      kind: "language-videos",
      lang: "portuguese-brazil",
    })
  })
})
