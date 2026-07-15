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
  tryAsContentSlug,
  tryAsLocaleSlug,
  videosIndexPath,
  watchEpisodeAbsolute,
  watchEpisodePath,
  watchVideoAbsolute,
  watchVideoPath,
} from "./routes"

const jesus = asContentSlug("jesus")
const lumo = asContentSlug("lumo-the-gospel-of-john")
const wedding = asContentSlug("wedding-in-cana")
const english = asLocaleSlug("english")
const russian = asLocaleSlug("russian")
const portugueseBrazil = asLocaleSlug("portuguese-brazil")

describe("tryAsContentSlug / tryAsLocaleSlug (Result-shape)", () => {
  it("returns branded slug on valid input", () => {
    expect(tryAsContentSlug("jesus")).toBe("jesus")
    expect(tryAsLocaleSlug("portuguese-brazil")).toBe("portuguese-brazil")
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
    expect(asLocaleSlug("portuguese-brazil")).toBe("portuguese-brazil")
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
  it("returns canonical two-segment shape", () => {
    expect(watchVideoPath(jesus, english)).toBe("/jesus.html/english.html")
  })

  it("appends t and autoplay one-shots", () => {
    expect(watchVideoPath(jesus, english, { t: 120, autoplay: true })).toBe(
      "/jesus.html/english.html?t=120&autoplay=1",
    )
  })

  it("emits _lr=1 when reason is set", () => {
    expect(watchVideoPath(jesus, english, { reason: "locale-resolved" })).toBe(
      "/jesus.html/english.html?_lr=1",
    )
  })

  it("does not emit _lr=1 when reason is undefined", () => {
    expect(watchVideoPath(jesus, english)).toBe("/jesus.html/english.html")
    expect(watchVideoPath(jesus, english, {})).toBe("/jesus.html/english.html")
  })

  it("preserves t and autoplay alongside reason", () => {
    expect(
      watchVideoPath(jesus, english, {
        t: 42,
        autoplay: true,
        reason: "locale-resolved",
      }),
    ).toBe("/jesus.html/english.html?t=42&autoplay=1&_lr=1")
  })
})

describe("watchEpisodePath", () => {
  it("returns series.html/episode/lang.html shape (episode is bare)", () => {
    expect(watchEpisodePath(lumo, wedding, english)).toBe(
      "/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
    )
  })

  it("preserves bare episode segment even when locale options present", () => {
    expect(watchEpisodePath(lumo, wedding, russian, { t: 10 })).toBe(
      "/lumo-the-gospel-of-john.html/wedding-in-cana/russian.html?t=10",
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
      `${WATCH_CANONICAL_ORIGIN}${WATCH_BASE_PATH}/jesus.html/english.html`,
    )
  })

  it("watchEpisodeAbsolute matches three-segment shape with origin", () => {
    expect(watchEpisodeAbsolute(lumo, wedding, english)).toBe(
      `${WATCH_CANONICAL_ORIGIN}${WATCH_BASE_PATH}/lumo-the-gospel-of-john.html/wedding-in-cana/english.html`,
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

  it("inverts watchVideoPath: parse(emit) === { slug, lang }", () => {
    const emitted = watchVideoPath(jesus, english)
    const parsed = parseWatchPath(emitted)
    expect(parsed).toEqual({ kind: "video", slug: "jesus", lang: "english" })
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

  it("inverts languageVideosIndexPath", () => {
    const emitted = languageVideosIndexPath(portugueseBrazil)
    const parsed = parseWatchPath(emitted)
    expect(parsed).toEqual({
      kind: "language-videos",
      lang: "portuguese-brazil",
    })
  })
})
