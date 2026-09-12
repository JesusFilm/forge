import { describe, expect, it } from "vitest"

import {
  type ParsedWatchPath,
  WATCH_BASE_PATH,
  WATCH_CANONICAL_ORIGIN,
  asContentSlug,
  asLocaleSlug,
  parseWatchPath,
  watchVideoPath,
} from "./routes"
import {
  WATCH_ANALYTICS_CAMPAIGN_PARAMS,
  WATCH_ANALYTICS_MAX_VALUE_LENGTH,
  WATCH_ANALYTICS_UNKNOWN_PATH,
  type WatchAnalyticsRouteType,
  isWatchAnalyticsSafeValue,
  resolveWatchAnalyticsRoute,
  sanitizeWatchAnalyticsCampaign,
  sanitizeWatchAnalyticsReferrer,
} from "./watch-analytics-route"

const jesus = "/watch/jesus.html"
const jesusExplicitEnglish = "/watch/jesus.html/english.html"
const jesusUrdu = "/watch/jesus.html/urdu.html"
const lumoEpisode = "/watch/lumo-the-gospel-of-john.html/wedding-in-cana.html"
const lumoEpisodeUrdu =
  "/watch/lumo-the-gospel-of-john.html/wedding-in-cana/urdu.html"

describe("resolveWatchAnalyticsRoute — standalone video identity", () => {
  it("gives language-less and explicit-English JESUS one canonical path (AE1, R2)", () => {
    const canonical = resolveWatchAnalyticsRoute({ pathname: jesus })
    const compatibility = resolveWatchAnalyticsRoute({
      pathname: jesusExplicitEnglish,
    })

    expect(canonical.canonicalPath).toBe("/watch/jesus.html")
    expect(compatibility.canonicalPath).toBe("/watch/jesus.html")
    expect(canonical.routeType).toBe("video")
    expect(compatibility.routeType).toBe("video")
  })

  it("distinguishes the two entry forms by route variant and raw path (AE1, R2)", () => {
    expect(resolveWatchAnalyticsRoute({ pathname: jesus })).toMatchObject({
      routeVariant: "canonical",
      rawPath: "/watch/jesus.html",
      languageClass: "english",
      contentSlug: "jesus",
      languageSlug: "english",
    })
    expect(
      resolveWatchAnalyticsRoute({ pathname: jesusExplicitEnglish }),
    ).toMatchObject({
      routeVariant: "explicit_language_compatibility",
      rawPath: "/watch/jesus.html/english.html",
      languageClass: "english",
      contentSlug: "jesus",
      languageSlug: "english",
    })
  })

  it("keeps non-English standalone URLs explicit and canonical (AE2, R3)", () => {
    expect(resolveWatchAnalyticsRoute({ pathname: jesusUrdu })).toMatchObject({
      routeType: "video",
      routeVariant: "canonical",
      canonicalPath: "/watch/jesus.html/urdu.html",
      rawPath: "/watch/jesus.html/urdu.html",
      languageClass: "non_english",
      languageSlug: "urdu",
    })
  })

  it("resolves legacy language aliases through the shared URL policy (R3)", () => {
    // `chinese-mandarin` lives in LANGUAGE_SLUG_ALIASES, not in an
    // analytics-only table.
    expect(
      resolveWatchAnalyticsRoute({
        pathname: "/watch/jesus.html/chinese-mandarin.html",
      }),
    ).toMatchObject({
      canonicalPath: "/watch/jesus.html/mandarin-china.html",
      routeVariant: "language_alias_compatibility",
      languageSlug: "mandarin-china",
      languageClass: "non_english",
    })
  })

  it("keeps a content slug that collides with a language home explicit", () => {
    // `english` owns `/english.html` as a language home, so the explicit form
    // IS the canonical video path for that content slug.
    expect(
      resolveWatchAnalyticsRoute({ pathname: "/watch/english.html/urdu.html" }),
    ).toMatchObject({
      routeType: "video",
      routeVariant: "canonical",
      canonicalPath: "/watch/english.html/urdu.html",
    })
  })

  it("does not mistake a keyword SUBSTRING inside an ordinary slug for a credential", () => {
    for (const slug of ["monkey", "authority", "secretary-of-state"]) {
      const resolved = resolveWatchAnalyticsRoute({
        pathname: `/watch/${slug}.html`,
      })
      expect([slug, resolved.routeType]).toEqual([slug, "video"])
    }
  })

  it("keeps analytics identity for an authored slug containing a credential word", () => {
    // A film legitimately titled "The Secret Place" must stay measurable. The
    // credential-WORD heuristic guards arbitrary user input (campaign values,
    // unrecognized paths), not authored editorial slugs that already passed
    // parseWatchPath and tryAsContentSlug — collapsing those to `unknown`
    // would silently erase a real video's traffic, which is the measurement
    // gap this contract exists to close. High-entropy shapes stay rejected
    // everywhere (see the raw-path sentinel suite).
    for (const slug of ["the-secret-place", "token-of-love"]) {
      const resolved = resolveWatchAnalyticsRoute({
        pathname: `/watch/${slug}.html`,
      })
      expect([slug, resolved.routeType]).toEqual([slug, "video"])
      expect(resolved.canonicalPath).toBe(`/watch/${slug}.html`)
      expect(resolved.rawPath).toBe(`/watch/${slug}.html`)
      expect(resolved.contentSlug).toBe(slug)
    }
  })

  it("still refuses a credential word supplied as a campaign value", () => {
    // Same words, arbitrary-input surface: the full value policy applies.
    const resolved = resolveWatchAnalyticsRoute({
      pathname: "/watch/jesus.html",
      search: "?utm_source=secret&utm_campaign=spring",
    })
    expect(resolved.campaign).toEqual({ utm_campaign: "spring" })
    expect(resolved.canonicalLocation).not.toContain("secret")
  })
})

describe("resolveWatchAnalyticsRoute — contextual episodes", () => {
  it("projects an eligible English episode onto standalone identity (AE3, R4)", () => {
    expect(resolveWatchAnalyticsRoute({ pathname: lumoEpisode })).toMatchObject(
      {
        routeType: "video",
        routeVariant: "contextual",
        canonicalPath: "/watch/wedding-in-cana.html",
        rawPath: lumoEpisode,
        contentSlug: "wedding-in-cana",
        seriesSlug: "lumo-the-gospel-of-john",
        languageClass: "english",
      },
    )
  })

  it("projects an explicit non-English episode onto standalone identity (R4)", () => {
    expect(
      resolveWatchAnalyticsRoute({ pathname: lumoEpisodeUrdu }),
    ).toMatchObject({
      routeType: "video",
      routeVariant: "contextual",
      canonicalPath: "/watch/wedding-in-cana.html/urdu.html",
      rawPath: lumoEpisodeUrdu,
      contentSlug: "wedding-in-cana",
      seriesSlug: "lumo-the-gospel-of-john",
      languageClass: "non_english",
    })
  })

  it("rejects the non-canonical `.html` middle segment instead of guessing (R5)", () => {
    expect(
      resolveWatchAnalyticsRoute({
        pathname:
          "/watch/lumo-the-gospel-of-john.html/wedding-in-cana.html/urdu.html",
      }),
    ).toMatchObject({
      routeType: "unknown",
      canonicalPath: WATCH_ANALYTICS_UNKNOWN_PATH,
    })
  })
})

describe("resolveWatchAnalyticsRoute — non-content routes", () => {
  it("classifies language homes, inventory, history, and utility routes (R5)", () => {
    expect(resolveWatchAnalyticsRoute({ pathname: "/watch" })).toMatchObject({
      routeType: "home",
      routeVariant: "canonical",
      canonicalPath: "/watch",
      languageClass: "none",
    })
    expect(
      resolveWatchAnalyticsRoute({ pathname: "/watch/russian.html" }),
    ).toMatchObject({
      routeType: "language_home",
      routeVariant: "canonical",
      canonicalPath: "/watch/russian.html",
      languageClass: "non_english",
      languageSlug: "russian",
    })
    expect(
      resolveWatchAnalyticsRoute({ pathname: "/watch/english.html" }),
    ).toMatchObject({
      routeType: "language_home",
      languageClass: "english",
    })
    expect(
      resolveWatchAnalyticsRoute({ pathname: "/watch/russian.html/videos" }),
    ).toMatchObject({
      routeType: "language_inventory",
      canonicalPath: "/watch/russian.html/videos",
    })
    expect(
      resolveWatchAnalyticsRoute({ pathname: "/watch/russian.html/history" }),
    ).toMatchObject({
      routeType: "history",
      canonicalPath: "/watch/russian.html/history",
    })
    expect(
      resolveWatchAnalyticsRoute({ pathname: "/watch/history" }),
    ).toMatchObject({
      routeType: "history",
      canonicalPath: "/watch/history",
      languageClass: "none",
    })
    expect(
      resolveWatchAnalyticsRoute({ pathname: "/watch/whats-new" }),
    ).toMatchObject({
      routeType: "whats_new",
      canonicalPath: "/watch/whats-new",
    })
    expect(
      resolveWatchAnalyticsRoute({ pathname: "/watch/languages" }),
    ).toMatchObject({
      routeType: "languages",
      canonicalPath: "/watch/languages",
      routeVariant: "canonical",
    })
    expect(
      resolveWatchAnalyticsRoute({ pathname: "/watch/search" }),
    ).toMatchObject({ routeType: "search", canonicalPath: "/watch/search" })
  })

  it("reports the legacy `/videos` index as non-canonical without renaming the route (R17)", () => {
    expect(
      resolveWatchAnalyticsRoute({ pathname: "/watch/videos" }),
    ).toMatchObject({
      routeType: "languages",
      canonicalPath: "/watch/languages",
      routeVariant: "non_canonical",
    })
  })

  it("resolves a localized-utility language alias through URL policy (R3)", () => {
    expect(
      resolveWatchAnalyticsRoute({
        pathname: "/watch/chinese-mandarin.html/history",
      }),
    ).toMatchObject({
      routeType: "history",
      canonicalPath: "/watch/mandarin-china.html/history",
      routeVariant: "language_alias_compatibility",
    })
  })

  it("collapses reserved subtrees to their prefix and drops the rest (R19)", () => {
    const preview = resolveWatchAnalyticsRoute({
      pathname: "/watch/preview/experience/prv_capability_token_value",
    })
    expect(preview).toMatchObject({
      routeType: "preview",
      routeVariant: "not_applicable",
      canonicalPath: "/watch/preview",
    })
    expect(preview.rawPath).toBeUndefined()
    expect(preview.canonicalLocation).not.toContain("capability")

    const reserved = resolveWatchAnalyticsRoute({
      pathname: "/watch/_next/static/chunks/main-9f2b1c.js",
    })
    expect(reserved).toMatchObject({
      routeType: "reserved",
      canonicalPath: "/watch/_next",
    })
    expect(reserved.rawPath).toBeUndefined()
  })
})

describe("resolveWatchAnalyticsRoute — unknown and invalid paths", () => {
  it.each([
    ["four or more segments", "/watch/a/b/c/d"],
    ["a bare one-segment path", "/watch/jesus"],
    ["an uppercase language segment", "/watch/jesus.html/ENGLISH.html"],
    ["a percent-encoded segment", "/watch/jesus%0a.html"],
    ["a traversal attempt", "/watch/../../etc/passwd"],
    ["a protocol-relative path", "//evil.example.com"],
  ])("resolves %s to the fixed unknown path (R5)", (_label, pathname) => {
    const resolved = resolveWatchAnalyticsRoute({ pathname })
    expect(resolved.routeType).toBe("unknown")
    expect(resolved.routeVariant).toBe("not_applicable")
    expect(resolved.languageClass).toBe("none")
    expect(resolved.canonicalPath).toBe(WATCH_ANALYTICS_UNKNOWN_PATH)
    expect(resolved.canonicalLocation).toBe(
      `${WATCH_CANONICAL_ORIGIN}${WATCH_ANALYTICS_UNKNOWN_PATH}`,
    )
    expect(resolved.rawPath).toBeUndefined()
    expect(resolved.contentSlug).toBeUndefined()
  })

  it("still emits exactly one identity per unknown path so page views can dedupe (R5, R6)", () => {
    const first = resolveWatchAnalyticsRoute({ pathname: "/watch/a/b/c/d" })
    const second = resolveWatchAnalyticsRoute({ pathname: "/watch/a/b/c/e" })
    expect(first.canonicalPath).toBe(second.canonicalPath)
    expect(first.pageViewKey).not.toBe(second.pageViewKey)
  })
})

describe("resolveWatchAnalyticsRoute — privacy bounding of the raw path", () => {
  const sentinels = [
    ["email-like", "person@example.com"],
    ["credential-like", "api-key-live-value"],
    ["secret-worded", "secret"],
    ["jwt-like", "eyJhbGciOiJIUzI1NiJ9"],
    ["long-hex", "deadbeefdeadbeefdeadbeef01"],
  ] as const

  // On a RECOGNIZED route the segments are authored slugs, so only the
  // high-entropy shapes — which no authored title can produce — collapse the
  // identity. The credential-word entries are covered by the campaign-value
  // and unknown-route cases instead.
  const structuralSentinels = sentinels.filter(([label]) =>
    ["email-like", "jwt-like", "long-hex"].includes(label),
  )

  it.each(structuralSentinels)(
    "omits watch_raw_path when a %s sentinel sits in a recognized-looking route (R19)",
    (_label, sentinel) => {
      const resolved = resolveWatchAnalyticsRoute({
        pathname: `/watch/${sentinel}.html/english.html`,
      })
      expect(resolved.rawPath).toBeUndefined()
      expect(resolved.routeType).toBe("unknown")
      expect(resolved.canonicalPath).toBe(WATCH_ANALYTICS_UNKNOWN_PATH)
      expect(resolved.canonicalLocation).not.toContain(sentinel)
    },
  )

  it.each(sentinels)(
    "omits watch_raw_path when a %s sentinel sits in an unknown route (R19)",
    (_label, sentinel) => {
      const resolved = resolveWatchAnalyticsRoute({
        pathname: `/watch/a/b/c/${sentinel}`,
      })
      expect(resolved.routeType).toBe("unknown")
      expect(resolved.rawPath).toBeUndefined()
      expect(resolved.canonicalPath).toBe(WATCH_ANALYTICS_UNKNOWN_PATH)
    },
  )

  it("omits an over-long raw path while keeping the canonical identity (R19, R21)", () => {
    // Every segment is individually safe; only the assembled path exceeds the
    // bound, so the canonical standalone identity survives and only the
    // diagnostic field drops.
    const series = "z".repeat(45)
    const episode = "y".repeat(45)
    const resolved = resolveWatchAnalyticsRoute({
      pathname: `/watch/${series}.html/${episode}/urdu.html`,
    })
    expect(resolved.routeType).toBe("video")
    expect(resolved.routeVariant).toBe("contextual")
    expect(resolved.canonicalPath).toBe(`/watch/${episode}.html/urdu.html`)
    expect(resolved.rawPath).toBeUndefined()
  })

  it("resolves a slug longer than the value bound to unknown (R5, R21)", () => {
    const overBound = "z".repeat(WATCH_ANALYTICS_MAX_VALUE_LENGTH + 1)
    expect(
      resolveWatchAnalyticsRoute({ pathname: `/watch/${overBound}.html` }),
    ).toMatchObject({
      routeType: "unknown",
      canonicalPath: WATCH_ANALYTICS_UNKNOWN_PATH,
    })

    // At the bound the content identity survives; only the assembled raw path
    // (slug + `/watch/` + `.html`) exceeds it and drops.
    const atBound = "z".repeat(WATCH_ANALYTICS_MAX_VALUE_LENGTH)
    const bounded = resolveWatchAnalyticsRoute({
      pathname: `/watch/${atBound}.html`,
    })
    expect(bounded.routeType).toBe("video")
    expect(bounded.contentSlug).toBe(atBound)
    expect(bounded.rawPath).toBeUndefined()
  })

  it("keeps every retained raw path inside the GA value bound (R21)", () => {
    for (const pathname of [
      jesus,
      jesusExplicitEnglish,
      jesusUrdu,
      lumoEpisode,
      lumoEpisodeUrdu,
      "/watch/russian.html/videos",
    ]) {
      const { rawPath } = resolveWatchAnalyticsRoute({ pathname })
      expect(rawPath).toBeDefined()
      expect(rawPath!.length).toBeLessThanOrEqual(
        WATCH_ANALYTICS_MAX_VALUE_LENGTH,
      )
    }
  })
})

describe("resolveWatchAnalyticsRoute — basePath handling", () => {
  it("strips the basePath exactly once and restores it exactly once", () => {
    const resolved = resolveWatchAnalyticsRoute({ pathname: jesus })
    expect(resolved.canonicalPath).toBe("/watch/jesus.html")
    expect(resolved.canonicalPath.startsWith(`${WATCH_BASE_PATH}/watch`)).toBe(
      false,
    )
    expect(resolved.rawPath).toBe("/watch/jesus.html")
  })

  it("treats basePath-free inputs identically", () => {
    expect(resolveWatchAnalyticsRoute({ pathname: "/jesus.html" })).toEqual(
      resolveWatchAnalyticsRoute({ pathname: jesus }),
    )
    expect(resolveWatchAnalyticsRoute({ pathname: "/" })).toEqual(
      resolveWatchAnalyticsRoute({ pathname: "/watch" }),
    )
  })

  it("normalizes a trailing slash without changing identity", () => {
    expect(resolveWatchAnalyticsRoute({ pathname: `${jesus}/` })).toEqual(
      resolveWatchAnalyticsRoute({ pathname: jesus }),
    )
  })

  it("ignores a query string or fragment attached to the pathname", () => {
    expect(
      resolveWatchAnalyticsRoute({ pathname: `${jesus}?t=30#chapter` }),
    ).toMatchObject({
      canonicalPath: "/watch/jesus.html",
      rawPath: "/watch/jesus.html",
    })
  })
})

describe("resolveWatchAnalyticsRoute — query parameters and page identity", () => {
  const identity = resolveWatchAnalyticsRoute({ pathname: jesus })

  it.each([
    ["timestamp", "t=125"],
    ["autoplay", "autoplay=1"],
    ["subtitles", "subtitles=french"],
    ["locale-resolved", "_lr=1"],
    ["repeated one-shot", "t=1&t=2&autoplay=1"],
    ["arbitrary", "foo=bar&ref=partner&gclid=abc123"],
  ])("keeps %s parameters out of page identity (R7)", (_label, search) => {
    const resolved = resolveWatchAnalyticsRoute({ pathname: jesus, search })
    expect(resolved.canonicalPath).toBe(identity.canonicalPath)
    expect(resolved.canonicalLocation).toBe(identity.canonicalLocation)
    expect(resolved.pageViewKey).toBe(identity.pageViewKey)
    expect(resolved.campaign).toEqual({})
  })

  it("accepts a leading `?` and a URLSearchParams alike", () => {
    const fromString = resolveWatchAnalyticsRoute({
      pathname: jesus,
      search: "?utm_source=newsletter",
    })
    const fromParams = resolveWatchAnalyticsRoute({
      pathname: jesus,
      search: new URLSearchParams({ utm_source: "newsletter" }),
    })
    expect(fromString).toEqual(fromParams)
    expect(fromString.campaign).toEqual({ utm_source: "newsletter" })
  })

  it("puts only the canonical origin, canonical path, and campaign set in page_location (R7)", () => {
    const resolved = resolveWatchAnalyticsRoute({
      pathname: jesusExplicitEnglish,
      search: "utm_medium=email&utm_source=newsletter&t=90",
    })
    expect(resolved.canonicalLocation).toBe(
      `${WATCH_CANONICAL_ORIGIN}/watch/jesus.html?utm_medium=email&utm_source=newsletter`,
    )
    expect(resolved.canonicalLocation).not.toContain("t=90")
  })

  it("orders campaign parameters deterministically regardless of input order", () => {
    const a = resolveWatchAnalyticsRoute({
      pathname: jesus,
      search: "utm_source=a&utm_medium=b",
    })
    const b = resolveWatchAnalyticsRoute({
      pathname: jesus,
      search: "utm_medium=b&utm_source=a",
    })
    expect(a.canonicalLocation).toBe(b.canonicalLocation)
    expect(a.pageViewKey).toBe(b.pageViewKey)
  })
})

describe("sanitizeWatchAnalyticsCampaign", () => {
  it("keeps allowlisted, bounded, safe values (R7)", () => {
    expect(
      sanitizeWatchAnalyticsCampaign(
        "utm_source=newsletter&utm_medium=email&utm_campaign=easter-2026&utm_content=hero_a&utm_term=jesus+film&utm_id=1234",
      ),
    ).toEqual({
      utm_source: "newsletter",
      utm_medium: "email",
      utm_campaign: "easter-2026",
      utm_content: "hero_a",
      utm_term: "jesus film",
      utm_id: "1234",
    })
  })

  it.each([
    ["an unknown key", "ref=partner", "ref"],
    ["a click identifier", "gclid=EAIaIQobChMI", "gclid"],
    ["another click identifier", "fbclid=IwAR0abc", "fbclid"],
  ])("drops %s entirely (R7, R19)", (_label, search, key) => {
    expect(sanitizeWatchAnalyticsCampaign(search)).not.toHaveProperty(key)
  })

  it.each([
    ["email-like", "utm_source=person@example.com"],
    ["credential-shaped", "utm_content=api_key-9f2b"],
    ["token-shaped", "utm_term=eyJhbGciOiJIUzI1NiJ9"],
    ["opaque-hex", "utm_id=deadbeefdeadbeefdeadbeef01"],
    ["encoded-control", "utm_source=%0Aevil"],
    ["empty", "utm_source="],
  ])("drops a %s value (R19)", (_label, search) => {
    expect(sanitizeWatchAnalyticsCampaign(search)).toEqual({})
  })

  it("drops an over-long value rather than truncating it (R7)", () => {
    const tooLong = "z".repeat(WATCH_ANALYTICS_MAX_VALUE_LENGTH + 1)
    expect(sanitizeWatchAnalyticsCampaign(`utm_campaign=${tooLong}`)).toEqual(
      {},
    )
    expect(
      sanitizeWatchAnalyticsCampaign(
        `utm_campaign=${"z".repeat(WATCH_ANALYTICS_MAX_VALUE_LENGTH)}`,
      ).utm_campaign,
    ).toHaveLength(WATCH_ANALYTICS_MAX_VALUE_LENGTH)
  })

  it("keeps the first value of a repeated parameter", () => {
    expect(
      sanitizeWatchAnalyticsCampaign("utm_source=first&utm_source=second"),
    ).toEqual({ utm_source: "first" })
  })

  it("returns an empty set for absent, empty, or malformed input", () => {
    expect(sanitizeWatchAnalyticsCampaign(undefined)).toEqual({})
    expect(sanitizeWatchAnalyticsCampaign(null)).toEqual({})
    expect(sanitizeWatchAnalyticsCampaign("")).toEqual({})
    expect(sanitizeWatchAnalyticsCampaign("?&&=&")).toEqual({})
  })

  it("allowlists campaign keys only from the exported contract", () => {
    expect([...WATCH_ANALYTICS_CAMPAIGN_PARAMS]).toEqual([
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "utm_id",
    ])
  })
})

describe("resolveWatchAnalyticsRoute — entry intent", () => {
  it.each([
    ["direct", "", "direct"],
    ["timestamp deep link", "t=125", "deep_link_timestamp"],
    ["autoplay", "autoplay=1", "autoplay"],
    ["subtitle intent", "subtitles=french", "subtitle_intent"],
    ["locale-resolved redirect", "_lr=1", "locale_resolved"],
    ["campaign", "utm_source=newsletter", "campaign"],
    ["dropped campaign value", "utm_source=person@example.com", "direct"],
  ])("classifies %s", (_label, search, expected) => {
    expect(
      resolveWatchAnalyticsRoute({ pathname: jesus, search }).entryIntent,
    ).toBe(expected)
  })

  it("prefers the locale-resolved redirect over every other signal", () => {
    expect(
      resolveWatchAnalyticsRoute({
        pathname: jesus,
        search: "_lr=1&utm_source=newsletter&t=30&autoplay=1&subtitles=french",
      }).entryIntent,
    ).toBe("locale_resolved")
  })

  it("prefers campaign attribution over one-shot playback intents", () => {
    expect(
      resolveWatchAnalyticsRoute({
        pathname: jesus,
        search: "utm_source=newsletter&t=30&autoplay=1",
      }).entryIntent,
    ).toBe("campaign")
  })

  it("classifies every one-shot parameter the route builders emit", () => {
    // Drift pin: `t` and `autoplay` are private to ./routes, so read them back
    // out of a builder result instead of trusting a copied literal.
    const built = watchVideoPath(asContentSlug("jesus"), asLocaleSlug("urdu"), {
      t: 30,
      autoplay: true,
      reason: "locale-resolved",
      subtitleLanguage: asLocaleSlug("french"),
    })
    const emitted = [...new URLSearchParams(built.split("?")[1]).keys()]
    expect(emitted.length).toBeGreaterThanOrEqual(4)
    for (const key of emitted) {
      expect([
        key,
        resolveWatchAnalyticsRoute({ pathname: jesus, search: `${key}=1` })
          .entryIntent,
      ]).not.toEqual([key, "direct"])
    }
  })
})

describe("resolveWatchAnalyticsRoute — ParsedWatchPath coverage", () => {
  const fixtures: ReadonlyArray<{
    kind: ParsedWatchPath["kind"]
    pathname: string
    routeType: WatchAnalyticsRouteType
  }> = [
    { kind: "home", pathname: "/watch", routeType: "home" },
    {
      kind: "localized-home",
      pathname: "/watch/russian.html",
      routeType: "language_home",
    },
    // Same parse kind, different analytics family: one-segment content.
    { kind: "localized-home", pathname: jesus, routeType: "video" },
    { kind: "video", pathname: jesusUrdu, routeType: "video" },
    { kind: "episode", pathname: lumoEpisode, routeType: "video" },
    { kind: "episode", pathname: lumoEpisodeUrdu, routeType: "video" },
    { kind: "languages", pathname: "/watch/languages", routeType: "languages" },
    {
      kind: "localized-languages",
      pathname: "/watch/russian.html/languages",
      routeType: "languages",
    },
    { kind: "whats-new", pathname: "/watch/whats-new", routeType: "whats_new" },
    { kind: "history", pathname: "/watch/history", routeType: "history" },
    {
      kind: "localized-history",
      pathname: "/watch/russian.html/history",
      routeType: "history",
    },
    {
      kind: "language-videos",
      pathname: "/watch/russian.html/videos",
      routeType: "language_inventory",
    },
    { kind: "search", pathname: "/watch/search", routeType: "search" },
    { kind: "reserved", pathname: "/watch/api/health", routeType: "reserved" },
    { kind: "unknown", pathname: "/watch/a/b/c/d", routeType: "unknown" },
  ]

  it.each(fixtures)(
    "projects $kind ($pathname) to $routeType",
    ({ kind, pathname, routeType }) => {
      const relative = pathname.startsWith(WATCH_BASE_PATH)
        ? pathname.slice(WATCH_BASE_PATH.length) || "/"
        : pathname
      expect(parseWatchPath(relative).kind).toBe(kind)
      expect(resolveWatchAnalyticsRoute({ pathname }).routeType).toBe(routeType)
    },
  )

  it("covers every ParsedWatchPath kind", () => {
    const allKinds: ReadonlyArray<ParsedWatchPath["kind"]> = [
      "home",
      "localized-home",
      "video",
      "episode",
      "languages",
      "localized-languages",
      "whats-new",
      "history",
      "localized-history",
      "language-videos",
      "search",
      "reserved",
      "unknown",
    ]
    const covered = new Set(fixtures.map((fixture) => fixture.kind))
    expect([...allKinds].filter((kind) => !covered.has(kind))).toEqual([])
  })

  it("never throws and never leaks a raw path for adversarial input", () => {
    for (const pathname of [
      "",
      "/",
      "//",
      "/watch//jesus.html",
      "/watch/%2e%2e/%2e%2e/etc/passwd",
      `/watch/${"a/".repeat(500)}b`,
      "/watch/\\evil",
      "/watch/jesus.html/english.html/extra/extra",
    ]) {
      const resolved = resolveWatchAnalyticsRoute({ pathname })
      expect(resolved.canonicalPath.startsWith(WATCH_BASE_PATH)).toBe(true)
      expect(resolved.canonicalPath).not.toContain("..")
      if (resolved.rawPath != null) {
        expect(resolved.rawPath.startsWith(`${WATCH_BASE_PATH}`)).toBe(true)
        expect(resolved.rawPath.length).toBeLessThanOrEqual(
          WATCH_ANALYTICS_MAX_VALUE_LENGTH,
        )
        for (const segment of resolved.rawPath.split("/").filter(Boolean)) {
          expect([segment, isWatchAnalyticsSafeValue(segment)]).toEqual([
            segment,
            true,
          ])
        }
      }
    }
  })
})

describe("isWatchAnalyticsSafeValue", () => {
  it.each([
    "jesus",
    "wedding-in-cana",
    "soccer_event_collection",
    "easter-2026",
    "hero_a",
  ])("accepts the bounded slug-shaped value %s", (value) => {
    expect(isWatchAnalyticsSafeValue(value)).toBe(true)
  })

  it.each([
    ["empty", ""],
    ["over-long", "a".repeat(WATCH_ANALYTICS_MAX_VALUE_LENGTH + 1)],
    ["newline", "value\nsecond"],
    ["angle bracket", "<script>"],
    ["email", "person@example.com"],
    ["credential word", "my-password-1"],
    ["api key", "apikey1234"],
    ["jwt", "eyJhbGciOiJIUzI1NiJ9x"],
    ["opaque hex", "0123456789abcdef01234567"],
  ])("rejects a %s value", (_label, value) => {
    expect(isWatchAnalyticsSafeValue(value)).toBe(false)
  })
})

describe("sanitizeWatchAnalyticsReferrer", () => {
  it("keeps origin plus the query-free path for a same-origin referrer (R7)", () => {
    expect(
      sanitizeWatchAnalyticsReferrer(
        `${WATCH_CANONICAL_ORIGIN}/watch/jesus.html?utm_source=x#chapter-2`,
      ),
    ).toBe(`${WATCH_CANONICAL_ORIGIN}/watch/jesus.html`)
    expect(sanitizeWatchAnalyticsReferrer(`${WATCH_CANONICAL_ORIGIN}/`)).toBe(
      `${WATCH_CANONICAL_ORIGIN}/`,
    )
  })

  it("keeps only the origin of a cross-origin referrer (R19)", () => {
    expect(
      sanitizeWatchAnalyticsReferrer(
        "https://www.google.com/search?q=person%40example.com",
      ),
    ).toBe("https://www.google.com")
  })

  it.each([
    ["absent", undefined],
    ["null", null],
    ["empty", ""],
    ["non-http scheme", "javascript:alert(1)"],
    ["data URL", "data:text/html,<b>x</b>"],
    ["unparsable", "not a url"],
    ["credentialed", "https://user:pass@example.com/"],
    ["over-long", `https://example.com/${"a".repeat(600)}`],
  ])("suppresses a %s referrer (R7, R19)", (_label, referrer) => {
    expect(sanitizeWatchAnalyticsReferrer(referrer)).toBeUndefined()
  })

  it("suppresses a same-origin referrer whose path fails the value policy (R19)", () => {
    expect(
      sanitizeWatchAnalyticsReferrer(
        `${WATCH_CANONICAL_ORIGIN}/watch/eyJhbGciOiJIUzI1NiJ9.html`,
      ),
    ).toBeUndefined()
  })
})
