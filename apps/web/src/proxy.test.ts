import { describe, expect, it } from "vitest"

import { config, proxy, type ProxyRequest } from "./proxy"

function makeRequest(
  pathname: string,
  options: { acceptLanguage?: string } = {},
): ProxyRequest {
  // Test stand-in for the `ProxyRequest` structural subset proxy() reads.
  // No cast needed — the factory's return type matches the production
  // contract directly. NOTE: proxy() no longer reads cookies — the URL is
  // the sole locale carrier, so there is no cookie field to mock.
  const url = new URL(`https://www.jesusfilm.org${pathname}`)
  return {
    nextUrl: Object.assign(url, {
      clone: () => new URL(url.toString()),
    }),
    headers: new Headers(
      options.acceptLanguage
        ? { "accept-language": options.acceptLanguage }
        : {},
    ),
  }
}

function rewritePath(response: Response): string | null {
  const target = response.headers.get("x-middleware-rewrite")
  return target ? new URL(target).pathname : null
}

// ---------------------------------------------------------------------------
// Phase 3 canonicalize integration — every row from research §5.4 must
// produce the exact (status, Location) tuple, AND every redirect must
// emit Cache-Control: private, max-age=0 for the cutover window.
// ---------------------------------------------------------------------------

describe("proxy — canonicalize integration (§5.4)", () => {
  it("strips trailing slash on /watch root variant → 308", () => {
    const response = proxy(makeRequest("/foo/"))
    // /foo/ → Rule 1 (trailing slash) THEN Rule 4 (.html append)
    // Net redirect; one hop; 307 (not just trailing-slash) because Rule 4 fired.
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain("/foo.html/foo.html")
  })

  it("strips trailing slash on .html-shape /jesus.html/ → 308 → /jesus.html", () => {
    const response = proxy(makeRequest("/jesus.html/"))
    expect(response.status).toBe(308)
    expect(response.headers.get("location")).toMatch(/\/jesus\.html($|\?)/)
  })

  it("strips trailing slash on full .html shape → 308", () => {
    const response = proxy(makeRequest("/jesus.html/english.html/"))
    expect(response.status).toBe(308)
    expect(response.headers.get("location")).toContain(
      "/jesus.html/english.html",
    )
  })

  it("lowercases uppercase .HTML → 307", () => {
    const response = proxy(makeRequest("/jesus.HTML/english.html"))
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain(
      "/jesus.html/english.html",
    )
  })

  it("appends missing .html on bare locale segment → 307", () => {
    const response = proxy(makeRequest("/jesus.html/english"))
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain(
      "/jesus.html/english.html",
    )
  })

  it("duplicate-expands single-segment bare slug → 307", () => {
    const response = proxy(makeRequest("/jesus"))
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain("/jesus.html/jesus.html")
  })

  it("appends .html per-segment on two-segment bare → 307", () => {
    const response = proxy(makeRequest("/jesus/english"))
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain(
      "/jesus.html/english.html",
    )
  })

  it("resolves chinese-mandarin alias → mandarin-china → 307", () => {
    const response = proxy(makeRequest("/jesus.html/chinese-mandarin.html"))
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain(
      "/jesus.html/mandarin-china.html",
    )
  })

  it("404s bcp47 catalog keys in public audio slots", () => {
    const response = proxy(makeRequest("/jesus.html/en.html"))
    expect(response.status).toBe(404)
  })

  it("404s bcp47 regional tags in public audio slots", () => {
    const response = proxy(makeRequest("/jesus.html/pt-br.html"))
    expect(response.status).toBe(404)
  })

  it("rewrites legacy 4-segment episode shape into canonical 3-segment → 307", () => {
    const response = proxy(
      makeRequest("/lumo-the-gospel-of-john/wedding-in-cana.html/english.html"),
    )
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain(
      "/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
    )
  })

  it("emits Cache-Control: private, max-age=0 on every canonicalize redirect", () => {
    const response = proxy(makeRequest("/jesus/english"))
    expect(response.status).toBe(307)
    expect(response.headers.get("cache-control")).toBe("private, max-age=0")
  })

  it("reaches a terminal canonical in one hop (idempotence)", () => {
    // /jesus → /jesus.html/jesus.html (first hop). Re-feeding the output
    // through proxy should NOT produce another redirect; the app boundary can
    // reject the duplicated non-language audio slot as a terminal 404.
    const second = proxy(makeRequest("/jesus.html/jesus.html"))
    expect(second.status).toBe(404)
    expect(rewritePath(second)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Reserved-subtree pass-through. The matcher OR canonicalize's RESERVED_PREFIXES
// guard MUST keep these from being amplified by Rule 5.
// ---------------------------------------------------------------------------

describe("proxy — reserved-subtree pass-through", () => {
  it("does not rewrite /assets/* (would amplify into /assets.html/...)", () => {
    const response = proxy(makeRequest("/assets/footer/facebook.svg"))
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
  })

  it("does not rewrite /images logo or favicon assets", () => {
    for (const path of [
      "/images/jesusfilm-sign.svg",
      "/images/favicon-32.png",
    ]) {
      const response = proxy(makeRequest(path))
      expect(response.status).not.toBe(307)
      expect(response.status).not.toBe(308)
    }
  })

  it("does not rewrite /fonts/* public assets", () => {
    const response = proxy(
      makeRequest("/fonts/Montserrat-VariableFont_wght.woff2"),
    )
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
  })

  it("does not rewrite /api/preview", () => {
    const response = proxy(makeRequest("/api/preview"))
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
    expect(rewritePath(response)).toBeNull()
  })

  it("does not rewrite demo route-group surfaces", () => {
    for (const path of ["/demo-search", "/demo-recommendations/jesus/en"]) {
      const response = proxy(makeRequest(path))
      expect(response.status).not.toBe(307)
      expect(response.status).not.toBe(308)
      expect(rewritePath(response)).toBeNull()
    }
  })

  it("does not rewrite /_next/data/...", () => {
    const response = proxy(makeRequest("/_next/data/build/x.json"))
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
  })

  it("does not rewrite /.well-known/security.txt", () => {
    const response = proxy(makeRequest("/.well-known/security.txt"))
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
  })
})

describe("proxy config matcher — reserved first-segment exclusions", () => {
  const [matcher] = config.matcher
  const matcherRegex = new RegExp(`^${matcher}$`)

  it("excludes reserved public asset and framework subtrees before proxy runs", () => {
    expect(matcherRegex.test("/assets/overlay.svg")).toBe(false)
    expect(matcherRegex.test("/images/jesusfilm-sign.svg")).toBe(false)
    expect(matcherRegex.test("/fonts/Montserrat-VariableFont_wght.woff2")).toBe(
      false,
    )
    expect(matcherRegex.test("/api/preview")).toBe(false)
    expect(matcherRegex.test("/demo-search")).toBe(false)
    expect(matcherRegex.test("/demo-recommendations/jesus/en")).toBe(false)
    expect(matcherRegex.test("/_next/data/build/x.json")).toBe(false)
    expect(matcherRegex.test("/.well-known/security.txt")).toBe(false)
  })

  it("does not exclude content routes that only start with a reserved word", () => {
    expect(matcherRegex.test("/images-of-jesus.html/english.html")).toBe(true)
    expect(matcherRegex.test("/fonts-of-worship.html/english.html")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// No cookie override: the URL is the sole locale carrier. An explicit locale
// already named in a canonical watch URL must NEVER be redirected to some
// other language — this is the regression guard for the production bug where
// a stale `forge_watch_lang` cookie hijacked `/jesus.html/english.html` to
// `/jesus.html/bangla-2.html`. proxy() no longer reads cookies at all.
// ---------------------------------------------------------------------------

describe("proxy — explicit locale URLs are never language-redirected", () => {
  it("does not redirect a canonical 2-segment watch URL", () => {
    const response = proxy(makeRequest("/jesus.html/english.html"))
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
    expect(rewritePath(response)).toBe("/en/en/jesus.html/english.html")
  })

  it("does not redirect a canonical 3-segment episode URL", () => {
    const response = proxy(
      makeRequest("/lumo-the-gospel-of-john.html/wedding-in-cana/english.html"),
    )
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
    expect(rewritePath(response)).toBe(
      "/en/en/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
    )
  })

  it("applies watch security headers (CSP) to the canonical 2-segment URL", () => {
    const response = proxy(makeRequest("/jesus.html/english.html"))
    expect(response.headers.get("content-security-policy")).toBe(
      "frame-ancestors 'self'",
    )
  })

  it("does not emit a Vary: Cookie header (no cookie-dependent redirects)", () => {
    const response = proxy(makeRequest("/jesus.html/english.html"))
    expect(response.headers.get("vary") ?? "").not.toContain("Cookie")
  })
})

describe("proxy — internal locale/htmlLang rewrites", () => {
  it("keeps root and videos public while internally defaulting to /en/en", () => {
    for (const [publicPath, internalPath] of [
      ["/", "/en/en"],
      ["/videos", "/en/en/videos"],
    ] as const) {
      const response = proxy(
        makeRequest(publicPath, { acceptLanguage: "es-ES,es;q=0.9" }),
      )
      expect(response.status).not.toBe(307)
      expect(response.status).not.toBe(308)
      expect(rewritePath(response)).toBe(internalPath)
    }
  })

  it("redirects deprecated /search into the root search modal without synthetic .html", () => {
    const response = proxy(makeRequest("/search?q=forgiveness"))
    expect(response.status).toBe(307)
    const location = new URL(response.headers.get("location") ?? "")
    expect(location.pathname).toBe("/")
    expect(location.search).toBe("?q=forgiveness")
    expect(rewritePath(response)).toBeNull()
  })

  it("404s the stale synthetic search shape", () => {
    const response = proxy(makeRequest("/search.html/search.html"))
    expect(response.status).toBe(404)
    expect(rewritePath(response)).toBeNull()
  })

  it("preserves one-segment collection pages as default-locale collections", () => {
    const response = proxy(makeRequest("/easter.html"))
    expect(rewritePath(response)).toBe("/en/en/easter.html")
  })

  it("404s one-segment slugs outside the production collection allowlist", () => {
    const response = proxy(makeRequest("/jesus.html"))
    expect(response.status).toBe(404)
    expect(rewritePath(response)).toBeNull()
  })

  it("rewrites one-segment public language homes with locale/htmlLang matching the slug", () => {
    const response = proxy(makeRequest("/spanish-castilian.html"))
    expect(rewritePath(response)).toBe("/es/es-ES/spanish-castilian.html")
  })

  it("404s bcp47 catalog keys as one-segment public homes", () => {
    const response = proxy(makeRequest("/en.html"))
    expect(response.status).toBe(404)
  })

  it("keeps the raw audio slug in rest while using message locale + regional htmlLang", () => {
    const response = proxy(
      makeRequest("/jesus.html/spanish-latin-american.html"),
    )
    expect(rewritePath(response)).toBe(
      "/es/es-419/jesus.html/spanish-latin-american.html",
    )
  })

  it("falls back chrome identity for unsupported audio-language families", () => {
    const response = proxy(makeRequest("/jesus.html/mandarin-china.html"))
    expect(rewritePath(response)).toBe("/en/en/jesus.html/mandarin-china.html")
  })

  it("404s unknown public audio slugs before they reach the app route", () => {
    const response = proxy(makeRequest("/easter.html/non-existent.html"))
    expect(response.status).toBe(404)
    expect(rewritePath(response)).toBeNull()
  })
})

describe("proxy — visible internal-prefix policy", () => {
  it("308 redirects visible internal root and route prefixes to canonical public URLs", () => {
    for (const [visible, canonical] of [
      ["/en", "/"],
      ["/en/en", "/"],
      ["/en/en/videos", "/videos"],
      [
        "/es/es-419/jesus.html/spanish-latin-american.html",
        "/jesus.html/spanish-latin-american.html",
      ],
    ] as const) {
      const response = proxy(makeRequest(visible))
      expect(response.status).toBe(308)
      expect(response.headers.get("location")).toContain(canonical)
    }
  })

  it("does not misclassify slug-form public URLs as internal prefixes", () => {
    const response = proxy(makeRequest("/en/english"))
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain("/en.html/english.html")
  })

  it("404s invalid visible internal prefix pairs instead of serving duplicates", () => {
    const response = proxy(makeRequest("/en/es-419/jesus.html/english.html"))
    expect(response.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Resilience: malformed inputs do not crash. Canonical shape is preserved.
// ---------------------------------------------------------------------------

describe("proxy — resilience on malformed inputs", () => {
  it("handles double-.html on a segment without crashing", () => {
    // Not a recognised rule input. Just must not throw.
    expect(() =>
      proxy(makeRequest("/jesus.html.html/english.html")),
    ).not.toThrow()
  })

  it("handles empty segment (/.html) without crashing", () => {
    expect(() => proxy(makeRequest("/.html"))).not.toThrow()
  })

  it("does not rewrite percent-encoded paths (positive allowlist rejects)", () => {
    const response = proxy(makeRequest("/jesus%20test/english"))
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
    expect(response.status).toBe(404)
  })

  it("does not rewrite cyrillic slugs (positive allowlist rejects non-ASCII)", () => {
    const response = proxy(
      makeRequest(`/${encodeURIComponent("Иисус")}/english`),
    )
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
    expect(response.status).toBe(404)
  })

  it("404s four-segment paths in proxy before they can mint route cache entries", () => {
    const response = proxy(makeRequest("/a.html/b/c.html/d.html"))
    expect(response.status).toBe(404)
  })
})
