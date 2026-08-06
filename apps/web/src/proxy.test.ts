import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  WATCH_INTERNAL_REWRITE_HEADER,
  WATCH_SUBTITLE_INTENT_REWRITE_HEADER,
  config,
  proxy,
  type ProxyRequest,
} from "./proxy"
import {
  setWatchRouteManifestSourceForTest,
  type WatchRouteManifest,
} from "./lib/watch-route-manifest"
import { setWatchHomepageAvailabilitySourceForTest } from "./lib/watch-home-route-admission"

const TEST_MANIFEST: WatchRouteManifest = {
  version: "test-version",
  generatedAt: "2026-05-29T12:00:00.000Z",
  contentSlugs: [
    "easter",
    "jesus",
    "lumo-the-gospel-of-john",
    "parable-of-the-sower-and-the-seed",
    "perfect-2",
  ],
  oneSegmentSlugs: ["easter", "jesus", "new-collection", "perfect-2"],
  homepageLocales: ["en", "es"],
  episodePairsByParent: {
    "lumo-the-gospel-of-john": ["lumo-john-1-35-2-22", "wedding-in-cana"],
  },
  audioLanguageSlugs: [
    "aari",
    "bangla-2",
    "english",
    "mandarin-china",
    "russian",
    "spanish-castilian",
    "spanish-latin-american",
    "zulu",
  ],
  audioLanguageIndexesByContent: {
    jesus: [0, 1, 2, 3, 4, 5, 6, 7],
    "perfect-2": [2],
  },
}

let resetManifestSource: (() => void) | null = null
let resetHomepageAvailabilitySource: (() => void) | null = null

beforeEach(() => {
  resetManifestSource = setWatchRouteManifestSourceForTest(async () => ({
    ...TEST_MANIFEST,
  }))
})

afterEach(() => {
  resetManifestSource?.()
  resetManifestSource = null
  resetHomepageAvailabilitySource?.()
  resetHomepageAvailabilitySource = null
  vi.unstubAllEnvs()
})

function makeRequest(
  pathname: string,
  options: {
    acceptLanguage?: string
    headers?: HeadersInit
    origin?: string
  } = {},
): ProxyRequest {
  // Test stand-in for the `ProxyRequest` structural subset proxy() reads.
  // No cast needed — the factory's return type matches the production
  // contract directly. NOTE: proxy() no longer reads cookies — the URL is
  // the sole locale carrier, so there is no cookie field to mock.
  const url = new URL(pathname, options.origin ?? "https://www.jesusfilm.org")
  return {
    nextUrl: Object.assign(url, {
      clone: () => new URL(url.toString()),
    }),
    headers: (() => {
      const headers = new Headers(options.headers)
      if (options.acceptLanguage) {
        headers.set("accept-language", options.acceptLanguage)
      }
      return headers
    })(),
  }
}

function rewritePath(response: Response): string | null {
  const target = response.headers.get("x-middleware-rewrite")
  return target ? new URL(target).pathname : null
}

function expectNotFoundRewrite(response: Response): void {
  expect(response.status).toBe(200)
  expect(rewritePath(response)).toBe("/en/en/404")
  expect(response.headers.get("content-security-policy")).toBe(
    "frame-ancestors 'self'",
  )
  expect(response.headers.get("referrer-policy")).toBe("strict-origin")
  expect(
    rewrittenRequestHeaders(response).get(WATCH_INTERNAL_REWRITE_HEADER),
  ).toBe("/404")
}

function rewrittenRequestHeaders(response: Response): Headers {
  const headers = new Headers()
  const overrideHeaderNames =
    response.headers.get("x-middleware-override-headers")?.split(",") ?? []
  for (const name of overrideHeaderNames) {
    const value = response.headers.get(`x-middleware-request-${name}`)
    if (value !== null) headers.set(name, value)
  }
  return headers
}

// ---------------------------------------------------------------------------
// Phase 3 canonicalize integration — every row from research §5.4 must
// produce the exact (status, Location) tuple, AND every redirect must
// emit Cache-Control: private, max-age=0 for the cutover window.
// ---------------------------------------------------------------------------

describe("proxy — canonicalize integration (§5.4)", () => {
  it("strips trailing slash on /watch root variant → 308", async () => {
    const response = await proxy(makeRequest("/foo/"))
    // /foo/ → Rule 1 (trailing slash) THEN Rule 4 (.html append)
    // Net redirect; one hop; 307 (not just trailing-slash) because Rule 4 fired.
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain("/foo.html/foo.html")
  })

  it("strips trailing slash on .html-shape /jesus.html/ → 308 → /jesus.html", async () => {
    const response = await proxy(makeRequest("/jesus.html/"))
    expect(response.status).toBe(308)
    expect(response.headers.get("location")).toMatch(/\/jesus\.html($|\?)/)
  })

  it("strips trailing slash on full .html shape → 308", async () => {
    const response = await proxy(makeRequest("/jesus.html/english.html/"))
    expect(response.status).toBe(308)
    expect(response.headers.get("location")).toContain(
      "/jesus.html/english.html",
    )
  })

  it("lowercases uppercase .HTML → 307", async () => {
    const response = await proxy(makeRequest("/jesus.HTML/english.html"))
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain(
      "/jesus.html/english.html",
    )
  })

  it("canonicalizes language video indexes without suffixing /videos", async () => {
    const response = await proxy(makeRequest("/spanish-latin-american/videos"))
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain(
      "/spanish-latin-american.html/videos",
    )
  })

  it("appends missing .html on bare locale segment → 307", async () => {
    const response = await proxy(makeRequest("/jesus.html/english"))
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain(
      "/jesus.html/english.html",
    )
  })

  it("duplicate-expands single-segment bare slug → 307", async () => {
    const response = await proxy(makeRequest("/jesus"))
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain("/jesus.html/jesus.html")
  })

  it("appends .html per-segment on two-segment bare → 307", async () => {
    const response = await proxy(makeRequest("/jesus/english"))
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain(
      "/jesus.html/english.html",
    )
  })

  it("resolves chinese-mandarin alias → mandarin-china → 307", async () => {
    const response = await proxy(
      makeRequest("/jesus.html/chinese-mandarin.html"),
    )
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain(
      "/jesus.html/mandarin-china.html",
    )
  })

  it("404s bcp47 catalog keys in public audio slots", async () => {
    const response = await proxy(makeRequest("/jesus.html/en.html"))
    expectNotFoundRewrite(response)
  })

  it("404s bcp47 regional tags in public audio slots", async () => {
    const response = await proxy(makeRequest("/jesus.html/pt-br.html"))
    expectNotFoundRewrite(response)
  })

  it("rewrites legacy 4-segment episode shape into canonical 3-segment → 307", async () => {
    const response = await proxy(
      makeRequest("/lumo-the-gospel-of-john/wedding-in-cana.html/english.html"),
    )
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain(
      "/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
    )
  })

  it("emits Cache-Control: private, max-age=0 on every canonicalize redirect", async () => {
    const response = await proxy(makeRequest("/jesus/english"))
    expect(response.status).toBe(307)
    expect(response.headers.get("cache-control")).toBe("private, max-age=0")
  })

  it("reaches a terminal canonical in one hop (idempotence)", async () => {
    // /jesus → /jesus.html/jesus.html (first hop). Re-feeding the output
    // through proxy should NOT produce another redirect; the app boundary can
    // reject the duplicated non-language audio slot as a terminal 404.
    const second = await proxy(makeRequest("/jesus.html/jesus.html"))
    expectNotFoundRewrite(second)
  })
})

// ---------------------------------------------------------------------------
// Reserved-subtree pass-through. The matcher OR canonicalize's RESERVED_PREFIXES
// guard MUST keep these from being amplified by Rule 5.
// ---------------------------------------------------------------------------

describe("proxy — reserved-subtree pass-through", () => {
  it("does not rewrite /assets/* (would amplify into /assets.html/...)", async () => {
    const response = await proxy(makeRequest("/assets/footer/facebook.svg"))
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
  })

  it("does not rewrite /images logo or favicon assets", async () => {
    for (const path of [
      "/images/jesusfilm-sign.svg",
      "/images/favicon-32.png",
    ]) {
      const response = await proxy(makeRequest(path))
      expect(response.status).not.toBe(307)
      expect(response.status).not.toBe(308)
    }
  })

  it("does not rewrite /fonts/* public assets", async () => {
    const response = await proxy(
      makeRequest("/fonts/Montserrat-VariableFont_wght.woff2"),
    )
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
  })

  it("does not rewrite /api/preview", async () => {
    const response = await proxy(makeRequest("/api/preview"))
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
    expect(rewritePath(response)).toBeNull()
  })

  it("does not rewrite the remaining demo surface or retired demo-search path", async () => {
    for (const path of ["/demo-search", "/demo-recommendations/jesus/en"]) {
      const response = await proxy(makeRequest(path))
      expect(response.status).not.toBe(307)
      expect(response.status).not.toBe(308)
      expect(rewritePath(response)).toBeNull()
    }
  })

  it("does not rewrite /_next/data/...", async () => {
    const response = await proxy(makeRequest("/_next/data/build/x.json"))
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
  })

  it("does not rewrite /.well-known/security.txt", async () => {
    const response = await proxy(makeRequest("/.well-known/security.txt"))
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
  })
})

describe("proxy config matcher — reserved first-segment exclusions", () => {
  const [matcher] = config.matcher
  const matcherRegex = new RegExp(`^${matcher}$`)

  it("excludes reserved public asset and framework subtrees before proxy runs", async () => {
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
    expect(matcherRegex.test("/sitemap.xml")).toBe(false)
    expect(matcherRegex.test("/sitemap/0.xml")).toBe(false)
  })

  it("does not exclude content routes that only start with a reserved word", async () => {
    expect(matcherRegex.test("/images-of-jesus.html/english.html")).toBe(true)
    expect(matcherRegex.test("/fonts-of-worship.html/english.html")).toBe(true)
    expect(matcherRegex.test("/sitemap-of-jesus.html/english.html")).toBe(true)
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
  it("does not redirect a canonical 2-segment watch URL", async () => {
    const response = await proxy(makeRequest("/jesus.html/english.html"))
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
    expect(rewritePath(response)).toBe("/en/en/jesus.html/english.html")
  })

  it("does not redirect a canonical 3-segment episode URL", async () => {
    const response = await proxy(
      makeRequest("/lumo-the-gospel-of-john.html/wedding-in-cana/english.html"),
    )
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
    expect(rewritePath(response)).toBe(
      "/en/en/lumo-the-gospel-of-john.html/lumo-john-1-35-2-22/english.html",
    )
  })

  it("applies watch security headers (CSP) to the canonical 2-segment URL", async () => {
    const response = await proxy(makeRequest("/jesus.html/english.html"))
    expect(response.headers.get("content-security-policy")).toBe(
      "frame-ancestors 'self'",
    )
  })

  it("does not emit a Vary: Cookie header (no cookie-dependent redirects)", async () => {
    const response = await proxy(makeRequest("/jesus.html/english.html"))
    expect(response.headers.get("vary") ?? "").not.toContain("Cookie")
  })
})

describe("proxy — internal locale/htmlLang rewrites", () => {
  it("keeps root and language indexes public while internally adding locale/htmlLang", async () => {
    for (const [publicPath, internalPath] of [
      ["/", "/en/en"],
      ["/languages", "/en/en/languages"],
      ["/french.html/languages", "/fr/fr/languages"],
      ["/spanish-latin-american.html/history", "/es/es-419/history"],
      [
        "/spanish-latin-american.html/videos",
        "/es/es-419/videos/spanish-latin-american",
      ],
    ] as const) {
      const response = await proxy(
        makeRequest(publicPath, { acceptLanguage: "es-ES,es;q=0.9" }),
      )
      expect(response.status).not.toBe(307)
      expect(response.status).not.toBe(308)
      expect(rewritePath(response)).toBe(internalPath)
    }
  })

  it("uses HTTP for development rewrites to an HTTPS loopback request URL", async () => {
    vi.stubEnv("NODE_ENV", "development")

    const response = await proxy(
      makeRequest("/jesus.html/english.html", {
        origin: "https://127.0.0.1:3200",
      }),
    )
    const rewrite = new URL(response.headers.get("x-middleware-rewrite") ?? "")

    expect(rewrite.protocol).toBe("http:")
    expect(rewrite.host).toBe("127.0.0.1:3200")
  })

  it("keeps external development rewrite URLs on HTTPS", async () => {
    vi.stubEnv("NODE_ENV", "development")

    const response = await proxy(
      makeRequest("/jesus.html/english.html", {
        origin: "https://www.jesusfilm.org",
      }),
    )

    expect(
      new URL(response.headers.get("x-middleware-rewrite") ?? "").protocol,
    ).toBe("https:")
  })

  it("keeps loopback rewrite URLs on HTTPS in production", async () => {
    vi.stubEnv("NODE_ENV", "production")

    const response = await proxy(
      makeRequest("/jesus.html/english.html", {
        origin: "https://127.0.0.1:3200",
      }),
    )

    expect(
      new URL(response.headers.get("x-middleware-rewrite") ?? "").protocol,
    ).toBe("https:")
  })

  it("redirects legacy /videos to /languages", async () => {
    const response = await proxy(makeRequest("/videos"))
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain("/languages")
    expect(rewritePath(response)).toBeNull()
  })

  it("redirects deprecated /search into the root surface without preserving q", async () => {
    const response = await proxy(
      makeRequest("/search?q=forgiveness&utm=campaign"),
    )
    expect(response.status).toBe(307)
    const location = new URL(response.headers.get("location") ?? "")
    expect(location.pathname).toBe("/")
    expect(location.search).toBe("?utm=campaign")
    expect(rewritePath(response)).toBeNull()
  })

  it("404s the stale synthetic search shape", async () => {
    const response = await proxy(makeRequest("/search.html/search.html"))
    expectNotFoundRewrite(response)
  })

  it("preserves one-segment collection pages as default-locale collections", async () => {
    const response = await proxy(makeRequest("/easter.html"))
    expect(rewritePath(response)).toBe("/en/en/easter.html")
  })

  it("uses manifest one-segment slugs instead of the static fallback list", async () => {
    const response = await proxy(makeRequest("/new-collection.html"))
    expect(rewritePath(response)).toBe("/en/en/new-collection.html")
  })

  it("prefers an exact English video over a colliding one-segment Experience", async () => {
    const response = await proxy(
      makeRequest("/jesus.html?utm_source=legacy&ref=printed"),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("location")).toBeNull()
    const rewrite = new URL(response.headers.get("x-middleware-rewrite") ?? "")
    expect(rewrite.pathname).toBe("/en/en/jesus.html/english.html")
    expect(rewrite.search).toBe("?utm_source=legacy&ref=printed")
  })

  it("preserves Experience precedence for a legacy manifest without exact video languages", async () => {
    resetManifestSource?.()
    resetManifestSource = setWatchRouteManifestSourceForTest(async () => ({
      ...TEST_MANIFEST,
      audioLanguageIndexesByContent: undefined,
    }))

    const response = await proxy(makeRequest("/jesus.html"))
    expect(rewritePath(response)).toBe("/en/en/jesus.html")
  })

  it("404s a language-less video without an admitted English dub", async () => {
    resetManifestSource?.()
    resetManifestSource = setWatchRouteManifestSourceForTest(async () => ({
      ...TEST_MANIFEST,
      audioLanguageSlugs: ["english", "russian"],
      audioLanguageIndexesByContent: {
        jesus: [1],
      },
    }))

    const response = await proxy(makeRequest("/jesus.html"))
    expectNotFoundRewrite(response)
  })

  it("admits canonical and explicit English parent routes through an English nested collection", async () => {
    resetManifestSource?.()
    resetManifestSource = setWatchRouteManifestSourceForTest(async () => ({
      ...TEST_MANIFEST,
      contentSlugs: ["discipleship", "walking-with-jesus"],
      audioLanguageSlugs: ["english", "afrikaans"],
      audioLanguageIndexesByContent: {
        discipleship: [1],
        "walking-with-jesus": [0],
      },
      nestedContainerAudioLanguageIndexesByParent: {
        discipleship: {
          "walking-with-jesus": [0],
        },
      },
    }))

    const canonical = await proxy(makeRequest("/discipleship.html"))
    const explicit = await proxy(makeRequest("/discipleship.html/english.html"))

    expect(rewritePath(canonical)).toBe("/en/en/discipleship.html/english.html")
    expect(rewritePath(explicit)).toBe("/en/en/discipleship.html/english.html")
  })

  it("keeps nested parent admission closed until a nested relation snapshot is generated", async () => {
    resetManifestSource?.()
    resetManifestSource = setWatchRouteManifestSourceForTest(async () => ({
      ...TEST_MANIFEST,
      contentSlugs: ["discipleship", "walking-with-jesus"],
      episodePairsByParent: {
        discipleship: ["walking-with-jesus"],
      },
      audioLanguageSlugs: ["english", "afrikaans"],
      audioLanguageIndexesByContent: {
        discipleship: [1],
        "walking-with-jesus": [0],
      },
    }))

    const response = await proxy(makeRequest("/discipleship.html"))

    expectNotFoundRewrite(response)
  })

  it("keeps language-less non-collection routes closed when the manifest is unavailable", async () => {
    resetManifestSource?.()
    resetManifestSource = setWatchRouteManifestSourceForTest(async () => null)

    const response = await proxy(makeRequest("/jesus.html"))
    expectNotFoundRewrite(response)
  })

  it("rewrites one-segment public language homes with locale/htmlLang matching the slug", async () => {
    const response = await proxy(makeRequest("/spanish-castilian.html"))
    expect(rewritePath(response)).toBe("/es/es-ES/spanish-castilian.html")
  })

  it("redirects a language without a published homepage before the static page route", async () => {
    const response = await proxy(makeRequest("/russian.html"))

    expect(response.status).toBe(307)
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/russian.html/videos",
    )
    expect(response.headers.get("cache-control")).toBe("private, max-age=0")
    expect(rewritePath(response)).toBeNull()
  })

  it("falls back to the existing GraphQL homepage contract for an older manifest", async () => {
    resetManifestSource?.()
    resetManifestSource = setWatchRouteManifestSourceForTest(async () => ({
      ...TEST_MANIFEST,
      homepageLocales: undefined,
    }))
    resetHomepageAvailabilitySource = setWatchHomepageAvailabilitySourceForTest(
      async (locale) => (locale === "es" ? "available" : "missing"),
    )

    const available = await proxy(makeRequest("/spanish-castilian.html"))
    const missing = await proxy(makeRequest("/russian.html"))

    expect(rewritePath(available)).toBe("/es/es-ES/spanish-castilian.html")
    expect(missing.status).toBe(307)
    expect(new URL(missing.headers.get("location") ?? "").pathname).toBe(
      "/russian.html/videos",
    )
  })

  it("does not infer a missing homepage when the fallback lookup fails", async () => {
    resetManifestSource?.()
    resetManifestSource = setWatchRouteManifestSourceForTest(async () => ({
      ...TEST_MANIFEST,
      homepageLocales: undefined,
    }))
    resetHomepageAvailabilitySource = setWatchHomepageAvailabilitySourceForTest(
      async () => "unknown",
    )

    const response = await proxy(makeRequest("/russian.html"))

    expect(rewritePath(response)).toBe("/ru/ru/russian.html")
  })

  it("rewrites the English-British homepage with a regional htmlLang", async () => {
    const response = await proxy(makeRequest("/english-british.html"))
    expect(rewritePath(response)).toBe("/en/en-GB/english-british.html")
  })

  it("rewrites localized videos indexes while preserving the raw language slug", async () => {
    const response = await proxy(
      makeRequest("/spanish-latin-american.html/videos"),
    )
    expect(rewritePath(response)).toBe(
      "/es/es-419/videos/spanish-latin-american",
    )
  })

  it("rewrites unsupported-language videos indexes with English chrome fallback", async () => {
    const response = await proxy(makeRequest("/aari.html/videos"))
    expect(rewritePath(response)).toBe("/en/en/videos/aari")
  })

  it("404s bcp47 catalog keys as one-segment public homes", async () => {
    const response = await proxy(makeRequest("/en.html"))
    expectNotFoundRewrite(response)
  })

  it("404s stale language-home aliases that current production no longer serves", async () => {
    for (const path of ["/german.html", "/swahili.html"]) {
      const response = await proxy(makeRequest(path))
      expectNotFoundRewrite(response)
    }
  })

  it("keeps the raw audio slug in rest while using message locale + regional htmlLang", async () => {
    const response = await proxy(
      makeRequest("/jesus.html/spanish-latin-american.html"),
    )
    expect(rewritePath(response)).toBe(
      "/es/es-419/jesus.html/spanish-latin-american.html",
    )
  })

  it("falls back chrome identity for unsupported audio-language families", async () => {
    const response = await proxy(makeRequest("/jesus.html/aari.html"))
    expect(rewritePath(response)).toBe("/en/en/jesus.html/aari.html")
  })

  it("uses the imported Russian UI catalog for Russian public audio URLs", async () => {
    const response = await proxy(makeRequest("/jesus.html/russian.html"))
    expect(rewritePath(response)).toBe("/ru/ru/jesus.html/russian.html")
  })

  it("encodes valid subtitle intent in a trusted internal segment without changing the browser URL", async () => {
    const response = await proxy(
      makeRequest(
        "/jesus.html/english.html?subtitles=russian&utm_source=search",
      ),
    )
    const rewrite = new URL(response.headers.get("x-middleware-rewrite") ?? "")

    expect(response.headers.get("location")).toBeNull()
    expect(rewrite.pathname).toBe(
      "/en/en/jesus.html/english.html/__subtitle-russian",
    )
    expect(rewrite.search).toBe("?subtitles=russian&utm_source=search")
    expect(
      rewrittenRequestHeaders(response).get(
        WATCH_SUBTITLE_INTENT_REWRITE_HEADER,
      ),
    ).toBe("russian")

    const admitted = await proxy(
      makeRequest(`${rewrite.pathname}${rewrite.search}`, {
        headers: rewrittenRequestHeaders(response),
      }),
    )
    expect(admitted.status).toBe(200)
    expect(rewritePath(admitted)).toBeNull()
  })

  it("keeps subtitle intent when canonical English one-segment admission expands to an internal video route", async () => {
    const response = await proxy(
      makeRequest("/perfect-2.html?subtitles=russian"),
    )
    const rewrite = new URL(response.headers.get("x-middleware-rewrite") ?? "")

    expect(response.headers.get("location")).toBeNull()
    expect(rewrite.pathname).toBe(
      "/en/en/perfect-2.html/english.html/__subtitle-russian",
    )
    expect(rewrite.search).toBe("?subtitles=russian")
    expect(
      rewrittenRequestHeaders(response).get(
        WATCH_SUBTITLE_INTENT_REWRITE_HEADER,
      ),
    ).toBe("russian")
  })

  it.each(["?subtitles=Russian!", "?subtitles=russian&subtitles=spanish"])(
    "does not encode malformed subtitle intent %s",
    async (search) => {
      const response = await proxy(
        makeRequest(`/jesus.html/english.html${search}`),
      )

      expect(rewritePath(response)).toBe("/en/en/jesus.html/english.html")
      expect(
        rewrittenRequestHeaders(response).get(
          WATCH_SUBTITLE_INTENT_REWRITE_HEADER,
        ),
      ).toBeNull()
    },
  )

  it("does not encode a well-formed unknown subtitle slug into the ISR path", async () => {
    const response = await proxy(
      makeRequest("/jesus.html/english.html?subtitles=made-up-language"),
    )

    expect(rewritePath(response)).toBe("/en/en/jesus.html/english.html")
    expect(
      rewrittenRequestHeaders(response).get(
        WATCH_SUBTITLE_INTENT_REWRITE_HEADER,
      ),
    ).toBeNull()
  })

  it("uses the imported Bangla UI catalog for Bangla public audio URLs", async () => {
    const response = await proxy(makeRequest("/jesus.html/bangla-2.html"))
    expect(rewritePath(response)).toBe("/bn/bn/jesus.html/bangla-2.html")
  })

  it("404s unknown public audio slugs before they reach the app route", async () => {
    const response = await proxy(makeRequest("/easter.html/non-existent.html"))
    expectNotFoundRewrite(response)
  })

  it("404s stale public audio aliases that current production no longer serves", async () => {
    const response = await proxy(makeRequest("/jesus.html/swahili.html"))
    expectNotFoundRewrite(response)
  })

  it("404s safe-looking unknown content slugs before catch-all page resolution", async () => {
    const response = await proxy(makeRequest("/anything.html/english.html"))
    expectNotFoundRewrite(response)
  })

  it("404s safe-looking unknown episode pairs before catch-all page resolution", async () => {
    const response = await proxy(
      makeRequest("/lumo-the-gospel-of-john.html/anything/english.html"),
    )
    expectNotFoundRewrite(response)
  })

  it("301 redirects rejected legacy contexts to an admitted standalone video", async () => {
    resetManifestSource?.()
    let manifestReads = 0
    resetManifestSource = setWatchRouteManifestSourceForTest(async () => {
      manifestReads += 1
      return { ...TEST_MANIFEST }
    })

    const response = await proxy(
      makeRequest(
        "/discipleship.html/parable-of-the-sower-and-the-seed/spanish-latin-american.html?utm_source=google&ref=legacy",
      ),
    )

    expect(response.status).toBe(301)
    const location = new URL(response.headers.get("location") ?? "")
    expect(location.pathname).toBe(
      "/parable-of-the-sower-and-the-seed.html/spanish-latin-american.html",
    )
    expect(location.search).toBe("?utm_source=google&ref=legacy")
    expect(response.headers.get("cache-control")).toBe("private, max-age=0")
    expect(rewritePath(response)).toBeNull()
    expect(manifestReads).toBe(1)
  })

  it("redirects a rejected English context to the canonical language-less standalone video", async () => {
    const response = await proxy(
      makeRequest(
        "/discipleship.html/parable-of-the-sower-and-the-seed/english.html?utm_source=google&ref=legacy",
      ),
    )

    expect(response.status).toBe(301)
    const location = new URL(response.headers.get("location") ?? "")
    expect(location.pathname).toBe("/parable-of-the-sower-and-the-seed.html")
    expect(location.search).toBe("?utm_source=google&ref=legacy")
    expect(response.headers.get("cache-control")).toBe("private, max-age=0")
  })

  it("404s rejected contexts when the standalone video lacks the requested dub", async () => {
    resetManifestSource?.()
    resetManifestSource = setWatchRouteManifestSourceForTest(async () => ({
      ...TEST_MANIFEST,
      contentSlugs: ["parable-of-the-sower-and-the-seed"],
      episodePairsByParent: {},
      audioLanguageSlugs: ["english", "spanish-latin-american"],
      audioLanguageIndexesByContent: {
        "parable-of-the-sower-and-the-seed": [0],
      },
    }))

    const response = await proxy(
      makeRequest(
        "/discipleship.html/parable-of-the-sower-and-the-seed/spanish-latin-american.html",
      ),
    )

    expectNotFoundRewrite(response)
  })

  it("fails open to contextual resolution when the route manifest is unavailable", async () => {
    resetManifestSource?.()
    resetManifestSource = setWatchRouteManifestSourceForTest(async () => null)

    const response = await proxy(
      makeRequest(
        "/discipleship.html/parable-of-the-sower-and-the-seed/spanish-latin-american.html",
      ),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("location")).toBeNull()
    expect(rewritePath(response)).toBe(
      "/es/es-419/discipleship.html/parable-of-the-sower-and-the-seed/spanish-latin-american.html",
    )
  })

  it("keeps the fixed 404 sentinel internal", async () => {
    const visible = await proxy(makeRequest("/en/en/404"))
    expect(visible.status).toBe(308)
    expect(new URL(visible.headers.get("location") ?? "").pathname).toBe("/404")

    const publicRequest = await proxy(makeRequest("/404"))
    expect(publicRequest.status).toBe(307)
    expect(rewritePath(publicRequest)).toBeNull()
  })

  it("internally rewrites legacy public episode aliases to current admin episode slugs", async () => {
    const response = await proxy(
      makeRequest("/lumo-the-gospel-of-john.html/wedding-in-cana/english.html"),
    )
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
    expect(rewritePath(response)).toBe(
      "/en/en/lumo-the-gospel-of-john.html/lumo-john-1-35-2-22/english.html",
    )
  })

  it("uses exact manifest episode/audio pairs when the route-audio index is present", async () => {
    resetManifestSource?.()
    resetManifestSource = setWatchRouteManifestSourceForTest(async () => ({
      ...TEST_MANIFEST,
      contentSlugs: ["lumo-the-gospel-of-luke", "lumo-the-gospel-of-mark"],
      episodePairsByParent: {
        "lumo-the-gospel-of-luke": ["lumo-luke-1-57-2-40"],
        "lumo-the-gospel-of-mark": ["jesus-baptism"],
      },
      audioLanguageSlugs: ["english", "spanish-castilian"],
      audioLanguageIndexesByEpisode: {
        "lumo-the-gospel-of-luke": {
          "lumo-luke-1-57-2-40": [0],
        },
        "lumo-the-gospel-of-mark": {
          "jesus-baptism": [1],
        },
      },
    }))

    const valid = await proxy(
      makeRequest("/lumo-the-gospel-of-luke.html/birth-of-jesus/english.html"),
    )
    expect(rewritePath(valid)).toBe(
      "/en/en/lumo-the-gospel-of-luke.html/lumo-luke-1-57-2-40/english.html",
    )

    const missingDub = await proxy(
      makeRequest(
        "/lumo-the-gospel-of-luke.html/birth-of-jesus/spanish-castilian.html",
      ),
    )
    expectNotFoundRewrite(missingDub)

    const otherMissingDub = await proxy(
      makeRequest("/lumo-the-gospel-of-mark.html/jesus-baptism/english.html"),
    )
    expectNotFoundRewrite(otherMissingDub)
  })
})

describe("proxy — visible internal-prefix policy", () => {
  it("allows proxy-originated internal rewrites without redirecting back to public URL", async () => {
    const first = await proxy(makeRequest("/jesus.html?ref=printed"))
    const internalPath = rewritePath(first)

    expect(internalPath).toBe("/en/en/jesus.html/english.html")

    const second = await proxy(
      makeRequest(internalPath ?? "", {
        headers: rewrittenRequestHeaders(first),
      }),
    )

    expect(
      first.headers.get(
        `x-middleware-request-${WATCH_INTERNAL_REWRITE_HEADER}`,
      ),
    ).toBe("/jesus.html")
    expect(second.status).toBe(200)
  })

  it("does not trust a caller-supplied internal rewrite marker as admission", async () => {
    resetManifestSource?.()
    resetManifestSource = setWatchRouteManifestSourceForTest(async () => ({
      version: "test",
      generatedAt: "2026-07-25T00:00:00.000Z",
      contentSlugs: [],
      oneSegmentSlugs: [],
      episodePairsByParent: {},
      audioLanguageSlugs: ["english"],
      audioLanguageIndexesByContent: {},
      audioLanguageIndexesByEpisode: {},
    }))

    const response = await proxy(
      makeRequest("/en/en/new-collection.html", {
        headers: new Headers([
          [WATCH_INTERNAL_REWRITE_HEADER, "/new-collection.html"],
        ]),
      }),
    )

    expectNotFoundRewrite(response)
  })

  it("rejects hidden subtitle segments without the dedicated rewrite claim", async () => {
    const response = await proxy(
      makeRequest(
        "/en/en/jesus.html/english.html/__subtitle-russian?subtitles=russian",
        {
          headers: new Headers([
            [WATCH_INTERNAL_REWRITE_HEADER, "/jesus.html/english.html"],
          ]),
        },
      ),
    )

    expectNotFoundRewrite(response)
  })

  it("keeps caller-claimed internal Experiences closed when the manifest is unavailable", async () => {
    resetManifestSource?.()
    resetManifestSource = setWatchRouteManifestSourceForTest(async () => null)

    const response = await proxy(
      makeRequest("/en/en/new-collection.html", {
        headers: new Headers([
          [WATCH_INTERNAL_REWRITE_HEADER, "/new-collection.html"],
        ]),
      }),
    )

    expectNotFoundRewrite(response)
  })

  it("normalizes a visible internal English video prefix to its language-less canonical URL", async () => {
    const response = await proxy(
      makeRequest("/en/en/jesus.html/english.html?ref=visible"),
    )

    expect(response.status).toBe(308)
    const location = new URL(response.headers.get("location") ?? "")
    expect(location.pathname).toBe("/jesus.html")
    expect(location.search).toBe("?ref=visible")
  })

  it("keeps explicit English when a content slug conflicts with a public language home", async () => {
    const response = await proxy(
      makeRequest("/en/en/russian.html/english.html"),
    )

    expect(response.status).toBe(308)
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/russian.html/english.html",
    )
  })

  it("308 redirects visible internal root and route prefixes to canonical public URLs", async () => {
    for (const [visible, canonical] of [
      ["/en", "/"],
      ["/en/en", "/"],
      ["/en/en/videos", "/languages"],
      ["/en/en/languages", "/languages"],
      [
        "/es/es-419/spanish-latin-american.html/videos",
        "/spanish-latin-american.html/videos",
      ],
      [
        "/es/es-419/jesus.html/spanish-latin-american.html",
        "/jesus.html/spanish-latin-american.html",
      ],
    ] as const) {
      const response = await proxy(makeRequest(visible))
      expect(response.status).toBe(308)
      expect(response.headers.get("location")).toContain(canonical)
    }
  })

  it("does not misclassify slug-form public URLs as internal prefixes", async () => {
    const response = await proxy(makeRequest("/en/english"))
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain("/en.html/english.html")
  })

  it("404s invalid visible internal prefix pairs instead of serving duplicates", async () => {
    const response = await proxy(
      makeRequest("/en/es-419/jesus.html/english.html"),
    )
    expectNotFoundRewrite(response)
  })

  it("404s invalid marked internal prefix pairs instead of treating the marker as a bypass", async () => {
    const response = await proxy(
      makeRequest("/en/es-419/jesus.html/english.html", {
        headers: new Headers([
          [WATCH_INTERNAL_REWRITE_HEADER, "/jesus.html/english.html"],
        ]),
      }),
    )
    expectNotFoundRewrite(response)
  })
})

// ---------------------------------------------------------------------------
// Resilience: malformed inputs do not crash. Canonical shape is preserved.
// ---------------------------------------------------------------------------

describe("proxy — resilience on malformed inputs", () => {
  it("handles double-.html on a segment without crashing", async () => {
    // Not a recognised rule input. Just must not throw.
    await expect(
      proxy(makeRequest("/jesus.html.html/english.html")),
    ).resolves.toBeDefined()
  })

  it("handles empty segment (/.html) without crashing", async () => {
    await expect(proxy(makeRequest("/.html"))).resolves.toBeDefined()
  })

  it("does not rewrite percent-encoded paths (positive allowlist rejects)", async () => {
    const response = await proxy(makeRequest("/jesus%20test/english"))
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
    expectNotFoundRewrite(response)
  })

  it("does not rewrite cyrillic slugs (positive allowlist rejects non-ASCII)", async () => {
    const response = await proxy(
      makeRequest(`/${encodeURIComponent("Иисус")}/english`),
    )
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
    expectNotFoundRewrite(response)
  })

  it("404s four-segment paths in proxy before they can mint route cache entries", async () => {
    const response = await proxy(makeRequest("/a.html/b/c.html/d.html"))
    expectNotFoundRewrite(response)
  })
})
