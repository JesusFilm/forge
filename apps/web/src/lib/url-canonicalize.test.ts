import { describe, expect, it } from "vitest"

import { canonicalizeWatchPath } from "./url-canonicalize"

const canonical = canonicalizeWatchPath

describe("canonicalizeWatchPath: short-circuit guards", () => {
  it("returns canonical for empty path", () => {
    expect(canonical({ rawPathname: "" })).toEqual({ kind: "canonical" })
  })

  it("returns canonical for root /", () => {
    expect(canonical({ rawPathname: "/" })).toEqual({ kind: "canonical" })
  })

  it("returns canonical for reserved subtree: api", () => {
    expect(canonical({ rawPathname: "/api/preview" })).toEqual({
      kind: "canonical",
    })
  })

  it("returns canonical for reserved subtree: _next/data (RSC payload)", () => {
    expect(canonical({ rawPathname: "/_next/data/v=1/jesus.json" })).toEqual({
      kind: "canonical",
    })
  })

  it("returns canonical for reserved subtree: _next/image", () => {
    expect(canonical({ rawPathname: "/_next/image?url=foo" })).toEqual({
      kind: "canonical",
    })
  })

  it("returns canonical for reserved subtree: assets", () => {
    expect(canonical({ rawPathname: "/assets/favicon-180.png" })).toEqual({
      kind: "canonical",
    })
  })

  it("returns canonical for reserved subtree: images", () => {
    expect(canonical({ rawPathname: "/images/jesusfilm-sign.svg" })).toEqual({
      kind: "canonical",
    })
    expect(canonical({ rawPathname: "/images/flags/ru.svg" })).toEqual({
      kind: "canonical",
    })
  })

  it("returns canonical for reserved subtree: fonts", () => {
    expect(
      canonical({ rawPathname: "/fonts/Montserrat-VariableFont_wght.woff2" }),
    ).toEqual({
      kind: "canonical",
    })
  })

  it("returns canonical for reserved literals: favicon, manifest, robots, sitemap", () => {
    expect(canonical({ rawPathname: "/favicon.ico" })).toEqual({
      kind: "canonical",
    })
    expect(canonical({ rawPathname: "/manifest.webmanifest" })).toEqual({
      kind: "canonical",
    })
    expect(canonical({ rawPathname: "/robots.txt" })).toEqual({
      kind: "canonical",
    })
    expect(canonical({ rawPathname: "/sitemap.xml" })).toEqual({
      kind: "canonical",
    })
  })

  it("short-circuits length-cap (ReDoS defense)", () => {
    const long = "/" + "a".repeat(3000)
    expect(canonical({ rawPathname: long })).toEqual({ kind: "canonical" })
  })

  it("rejects // prefix (open-redirect defense)", () => {
    expect(canonical({ rawPathname: "//evil.com/foo" })).toEqual({
      kind: "canonical",
    })
  })

  it("rejects backslash injection", () => {
    expect(canonical({ rawPathname: "/foo\\bar" })).toEqual({
      kind: "canonical",
    })
  })

  it("rejects CRLF injection (literal)", () => {
    expect(canonical({ rawPathname: "/foo\r\nSet-Cookie: x=y" })).toEqual({
      kind: "canonical",
    })
  })

  it("rejects CRLF injection (percent-encoded)", () => {
    expect(canonical({ rawPathname: "/foo%0d%0aSet-Cookie:%20x=y" })).toEqual({
      kind: "canonical",
    })
  })

  it("rejects directory traversal", () => {
    expect(canonical({ rawPathname: "/foo/../evil" })).toEqual({
      kind: "canonical",
    })
  })

  it("rejects percent-encoded backslash", () => {
    expect(canonical({ rawPathname: "/foo%5Cbar" })).toEqual({
      kind: "canonical",
    })
  })

  it("rejects null byte", () => {
    expect(canonical({ rawPathname: "/foo%00bar" })).toEqual({
      kind: "canonical",
    })
  })

  it("rejects percent-encoded traversal", () => {
    expect(canonical({ rawPathname: "/foo%2E%2E/english" })).toEqual({
      kind: "canonical",
    })
  })

  it("rejects javascript: scheme", () => {
    expect(canonical({ rawPathname: "/javascript:alert(1)" })).toEqual({
      kind: "canonical",
    })
  })

  it("rejects host-shaped single-segment input (Rule 5 SLUG_PATTERN guard)", () => {
    expect(canonical({ rawPathname: "/evil.com" })).toEqual({
      kind: "canonical",
    })
  })

  it("preserves .well-known subtree (passes through unmodified)", () => {
    expect(canonical({ rawPathname: "/.well-known/security.txt" })).toEqual({
      kind: "canonical",
    })
  })
})

describe("Rule 1: trailing-slash strip → 308 with long cache", () => {
  it("strips /watch/ → /watch (using empty input since basePath stripped)", () => {
    expect(canonical({ rawPathname: "/jesus.html/" })).toEqual({
      kind: "redirect",
      pathname: "/jesus.html",
      status: 308,
      cache: "long",
    })
  })

  it("strips trailing slash on canonical 2-segment URL", () => {
    expect(canonical({ rawPathname: "/jesus.html/english.html/" })).toEqual({
      kind: "redirect",
      pathname: "/jesus.html/english.html",
      status: 308,
      cache: "long",
    })
  })
})

describe("Rule 1.5: legacy /videos index → /languages → 308", () => {
  it("redirects legacy /videos to /languages", () => {
    expect(canonical({ rawPathname: "/videos" })).toEqual({
      kind: "redirect",
      pathname: "/languages",
      status: 308,
      cache: "long",
    })
  })

  it("keeps the move permanent when a trailing slash is also stripped", () => {
    expect(canonical({ rawPathname: "/videos/" })).toEqual({
      kind: "redirect",
      pathname: "/languages",
      status: 308,
      cache: "long",
    })
  })
})

describe("Rule 2: lowercase .HTML → .html → 308", () => {
  it("lowercases uppercase suffix", () => {
    expect(canonical({ rawPathname: "/jesus.HTML/english.html" })).toEqual({
      kind: "redirect",
      pathname: "/jesus.html/english.html",
      status: 308,
      cache: "long",
    })
  })

  it("lowercases both segments", () => {
    expect(canonical({ rawPathname: "/jesus.HTML/english.HTML" })).toEqual({
      kind: "redirect",
      pathname: "/jesus.html/english.html",
      status: 308,
      cache: "long",
    })
  })
})

describe("Rule 3: legacy 4-segment-shape episode rewrite → 308", () => {
  it("rewrites /series/ep.html/lang.html → /series.html/ep/lang.html", () => {
    expect(
      canonical({
        rawPathname:
          "/lumo-the-gospel-of-john/wedding-in-cana.html/english.html",
      }),
    ).toEqual({
      kind: "redirect",
      pathname: "/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
      status: 308,
      cache: "long",
    })
  })

  it("rewrites legacy episode shape preserving lang", () => {
    expect(
      canonical({
        rawPathname: "/jesus/the-beginning.html/english.html",
      }),
    ).toEqual({
      kind: "redirect",
      pathname: "/jesus.html/the-beginning/english.html",
      status: 308,
      cache: "long",
    })
  })
})

describe("Rule 4: per-segment .html append → 308", () => {
  it("appends .html on 2-segment missing both", () => {
    expect(canonical({ rawPathname: "/foo/bar" })).toEqual({
      kind: "redirect",
      pathname: "/foo.html/bar.html",
      status: 308,
      cache: "long",
    })
  })

  it("appends .html on 2-segment missing only locale", () => {
    expect(canonical({ rawPathname: "/jesus.html/english" })).toEqual({
      kind: "redirect",
      pathname: "/jesus.html/english.html",
      status: 308,
      cache: "long",
    })
  })

  it("keeps localized /videos indexes .html-free on the final segment", () => {
    expect(
      canonical({ rawPathname: "/spanish-latin-american/videos" }),
    ).toEqual({
      kind: "redirect",
      pathname: "/spanish-latin-american.html/videos",
      status: 308,
      cache: "long",
    })
    expect(
      canonical({ rawPathname: "/spanish-latin-american.html/videos.html" }),
    ).toEqual({
      kind: "redirect",
      pathname: "/spanish-latin-american.html/videos",
      status: 308,
      cache: "long",
    })
  })

  it("appends .html on 3-segment missing first + last (episode stays bare)", () => {
    expect(canonical({ rawPathname: "/jesus/the-beginning/english" })).toEqual({
      kind: "redirect",
      pathname: "/jesus.html/the-beginning/english.html",
      status: 308,
      cache: "long",
    })
  })

  it("does NOT append .html to episode segment in 3-segment shape", () => {
    expect(
      canonical({
        rawPathname: "/jesus.html/the-beginning/english.html",
      }),
    ).toEqual({ kind: "canonical" })
  })
})

describe("Rule 5: single-segment → duplicate-with-.html → 307", () => {
  it("rewrites /foo → /foo.html/foo.html", () => {
    expect(canonical({ rawPathname: "/foo" })).toEqual({
      kind: "redirect",
      pathname: "/foo.html/foo.html",
      status: 307,
      cache: "short",
    })
  })

  it("rewrites arbitrary single segments", () => {
    expect(canonical({ rawPathname: "/about" })).toEqual({
      kind: "redirect",
      pathname: "/about.html/about.html",
      status: 307,
      cache: "short",
    })
  })

  it("does NOT fire for /languages (exempt)", () => {
    expect(canonical({ rawPathname: "/languages" })).toEqual({
      kind: "canonical",
    })
  })

  it("does NOT fire for /whats-new (exempt)", () => {
    expect(canonical({ rawPathname: "/whats-new" })).toEqual({
      kind: "canonical",
    })
  })

  it("still fires for a hyphenated slug outside the exempt set", () => {
    // Falsifies the case above — the exemption is keyed on the literal, not
    // on the presence of a hyphen.
    expect(canonical({ rawPathname: "/whats-old" })).toEqual({
      kind: "redirect",
      pathname: "/whats-old.html/whats-old.html",
      status: 307,
      cache: "short",
    })
  })

  it("does NOT fire for /history (exempt)", () => {
    expect(canonical({ rawPathname: "/history" })).toEqual({
      kind: "canonical",
    })
    // Without the exemption /history/ chained into a cacheable 308 that 404s.
    expect(canonical({ rawPathname: "/history/" })).toEqual({
      kind: "redirect",
      pathname: "/history",
      status: 308,
      cache: "long",
    })
  })

  it("does NOT fire for deprecated /search", () => {
    expect(canonical({ rawPathname: "/search" })).toEqual({
      kind: "canonical",
    })
  })

  it("does NOT fire for /russian.html (already has .html)", () => {
    expect(canonical({ rawPathname: "/russian.html" })).toEqual({
      kind: "canonical",
    })
  })
})

describe("Rule 4.5: 3-segment episode-bare contract → 308", () => {
  // Production contract: in /{series}.html/{episode}/{lang}.html the episode
  // segment must be bare. Catch the case where all three arrive .html-suffixed.

  it("strips .html from episode segment when 3-seg shape has it everywhere", () => {
    expect(
      canonical({
        rawPathname:
          "/lumo-the-gospel-of-john.html/wedding-in-cana.html/english.html",
      }),
    ).toEqual({
      kind: "redirect",
      pathname: "/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
      status: 308,
      cache: "long",
    })
  })

  it("strips .html from episode preserving alternate locales", () => {
    expect(
      canonical({
        rawPathname: "/jesus.html/the-beginning.html/spanish-castilian.html",
      }),
    ).toEqual({
      kind: "redirect",
      pathname: "/jesus.html/the-beginning/spanish-castilian.html",
      status: 308,
      cache: "long",
    })
  })

  it("property: every 3-seg canonical output has bare episode segment", () => {
    const inputs = [
      "/lumo-the-gospel-of-john.html/wedding-in-cana.html/english.html",
      "/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
      "/jesus.html/the-beginning/english.html",
      "/jesus.html/the-beginning.html/russian.html",
      "/jesus/the-beginning/english",
    ]
    for (const raw of inputs) {
      const result = canonical({ rawPathname: raw })
      const final = result.kind === "redirect" ? result.pathname : raw
      const segs = final.split("/").filter(Boolean)
      if (segs.length === 3) {
        expect(segs[1].endsWith(".html")).toBe(false)
      }
    }
  })
})

describe("Rule 6: language-slug alias → 308", () => {
  it("rewrites chinese-mandarin → mandarin-china in locale segment", () => {
    expect(
      canonical({ rawPathname: "/jesus.html/chinese-mandarin.html" }),
    ).toEqual({
      kind: "redirect",
      pathname: "/jesus.html/mandarin-china.html",
      status: 308,
      cache: "long",
    })
  })

  it("does not rewrite bcp47 catalog keys in the public locale segment", () => {
    expect(canonical({ rawPathname: "/jesus.html/en.html" })).toEqual({
      kind: "canonical",
    })
  })

  it("applies alias on 3-segment shape (locale at index 2)", () => {
    expect(
      canonical({
        rawPathname:
          "/lumo-the-gospel-of-john.html/wedding-in-cana/chinese-mandarin.html",
      }),
    ).toEqual({
      kind: "redirect",
      pathname:
        "/lumo-the-gospel-of-john.html/wedding-in-cana/mandarin-china.html",
      status: 308,
      cache: "long",
    })
  })

  it.each(["languages", "history", "videos"])(
    "applies alias to localized %s routes",
    (utility) => {
      expect(
        canonical({
          rawPathname: `/chinese-mandarin.html/${utility}`,
        }),
      ).toEqual({
        kind: "redirect",
        pathname: `/mandarin-china.html/${utility}`,
        status: 308,
        cache: "long",
      })
    },
  )

  it("does NOT apply alias to slug segment (segment 0)", () => {
    // No content slug named "chinese-mandarin", but verify shape: even if
    // it were, alias resolves only on the locale segment, not the slug.
    expect(
      canonical({ rawPathname: "/chinese-mandarin.html/english.html" }),
    ).toEqual({ kind: "canonical" })
  })
})

describe("rule composition: permanent unless Rule 5 contributes", () => {
  // Per docs/research/jesusfilm-watch-url-patterns.md §3: production is
  // case-sensitive on the slug content but case-insensitive on the .html
  // suffix only. We mirror that — uppercase slugs are NOT lowercased.

  it("/Jesus.HTML/ composes slash-strip + suffix-lowercase → 308", () => {
    expect(canonical({ rawPathname: "/Jesus.HTML/" })).toEqual({
      kind: "redirect",
      pathname: "/Jesus.html",
      status: 308,
      cache: "long",
    })
  })

  it("/Jesus.HTML/English composes lowercase + append (slug case preserved)", () => {
    expect(canonical({ rawPathname: "/Jesus.HTML/English" })).toEqual({
      kind: "redirect",
      pathname: "/Jesus.html/English.html",
      status: 308,
      cache: "long",
    })
  })

  it("/Jesus.HTML/english composes lowercase + append", () => {
    expect(canonical({ rawPathname: "/Jesus.HTML/english" })).toEqual({
      kind: "redirect",
      pathname: "/Jesus.html/english.html",
      status: 308,
      cache: "long",
    })
  })
})

describe("rule composition: Rule 5 keeps the whole redirect temporary", () => {
  // Rule 5's synthesized `/{seg}.html/{seg}.html` target 404s for real
  // content slugs (FGE-203 / W-070). A permanent rule firing alongside it
  // must not promote the hop to a cacheable 308.

  it("/foo/ composes slash-strip + Rule 5 → 307 / short", () => {
    expect(canonical({ rawPathname: "/foo/" })).toEqual({
      kind: "redirect",
      pathname: "/foo.html/foo.html",
      status: 307,
      cache: "short",
    })
  })

  it("/chinese-mandarin composes Rule 5 + Rule 6 alias → 307 / short", () => {
    expect(canonical({ rawPathname: "/chinese-mandarin" })).toEqual({
      kind: "redirect",
      pathname: "/chinese-mandarin.html/mandarin-china.html",
      status: 307,
      cache: "short",
    })
  })

  it("status and cache intent never disagree", () => {
    const inputs = [
      "/jesus.html/",
      "/videos",
      "/jesus.HTML",
      "/jesus/the-beginning.html/english.html",
      "/jesus/english",
      "/jesus.html/the-beginning.html/english.html",
      "/jesus.html/chinese-mandarin.html",
      "/foo",
      "/foo/",
      "/chinese-mandarin",
    ]
    for (const raw of inputs) {
      const result = canonical({ rawPathname: raw })
      expect(result.kind).toBe("redirect")
      if (result.kind !== "redirect") continue
      expect([result.status, result.cache]).toEqual(
        result.status === 308 ? [308, "long"] : [307, "short"],
      )
    }
  })
})

describe("canonical (no-op) cases — production §5.2/§5.3 shapes", () => {
  const canonicalUrls = [
    "/jesus.html/english.html",
    "/jesus.html/spanish-castilian.html",
    "/lumo-the-gospel-of-john.html/english.html",
    "/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
    "/jesus.html/the-beginning/english.html",
    "/jesus.html/the-beginning/russian.html",
    "/russian.html",
    "/portuguese-brazil.html",
    "/languages",
    "/french.html/languages",
    "/spanish-latin-american.html/history",
    "/spanish-latin-american.html/videos",
  ]

  for (const url of canonicalUrls) {
    it(`leaves ${url} unchanged`, () => {
      expect(canonical({ rawPathname: url })).toEqual({ kind: "canonical" })
    })
  }
})

describe("idempotence: canonicalize(canonicalize(x).pathname) === canonical", () => {
  const adversarialInputs = [
    "/jesus.html/english.html",
    "/jesus.html/",
    "/jesus.HTML/english.html",
    "/jesus.html/english",
    "/Jesus.HTML/",
    "/foo",
    "/foo/bar",
    "/jesus.html/chinese-mandarin.html",
    "/lumo-the-gospel-of-john/wedding-in-cana.html/english.html",
    "/jesus/the-beginning/english",
    "/lumo.html/cana/chinese-mandarin.html",
    "/history/",
    "/videos/",
    "/chinese-mandarin",
  ]

  for (const input of adversarialInputs) {
    it(`is fixed point: ${input}`, () => {
      const first = canonical({ rawPathname: input })
      if (first.kind === "canonical") return
      const second = canonical({ rawPathname: first.pathname })
      expect(second).toEqual({ kind: "canonical" })
    })
  }
})
