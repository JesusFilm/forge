import { describe, expect, it, vi } from "vitest"

import {
  WATCH_URL_FIXTURES,
  classifyProbe,
  probeUrl,
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

  it("hard-regression: passthrough fixture redirects even if both sides match", () => {
    const fixture = {
      path: "/watch/images/jesusfilm-sign.svg",
      expect: "passthrough" as const,
    }
    const broken = result({
      status: 200,
      finalPath: "/watch/images.html/jesusfilm-sign.svg.html",
      redirectHops: 1,
    })

    const { outcome, note } = classifyProbe(broken, broken, fixture)

    expect(outcome).toBe("hard-regression")
    expect(note).toMatch(/PASSTHROUGH CONTRACT BROKEN/)
    expect(note).toMatch(/production redirected 1 hop/)
  })

  it("hard-regression: passthrough fixture final path changes without a hop", () => {
    const fixture = {
      path: "/watch/images/jesusfilm-sign.svg",
      expect: "passthrough" as const,
    }

    const { outcome, note } = classifyProbe(
      result({ finalPath: "/watch/images.html/jesusfilm-sign.svg.html" }),
      result({ finalPath: "/watch/images/jesusfilm-sign.svg" }),
      fixture,
    )

    expect(outcome).toBe("hard-regression")
    expect(note).toMatch(/final path changed/)
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
