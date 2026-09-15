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

describe("Rule 2: lowercase .HTML → .html → 307", () => {
  it("lowercases uppercase suffix", () => {
    expect(canonical({ rawPathname: "/jesus.HTML/english.html" })).toEqual({
      kind: "redirect",
      pathname: "/jesus.html/english.html",
      status: 307,
      cache: "short",
    })
  })

  it("lowercases both segments", () => {
    expect(canonical({ rawPathname: "/jesus.HTML/english.HTML" })).toEqual({
      kind: "redirect",
      pathname: "/jesus.html/english.html",
      status: 307,
      cache: "short",
    })
  })
})

describe("Rule 3: legacy 4-segment-shape episode rewrite → 307", () => {
  it("rewrites /series/ep.html/lang.html → /series.html/ep/lang.html", () => {
    expect(
      canonical({
        rawPathname:
          "/lumo-the-gospel-of-john/wedding-in-cana.html/english.html",
      }),
    ).toEqual({
      kind: "redirect",
      pathname: "/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
      status: 307,
      cache: "short",
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
      status: 307,
      cache: "short",
    })
  })
})

describe("Rule 4: per-segment .html append → 307", () => {
  it("appends .html on 2-segment missing both", () => {
    expect(canonical({ rawPathname: "/foo/bar" })).toEqual({
      kind: "redirect",
      pathname: "/foo.html/bar.html",
      status: 307,
      cache: "short",
    })
  })

  it("appends .html on 2-segment missing only locale", () => {
    expect(canonical({ rawPathname: "/jesus.html/english" })).toEqual({
      kind: "redirect",
      pathname: "/jesus.html/english.html",
      status: 307,
      cache: "short",
    })
  })

  it("keeps localized /videos indexes .html-free on the final segment", () => {
    expect(
      canonical({ rawPathname: "/spanish-latin-american/videos" }),
    ).toEqual({
      kind: "redirect",
      pathname: "/spanish-latin-american.html/videos",
      status: 307,
      cache: "short",
    })
    expect(
      canonical({ rawPathname: "/spanish-latin-american.html/videos.html" }),
    ).toEqual({
      kind: "redirect",
      pathname: "/spanish-latin-american.html/videos",
      status: 307,
      cache: "short",
    })
  })

  it("appends .html on 3-segment missing first + last (episode stays bare)", () => {
    expect(canonical({ rawPathname: "/jesus/the-beginning/english" })).toEqual({
      kind: "redirect",
      pathname: "/jesus.html/the-beginning/english.html",
      status: 307,
      cache: "short",
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

  it("redirects legacy /videos to /languages", () => {
    expect(canonical({ rawPathname: "/videos" })).toEqual({
      kind: "redirect",
      pathname: "/languages",
      status: 307,
      cache: "short",
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

describe("Rule 4.5: 3-segment episode-bare contract → 307", () => {
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
      status: 307,
      cache: "short",
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
      status: 307,
      cache: "short",
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

describe("Rule 6: language-slug alias → 307", () => {
  it("rewrites chinese-mandarin → mandarin-china in locale segment", () => {
    expect(
      canonical({ rawPathname: "/jesus.html/chinese-mandarin.html" }),
    ).toEqual({
      kind: "redirect",
      pathname: "/jesus.html/mandarin-china.html",
      status: 307,
      cache: "short",
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
      status: 307,
      cache: "short",
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
        status: 307,
        cache: "short",
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

describe("rule composition: any non-trailing-slash transform → 307", () => {
  // Per docs/research/jesusfilm-watch-url-patterns.md §3: production is
  // case-sensitive on the slug content but case-insensitive on the .html
  // suffix only. We mirror that — uppercase slugs are NOT lowercased.

  it("/Jesus.HTML/ composes slash-strip + suffix-lowercase → 307", () => {
    expect(canonical({ rawPathname: "/Jesus.HTML/" })).toEqual({
      kind: "redirect",
      pathname: "/Jesus.html",
      status: 307,
      cache: "short",
    })
  })

  it("/Jesus.HTML/English composes lowercase + append (slug case preserved)", () => {
    expect(canonical({ rawPathname: "/Jesus.HTML/English" })).toEqual({
      kind: "redirect",
      pathname: "/Jesus.html/English.html",
      status: 307,
      cache: "short",
    })
  })

  it("/Jesus.HTML/english composes lowercase + append", () => {
    expect(canonical({ rawPathname: "/Jesus.HTML/english" })).toEqual({
      kind: "redirect",
      pathname: "/Jesus.html/english.html",
      status: 307,
      cache: "short",
    })
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
