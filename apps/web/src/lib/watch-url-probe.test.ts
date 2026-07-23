import { describe, expect, it, vi } from "vitest"

import {
  MAX_REDIRECT_HOPS,
  WATCH_URL_FIXTURES,
  WATCH_STRUCTURED_DATA_CONTRACTS,
  classifyProbe,
  parseJsonLdScripts,
  probeUrl,
  validateStructuredDataContract,
  type ProbeResult,
} from "./watch-url-probe"

const result = (over: Partial<ProbeResult> = {}): ProbeResult => ({
  status: 200,
  finalPath: "/watch/jesus.html/english.html",
  redirectHops: 0,
  ms: 1,
  ...over,
})

describe("classifyProbe", () => {
  it("match: 200 → 200 same final path", () => {
    const { outcome } = classifyProbe(result(), result())
    expect(outcome).toBe("match")
  })

  it("hard-regression: prod 200 → preview 404 (broken link)", () => {
    const { outcome, note } = classifyProbe(
      result({ status: 200 }),
      result({ status: 404 }),
    )
    expect(outcome).toBe("hard-regression")
    expect(note).toMatch(/BROKEN LINK/)
  })

  it("hard-regression: a representative home loses its required CollectionPage", () => {
    const { outcome, note } = classifyProbe(
      result({
        finalPath: "/watch",
        structuredData: {
          scriptCount: 1,
          types: ["CollectionPage"],
          parseErrors: [],
        },
      }),
      result({ finalPath: "/watch" }),
      { path: "/watch", expect: "ok" },
    )

    expect(outcome).toBe("hard-regression")
    expect(note).toContain("expected exactly 1 CollectionPage, found 0")
  })

  it("hard-regression: a playable sample emits duplicate VideoObjects", () => {
    const { outcome, note } = classifyProbe(
      result(),
      result({
        structuredData: {
          scriptCount: 2,
          types: ["VideoObject", "VideoObject"],
          parseErrors: [],
        },
      }),
      { path: "/watch/jesus.html/english.html", expect: "ok" },
    )

    expect(outcome).toBe("hard-regression")
    expect(note).toContain("expected exactly 1 VideoObject, found 2")
  })

  it("hard-regression: malformed JSON-LD remains a gate failure", () => {
    const { outcome, note } = classifyProbe(
      result(),
      result({
        structuredData: {
          scriptCount: 1,
          types: [],
          parseErrors: ["script 1: unexpected token"],
        },
      }),
    )

    expect(outcome).toBe("hard-regression")
    expect(note).toContain("MALFORMED JSON-LD")
  })

  it("soft-regression: 200 on both but different final path", () => {
    const { outcome } = classifyProbe(
      result({ finalPath: "/watch/jesus.html/english.html" }),
      result({ finalPath: "/watch/jesus.html/spanish.html" }),
    )
    expect(outcome).toBe("soft-regression")
  })

  it("acceptable: prod 307 → preview 200 direct (skipped redundant redirect)", () => {
    const { outcome } = classifyProbe(
      result({ status: 307, finalPath: "/watch/jesus.html/english.html" }),
      result({ status: 200, finalPath: "/watch/jesus.html/english.html" }),
    )
    expect(outcome).toBe("acceptable")
  })

  it("match: redirect → redirect, same final path", () => {
    const { outcome } = classifyProbe(
      result({ status: 308, finalPath: "/watch/jesus.html" }),
      result({ status: 308, finalPath: "/watch/jesus.html" }),
    )
    expect(outcome).toBe("match")
  })

  it("soft-regression: redirect target differs", () => {
    const { outcome } = classifyProbe(
      result({
        status: 307,
        finalPath: "/watch/jesus.html/mandarin-china.html",
      }),
      result({ status: 307, finalPath: "/watch/jesus.html/chinese.html" }),
    )
    expect(outcome).toBe("soft-regression")
  })

  it("hard-regression: redirect became error", () => {
    const { outcome } = classifyProbe(
      result({ status: 307 }),
      result({ status: 500 }),
    )
    expect(outcome).toBe("hard-regression")
  })

  it("match: expected 404 stays 404", () => {
    const { outcome } = classifyProbe(
      result({ status: 404 }),
      result({ status: 404 }),
    )
    expect(outcome).toBe("match")
  })

  it("hard-regression: expected 404 now resolves 200 (§5.6 contract break)", () => {
    const { outcome, note } = classifyProbe(
      result({ status: 404 }),
      result({ status: 200 }),
    )
    expect(outcome).toBe("hard-regression")
    expect(note).toMatch(/EXPECTED-404/)
  })

  it("hard-regression: expected 404 now 301 (§5.6: must not become 301)", () => {
    const { outcome } = classifyProbe(
      result({ status: 404 }),
      result({ status: 301 }),
    )
    expect(outcome).toBe("hard-regression")
  })

  it("hard-regression: preview hits a redirect loop on a valid content URL", () => {
    const { outcome, note } = classifyProbe(
      result({ status: 200 }),
      result({ status: 308, redirectHops: MAX_REDIRECT_HOPS }),
      { path: "/watch/jesus.html/english.html", expect: "ok" },
    )

    expect(outcome).toBe("hard-regression")
    expect(note).toMatch(/REDIRECT LOOP/)
  })

  it("error: transport error on either side", () => {
    expect(
      classifyProbe(result({ error: "ETIMEDOUT" }), result()).outcome,
    ).toBe("error")
    expect(
      classifyProbe(result(), result({ error: "ECONNREFUSED" })).outcome,
    ).toBe("error")
  })

  it("error: production 5xx cannot baseline", () => {
    const { outcome } = classifyProbe(
      result({ status: 503 }),
      result({ status: 200 }),
    )
    expect(outcome).toBe("error")
  })

  it("match: passthrough fixture accepts preview preserving the requested path", () => {
    const fixture = {
      path: "/watch/images/jesusfilm-sign.svg",
      expect: "passthrough" as const,
    }
    const productionLegacy = result({
      status: 404,
      finalPath: "/watch/images.html/jesusfilm-sign.html",
      redirectHops: 1,
    })
    const preview = result({
      status: 200,
      finalPath: "/watch/images/jesusfilm-sign.svg",
    })

    const { outcome, note } = classifyProbe(productionLegacy, preview, fixture)

    expect(outcome).toBe("match")
    expect(note).toMatch(/passthrough preview preserved/)
  })

  it("hard-regression: passthrough fixture fails when preview redirects", () => {
    const fixture = {
      path: "/watch/images/jesusfilm-sign.svg",
      expect: "passthrough" as const,
    }
    const broken = result({
      status: 200,
      finalPath: "/watch/images.html/jesusfilm-sign.svg.html",
      redirectHops: 1,
    })

    const { outcome, note } = classifyProbe(result(), broken, fixture)

    expect(outcome).toBe("hard-regression")
    expect(note).toMatch(/PASSTHROUGH CONTRACT BROKEN/)
    expect(note).toMatch(/preview redirected 1 hop/)
  })

  it("hard-regression: passthrough fixture fails when preview final path changes without a hop", () => {
    const fixture = {
      path: "/watch/images/jesusfilm-sign.svg",
      expect: "passthrough" as const,
    }

    const { outcome, note } = classifyProbe(
      result({ finalPath: "/watch/images/jesusfilm-sign.svg" }),
      result({ finalPath: "/watch/images.html/jesusfilm-sign.svg.html" }),
      fixture,
    )

    expect(outcome).toBe("hard-regression")
    expect(note).toMatch(/final path changed/)
  })

  it("acceptable: deprecated /watch/search may land on root modal surface", () => {
    const { outcome, note } = classifyProbe(
      result({
        status: 404,
        finalPath: "/watch/search.html/search.html",
        redirectHops: 1,
      }),
      result({ status: 200, finalPath: "/watch", redirectHops: 1 }),
      { path: "/watch/search", expect: "redirect" },
    )

    expect(outcome).toBe("acceptable")
    expect(note).toMatch(/root search-modal/)
  })
})

describe("WATCH_URL_FIXTURES integrity", () => {
  it("every path is /watch-prefixed and non-empty", () => {
    for (const f of WATCH_URL_FIXTURES) {
      expect(f.path.startsWith("/watch")).toBe(true)
      expect(f.group.length).toBeGreaterThan(0)
    }
  })

  it("covers all seven §5 groups", () => {
    const groups = new Set(WATCH_URL_FIXTURES.map((f) => f.group))
    expect(groups).toEqual(
      new Set([
        "5.1 roots",
        "5.2 two-segment",
        "5.3 episodes",
        "5.4 normalization redirects",
        "5.5 query params",
        "5.6 expected 404s",
        "5.7 asset/framework subtrees",
      ]),
    )
  })

  it("contains the flagship jesus/english fixture", () => {
    expect(
      WATCH_URL_FIXTURES.some(
        (f) => f.path === "/watch/jesus.html/english.html",
      ),
    ).toBe(true)
  })

  it("covers representative public asset passthrough paths", () => {
    const passthrough = new Set(
      WATCH_URL_FIXTURES.filter((f) => f.expect === "passthrough").map(
        (f) => f.path,
      ),
    )

    expect(passthrough.has("/watch/images/jesusfilm-sign.svg")).toBe(true)
    expect(passthrough.has("/watch/images/flags/ru.svg")).toBe(true)
    expect(passthrough.has("/watch/assets/overlay.svg")).toBe(true)
    expect(
      passthrough.has("/watch/fonts/Montserrat-VariableFont_wght.woff2"),
    ).toBe(true)
  })

  it("has no duplicate paths", () => {
    const paths = WATCH_URL_FIXTURES.map((f) => f.path)
    expect(new Set(paths).size).toBe(paths.length)
  })
})

describe("parseJsonLdScripts", () => {
  it("parses literal JSON-LD scripts without counting RSC-serialized copies", () => {
    const html = `
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoObject"}</script>
      <script>self.__next_f.push(["<script type=\\"application/ld+json\\">{\\"@type\\":\\"VideoObject\\"}</script>"])</script>
      <script class="seo" type='application/ld+json'>{"@type":"ItemList"}</script>
    `

    expect(parseJsonLdScripts(html)).toEqual({
      scriptCount: 2,
      types: ["VideoObject", "ItemList"],
      parseErrors: [],
    })
  })

  it("reports malformed literal scripts", () => {
    expect(
      parseJsonLdScripts(
        '<script type="application/ld+json">{broken}</script>',
      ),
    ).toMatchObject({
      scriptCount: 1,
      types: [],
      parseErrors: [expect.stringContaining("script 1")],
    })
  })

  it("counts entity types nested in a JSON-LD graph", () => {
    expect(
      parseJsonLdScripts(
        '<script type="application/ld+json">{"@graph":[{"@type":"CollectionPage"},{"@type":["VideoObject","Thing"]}]}</script>',
      ),
    ).toMatchObject({
      scriptCount: 1,
      types: ["CollectionPage", "VideoObject", "Thing"],
      parseErrors: [],
    })
  })
})

describe("validateStructuredDataContract", () => {
  const homeContract = WATCH_STRUCTURED_DATA_CONTRACTS["/watch"]!
  const videoContract =
    WATCH_STRUCTURED_DATA_CONTRACTS["/watch/jesus.html/english.html"]!

  it("fails a required entity that is missing from the initial response", () => {
    expect(validateStructuredDataContract(undefined, homeContract)).toEqual([
      "expected exactly 1 CollectionPage, found 0",
    ])
  })

  it("fails duplicate VideoObjects on a playable sample", () => {
    expect(
      validateStructuredDataContract(
        {
          scriptCount: 2,
          types: ["VideoObject", "VideoObject"],
          parseErrors: [],
        },
        videoContract,
      ),
    ).toEqual(["expected exactly 1 VideoObject, found 2"])
  })

  it("fails forbidden schema on a collection sample", () => {
    expect(
      validateStructuredDataContract(
        {
          scriptCount: 2,
          types: ["CollectionPage", "BreadcrumbList"],
          parseErrors: [],
        },
        homeContract,
      ),
    ).toEqual(["forbidden BreadcrumbList found 1 time(s)"])
  })
})

describe("probeUrl (mocked fetch)", () => {
  it("returns final status + origin-stripped path for a direct 200", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 200 }),
      ) as unknown as typeof fetch
    const r = await probeUrl(
      "https://www.jesusfilm.org",
      "/watch/jesus.html/english.html",
      { fetchImpl },
    )
    expect(r.status).toBe(200)
    expect(r.finalPath).toBe("/watch/jesus.html/english.html")
    expect(r.redirectHops).toBe(0)
  })

  it("captures structured-data types from final HTML responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        '<script type="application/ld+json">{"@type":"CollectionPage"}</script>',
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      ),
    ) as unknown as typeof fetch

    const r = await probeUrl("https://preview.test", "/watch", { fetchImpl })

    expect(r.structuredData).toEqual({
      scriptCount: 1,
      types: ["CollectionPage"],
      parseErrors: [],
    })
  })

  it("follows redirects and reports the final path + hop count", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { location: "/watch/jesus.html/english.html" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 200 }),
      ) as unknown as typeof fetch
    const r = await probeUrl(
      "https://preview.test",
      "/watch/jesus.html/english",
      {
        fetchImpl,
      },
    )
    expect(r.status).toBe(200)
    expect(r.finalPath).toBe("/watch/jesus.html/english.html")
    expect(r.redirectHops).toBe(1)
  })

  it("stops following after MAX_REDIRECT_HOPS and reports the 3xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 308,
        headers: { location: "/watch/loop" },
      }),
    ) as unknown as typeof fetch
    const r = await probeUrl("https://preview.test", "/watch/loop", {
      fetchImpl,
    })
    expect(r.status).toBe(308)
    expect(r.redirectHops).toBe(5)
  })

  it("captures transport errors as a result with error set", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch
    const r = await probeUrl("https://preview.test", "/watch/jesus.html", {
      fetchImpl,
    })
    expect(r.error).toBe("ECONNREFUSED")
    expect(r.status).toBe(0)
  })
})
