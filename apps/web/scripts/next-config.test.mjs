import { describe, expect, it } from "vitest"
import { getAllowedDevOrigins, nextConfig } from "../next.config.mjs"

describe("Next.js Server Action origins", () => {
  it("trusts only the canonical Watch reverse proxies", () => {
    expect(nextConfig.experimental.serverActions.allowedOrigins).toEqual([
      "develop.jesusfilm.org",
      "www.jesusfilm.org",
    ])
  })
})

describe("Next.js client router cache", () => {
  it("keeps prefetched route data for 30s dynamic and 300s static", () => {
    // Next 16 defaults `dynamic` to 0, which re-fetched the same `?_rsc=`
    // URL on every revisit (FGE-209: 43 exact duplicates in one session).
    expect(nextConfig.experimental.staleTimes).toEqual({
      dynamic: 30,
      static: 300,
    })
  })
})

describe("Next.js development origins", () => {
  it("keeps loopback and admits the configured canonical hostname", () => {
    expect(getAllowedDevOrigins("https://base.example.test:8400")).toEqual([
      "127.0.0.1",
      "base.example.test",
    ])
  })

  it("falls back to loopback when the optional canonical origin is invalid", () => {
    expect(getAllowedDevOrigins("not a URL")).toEqual(["127.0.0.1"])
  })
})

describe("Next.js remote image hosts", () => {
  const patternsFor = (hostname) =>
    nextConfig.images.remotePatterns.filter(
      (pattern) => pattern.hostname === hostname,
    )

  it("allows the jesusfilm.org WordPress uploads used by /whats-new", () => {
    // Editorial photography on /whats-new is hot-linked, not vendored. A
    // missing pattern is not a build error — next/image throws at REQUEST
    // time, so the page ships and the card breaks in production.
    expect(patternsFor("www.jesusfilm.org")).toEqual([
      {
        protocol: "https",
        hostname: "www.jesusfilm.org",
        pathname: "/wp-content/uploads/**",
      },
    ])
  })

  it("does not widen that host beyond the uploads path", () => {
    // Anti-vacuous companion: a bare `hostname` entry with no `pathname`
    // would satisfy "the host is allowed" while opening every route on the
    // main site to the image optimizer.
    for (const pattern of patternsFor("www.jesusfilm.org")) {
      expect(pattern.pathname).toBe("/wp-content/uploads/**")
    }
  })
})
