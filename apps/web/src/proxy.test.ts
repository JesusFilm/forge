import { describe, expect, it } from "vitest"

import { proxy, type ProxyRequest } from "./proxy"
import { canonicalizeWatchPath } from "./lib/url-canonicalize"

type CookieMap = Record<string, string>

function makeRequest(
  pathname: string,
  options: { cookies?: CookieMap; acceptLanguage?: string } = {},
): ProxyRequest {
  // Test stand-in for the `ProxyRequest` structural subset proxy() reads.
  // No cast needed — the factory's return type matches the production
  // contract directly.
  const url = new URL(`https://www.jesusfilm.org${pathname}`)
  return {
    nextUrl: Object.assign(url, {
      clone: () => new URL(url.toString()),
    }),
    cookies: {
      get: (name: string) =>
        options.cookies?.[name] != null
          ? { value: options.cookies[name] }
          : undefined,
    },
    headers: new Headers(
      options.acceptLanguage
        ? { "accept-language": options.acceptLanguage }
        : {},
    ),
  }
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
    // through proxy should NOT produce another redirect.
    const second = proxy(makeRequest("/jesus.html/jesus.html"))
    expect(second.status).not.toBe(307)
    expect(second.status).not.toBe(308)
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

  it("does not rewrite /api/preview", () => {
    const response = proxy(makeRequest("/api/preview"))
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
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

// ---------------------------------------------------------------------------
// Cookie-driven language preference on .html shape (2-segment + 3-segment).
// ---------------------------------------------------------------------------

describe("proxy — cookie language preference on canonical .html shape", () => {
  it("redirects 2-segment /jesus.html/english.html to /jesus.html/<pref>.html when cookie disagrees", () => {
    const response = proxy(
      makeRequest("/jesus.html/english.html", {
        cookies: { forge_watch_lang: "spanish" },
      }),
    )
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain(
      "/jesus.html/spanish.html",
    )
  })

  it("does not redirect when 2-seg cookie matches URL locale (.html-aware compare)", () => {
    const response = proxy(
      makeRequest("/jesus.html/spanish.html", {
        cookies: { forge_watch_lang: "spanish" },
      }),
    )
    expect(response.status).not.toBe(307)
  })

  it("redirects 3-segment /series.html/episode/english.html to /series.html/episode/<pref>.html", () => {
    const response = proxy(
      makeRequest(
        "/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
        {
          cookies: { forge_watch_lang: "spanish" },
        },
      ),
    )
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain(
      "/lumo-the-gospel-of-john.html/wedding-in-cana/spanish.html",
    )
  })

  it("emits Cache-Control: private, max-age=0 on cookie redirect", () => {
    const response = proxy(
      makeRequest("/jesus.html/english.html", {
        cookies: { forge_watch_lang: "spanish" },
      }),
    )
    expect(response.headers.get("cache-control")).toBe("private, max-age=0")
  })

  it("bypasses cookie redirect when ?_lr=1 is present", () => {
    const response = proxy(
      makeRequest("/jesus.html/english.html?_lr=1", {
        cookies: { forge_watch_lang: "spanish" },
      }),
    )
    expect(response.status).not.toBe(307)
  })

  it("strips ?autoplay=1 on cross-variant redirect", () => {
    const response = proxy(
      makeRequest("/jesus.html/english.html?autoplay=1", {
        cookies: { forge_watch_lang: "spanish" },
      }),
    )
    expect(response.status).toBe(307)
    const location = response.headers.get("location") ?? ""
    expect(location).toContain("/jesus.html/spanish.html")
    expect(location).not.toContain("autoplay=1")
  })

  it("strips ?t=120 on cross-variant redirect", () => {
    const response = proxy(
      makeRequest("/jesus.html/english.html?t=120", {
        cookies: { forge_watch_lang: "spanish" },
      }),
    )
    expect(response.status).toBe(307)
    expect(response.headers.get("location") ?? "").not.toMatch(/[?&]t=120/)
  })

  it("preserves unrelated query params on cookie redirect", () => {
    const response = proxy(
      makeRequest("/jesus.html/english.html?source=share", {
        cookies: { forge_watch_lang: "spanish" },
      }),
    )
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain("source=share")
  })

  it("ignores malformed cookie value (truncated percent-escape)", () => {
    const response = proxy(
      makeRequest("/jesus.html/english.html", {
        cookies: { forge_watch_lang: "%E0%A4%A" },
      }),
    )
    expect(response.status).not.toBe(307)
  })

  it("ignores cookie value longer than 64-char cap", () => {
    const response = proxy(
      makeRequest("/jesus.html/english.html", {
        cookies: { forge_watch_lang: "a".repeat(100) },
      }),
    )
    expect(response.status).not.toBe(307)
  })

  it("URL-decodes cookie value before comparing", () => {
    const response = proxy(
      makeRequest("/jesus.html/english.html", {
        cookies: {
          forge_watch_lang: encodeURIComponent("chinese-simplified"),
        },
      }),
    )
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain(
      "/jesus.html/chinese-simplified.html",
    )
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
  })

  it("does not rewrite cyrillic slugs (positive allowlist rejects non-ASCII)", () => {
    const response = proxy(
      makeRequest(`/${encodeURIComponent("Иисус")}/english`),
    )
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
  })
})

// ---------------------------------------------------------------------------
// Vary: Cookie — only cookie-dependent redirects carry it (todo 009).
// ---------------------------------------------------------------------------

describe("proxy — Vary: Cookie on cookie-dependent redirects only", () => {
  it("sets Vary: Cookie on the cookie-preference redirect", () => {
    const response = proxy(
      makeRequest("/jesus.html/english.html", {
        cookies: { forge_watch_lang: "spanish" },
      }),
    )
    expect(response.status).toBe(307)
    expect(response.headers.get("vary")).toBe("Cookie")
  })

  it("does NOT set Vary: Cookie on a canonicalize redirect (not cookie-dependent)", () => {
    const response = proxy(makeRequest("/jesus/english"))
    expect(response.status).toBe(307)
    expect(response.headers.get("vary")).toBeNull()
  })
})

// Note: the cookie-path output revalidation (todo 010) is unit-tested at the
// `isUnsafeRedirectPath` boundary in `lib/url-shape.test.ts` — the WHATWG URL
// parser in the proxy test fixture normalizes `\`/`//` before they reach the
// guard, so the guard itself is exercised directly instead.

// ---------------------------------------------------------------------------
// Cross-module idempotence: the cookie redirect's output must already be
// canonical, so the next request converges in one hop (todo 011).
// ---------------------------------------------------------------------------

describe("proxy — cookie redirect output is canonical (single-hop convergence)", () => {
  for (const input of [
    "/jesus.html/english.html",
    "/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
  ]) {
    it(`canonicalize(cookieRedirect("${input}")) is canonical`, () => {
      const r1 = proxy(
        makeRequest(input, { cookies: { forge_watch_lang: "spanish" } }),
      )
      expect(r1.status).toBe(307)
      const next = new URL(r1.headers.get("location") ?? "").pathname
      const r2 = canonicalizeWatchPath({ rawPathname: next })
      expect(r2.kind).toBe("canonical")
    })
  }
})

// ---------------------------------------------------------------------------
// Slug-form cookie values (e.g. spanish-castilian) round-trip into the
// redirected locale segment (todo 014). Downstream page-level resolution is
// slug-aware (resolveUiLocale), so the family-fallback locale renders.
// ---------------------------------------------------------------------------

describe("proxy — slug-form cookie language preference", () => {
  it("redirects to a multi-segment slug-form locale (spanish-castilian)", () => {
    const response = proxy(
      makeRequest("/jesus.html/english.html", {
        cookies: { forge_watch_lang: "spanish-castilian" },
      }),
    )
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain(
      "/jesus.html/spanish-castilian.html",
    )
  })
})
