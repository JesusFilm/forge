import { describe, expect, it } from "vitest"

import { WATCH_HOME_CATEGORY_CATALOG } from "./watch-home-categories"
import {
  DEFAULT_WATCH_HOME_TILE_ICON,
  DEFAULT_WATCH_HOME_TILE_STYLE,
  WATCH_HOME_CATEGORY_BY_ID,
  WATCH_HOME_CATEGORY_TILE_DEFAULTS,
  WATCH_HOME_TILE_ICONS,
  WATCH_HOME_TILE_ICON_KEYS,
  WATCH_HOME_TILE_STYLES,
  WATCH_HOME_TILE_STYLE_KEYS,
  classifyWatchHomeTileHref,
  isSafeWatchHomeTileHref,
  watchHomeTileGradient,
} from "./watch-home-tiles"

describe("icon and style vocabularies", () => {
  it("has unique keys, since a key is the persisted authoring contract", () => {
    expect(new Set(WATCH_HOME_TILE_ICON_KEYS).size).toBe(
      WATCH_HOME_TILE_ICON_KEYS.length,
    )
    expect(new Set(WATCH_HOME_TILE_STYLE_KEYS).size).toBe(
      WATCH_HOME_TILE_STYLE_KEYS.length,
    )
  })

  it("exposes keys matching the catalog entries", () => {
    expect(WATCH_HOME_TILE_ICON_KEYS).toEqual(
      WATCH_HOME_TILE_ICONS.map(({ key }) => key),
    )
    expect(WATCH_HOME_TILE_STYLE_KEYS).toEqual(
      WATCH_HOME_TILE_STYLES.map(({ key }) => key),
    )
  })

  it("names defaults that actually exist in their vocabulary", () => {
    expect(WATCH_HOME_TILE_ICON_KEYS).toContain(DEFAULT_WATCH_HOME_TILE_ICON)
    expect(WATCH_HOME_TILE_STYLE_KEYS).toContain(DEFAULT_WATCH_HOME_TILE_STYLE)
  })
})

describe("WATCH_HOME_CATEGORY_TILE_DEFAULTS", () => {
  it("covers every catalog category", () => {
    expect(Object.keys(WATCH_HOME_CATEGORY_TILE_DEFAULTS).sort()).toEqual(
      WATCH_HOME_CATEGORY_CATALOG.map(({ id }) => id).sort(),
    )
  })

  it("only names icons and styles the vocabularies define", () => {
    for (const [id, defaults] of Object.entries(
      WATCH_HOME_CATEGORY_TILE_DEFAULTS,
    )) {
      expect(WATCH_HOME_TILE_ICON_KEYS, id).toContain(defaults.icon)
      expect(WATCH_HOME_TILE_STYLE_KEYS, id).toContain(defaults.style)
    }
  })

  /**
   * The gradients moved here from apps/web so the admin editor could preview
   * them. These are the exact strings the rail rendered before that move —
   * a viewer-visible colour change would be a regression, not a refactor.
   */
  it("keeps every predefined tile's gradient byte-identical to what shipped", () => {
    const gradientByCategoryId = Object.fromEntries(
      Object.entries(WATCH_HOME_CATEGORY_TILE_DEFAULTS).map(([id, tile]) => [
        id,
        watchHomeTileGradient(tile.style),
      ]),
    )

    expect(gradientByCategoryId).toEqual({
      jesus: "linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%)",
      gospels: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      "short-videos": "linear-gradient(135deg, #f97316 0%, #c2410c 100%)",
      family: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
      relationships: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
      women: "linear-gradient(135deg, #a855f7 0%, #6d28d9 100%)",
      students: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
      sports: "linear-gradient(135deg, #0ea5e9 0%, #1d4ed8 100%)",
      "good-news": "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
      hope: "linear-gradient(135deg, #14b8a6 0%, #0f766e 100%)",
      training: "linear-gradient(135deg, #64748b 0%, #334155 100%)",
      easter: "linear-gradient(135deg, #f59e0b 0%, #b45309 100%)",
      christmas: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
    })
  })
})

describe("watchHomeTileGradient", () => {
  it("resolves a known key", () => {
    expect(watchHomeTileGradient("forest")).toBe(
      "linear-gradient(135deg, #16a34a 0%, #14532d 100%)",
    )
  })

  it("falls back to the default preset rather than returning nothing", () => {
    const fallback = watchHomeTileGradient(DEFAULT_WATCH_HOME_TILE_STYLE)
    expect(watchHomeTileGradient(null)).toBe(fallback)
    expect(watchHomeTileGradient(undefined)).toBe(fallback)
    expect(watchHomeTileGradient("chartreuse")).toBe(fallback)
  })
})

describe("isSafeWatchHomeTileHref", () => {
  it.each([
    "/",
    "/watch/jesus.html",
    "/watch/jesus.html/spanish.html?t=12#chapter-2",
    "https://example.org",
    "https://example.org/give?utm=x",
  ])("accepts %j", (href) => {
    expect(isSafeWatchHomeTileHref(href)).toBe(true)
  })

  it.each([
    // Script-execution sinks.
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)  ",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    // Cross-origin destination disguised as a path.
    "//evil.example/watch",
    "///evil.example",
    // Protocol downgrade and non-web schemes.
    "http://example.org",
    "file:///etc/passwd",
    "ftp://example.org",
    "mailto:a@example.org",
    // Not a URL and not a path.
    "watch/jesus.html",
    "example.org",
    "",
    "   ",
  ])("rejects %j", (href) => {
    expect(isSafeWatchHomeTileHref(href)).toBe(false)
  })

  it("rejects a control character smuggling a scheme past a prefix check", () => {
    expect(isSafeWatchHomeTileHref("java\0script:alert(1)")).toBe(false)
    expect(isSafeWatchHomeTileHref("java\nscript:alert(1)")).toBe(false)
    expect(isSafeWatchHomeTileHref("java\tscript:alert(1)")).toBe(false)
    expect(isSafeWatchHomeTileHref("/watch\0/jesus.html")).toBe(false)
  })

  it("rejects non-strings and an over-long destination", () => {
    expect(isSafeWatchHomeTileHref(null)).toBe(false)
    expect(isSafeWatchHomeTileHref(undefined)).toBe(false)
    expect(isSafeWatchHomeTileHref(42)).toBe(false)
    expect(isSafeWatchHomeTileHref({ href: "/watch" })).toBe(false)
    expect(isSafeWatchHomeTileHref(`/${"a".repeat(2048)}`)).toBe(false)
  })
})

describe("classifyWatchHomeTileHref", () => {
  it("separates same-origin paths from absolute destinations", () => {
    expect(classifyWatchHomeTileHref("/jesus.html")).toEqual({
      kind: "watch",
      href: "/jesus.html",
    })
    expect(classifyWatchHomeTileHref("https://example.org")).toEqual({
      kind: "external",
      href: "https://example.org",
    })
  })

  // The address-bar shape. Without the strip, `next/link` prepends the base
  // path a second time and the tile renders `/watch/watch/jesus.html`, which
  // is a 404 nobody sees until they click.
  it("strips a stored base-path prefix so Link cannot double it", () => {
    expect(classifyWatchHomeTileHref("/watch/jesus.html")).toEqual({
      kind: "watch",
      href: "/jesus.html",
    })
    expect(classifyWatchHomeTileHref("/watch")).toEqual({
      kind: "watch",
      href: "/",
    })
  })

  it("only strips a whole leading segment", () => {
    expect(classifyWatchHomeTileHref("/watchlist")).toEqual({
      kind: "watch",
      href: "/watchlist",
    })
    expect(classifyWatchHomeTileHref("/watch-party")).toEqual({
      kind: "watch",
      href: "/watch-party",
    })
  })

  it("honors a caller-supplied base path", () => {
    expect(classifyWatchHomeTileHref("/w/jesus.html", "/w")).toEqual({
      kind: "watch",
      href: "/jesus.html",
    })
    // The default base path is not special-cased when another one is given.
    expect(classifyWatchHomeTileHref("/watch/jesus.html", "/w")).toEqual({
      kind: "watch",
      href: "/watch/jesus.html",
    })
  })

  // A Watch destination is prefetchable, so the browser may request it before
  // anyone clicks. A side-effecting GET must never be reachable that way.
  it.each(["/api/auth/logout", "/watch/api/auth/logout", "/api", "/watch/api"])(
    "rejects the API path %j",
    (href) => {
      expect(classifyWatchHomeTileHref(href)).toBeNull()
    },
  )

  it("does not reject a content path that merely starts with the letters api", () => {
    expect(classifyWatchHomeTileHref("/apiary.html")).toEqual({
      kind: "watch",
      href: "/apiary.html",
    })
  })

  it.each(["/watch/../api/auth/logout", "/../secrets", "/watch/a/../../b"])(
    "rejects traversal in %j",
    (href) => {
      expect(classifyWatchHomeTileHref(href)).toBeNull()
    },
  )

  // The URL parser treats a backslash as a separator. Only a backslash in
  // first position actually resolves cross-origin (`/\evil.example` ->
  // https://evil.example/); a later one stays same-origin but still lets one
  // path be spelled two ways. Both are rejected.
  it("rejects a backslash that would resolve cross-origin", () => {
    expect(classifyWatchHomeTileHref("/watch\\evil.example")).toBeNull()
    expect(classifyWatchHomeTileHref("/\\evil.example")).toBeNull()
  })

  // A literal `..` test and a literal `/api` prefix test both run on the raw
  // string, so every one of these reached `/watch/api/auth/logout` once the
  // browser normalized it — a session-clearing GET, and clickless because the
  // rail prefetches. The guard has to validate the RESOLVED path.
  it.each([
    "/./api/auth/logout",
    "/%2e/api/auth/logout",
    "/%2E/api/auth/logout",
    "/%2e%2e/watch/api/auth/logout",
    "/watch/./api/auth/logout",
    "/foo/%2e%2e/api/auth/logout",
    "/api?x=1",
  ])("rejects the dot-segment API bypass %j", (href) => {
    expect(classifyWatchHomeTileHref(href)).toBeNull()
  })

  // Stripping the base path off `/watch//api/x` would manufacture `//api/x`,
  // the protocol-relative shape the raw-input check rejects.
  it("never lets the base-path strip manufacture a protocol-relative href", () => {
    expect(classifyWatchHomeTileHref("/watch//api/auth/logout")).toBeNull()
    expect(classifyWatchHomeTileHref("/watch//evil.example")).toBeNull()
  })

  it("keeps query and hash while stripping the base path", () => {
    expect(
      classifyWatchHomeTileHref(
        "/watch/jesus.html/spanish.html?t=12#chapter-2",
      ),
    ).toEqual({
      kind: "watch",
      href: "/jesus.html/spanish.html?t=12#chapter-2",
    })
    expect(classifyWatchHomeTileHref("/watch?t=1")).toEqual({
      kind: "watch",
      href: "/?t=1",
    })
    expect(classifyWatchHomeTileHref("/watch#chapter")).toEqual({
      kind: "watch",
      href: "/#chapter",
    })
  })

  /**
   * The invariant the individual cases are all instances of. Asserting on the
   * classifier's own return value cannot catch this class — the string looks
   * fine and only the browser's resolution reveals where it actually goes.
   * So resolve every accepted destination the way the browser will and assert
   * on THAT.
   */
  it("guarantees every accepted watch destination resolves inside the Watch tree", () => {
    const candidates = [
      "/jesus.html",
      "/watch/jesus.html",
      "/watch",
      "/watchlist",
      "/apiary.html",
      "/./api/auth/logout",
      "/%2e%2e/watch/api/auth/logout",
      "/watch//api/auth/logout",
      "/watch/../api/auth/logout",
      "/api/auth/logout",
      "/watch/./api/auth/logout",
    ]

    for (const candidate of candidates) {
      const result = classifyWatchHomeTileHref(candidate)
      if (result?.kind !== "watch") continue
      const { pathname } = new URL(
        `/watch${result.href}`,
        "https://www.jesusfilm.org",
      )
      expect(pathname, candidate).toMatch(/^\/watch(\/|$)/)
      expect(pathname, candidate).not.toMatch(/^\/watch\/api(\/|$)/)
    }
  })
})

describe("WATCH_HOME_CATEGORY_BY_ID", () => {
  it("indexes the whole catalog", () => {
    expect(WATCH_HOME_CATEGORY_BY_ID.size).toBe(
      WATCH_HOME_CATEGORY_CATALOG.length,
    )
    expect(WATCH_HOME_CATEGORY_BY_ID.get("jesus")?.slug).toBe("jesus")
    expect(WATCH_HOME_CATEGORY_BY_ID.has("not-a-category")).toBe(false)
  })
})
