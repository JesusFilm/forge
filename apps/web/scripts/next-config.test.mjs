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

describe("Watch baseline security headers", () => {
  const headerRules = async () => await nextConfig.headers()

  const headersFor = async (source) => {
    const rules = await headerRules()
    const rule = rules.find((entry) => entry.source === source)
    return Object.fromEntries(
      (rule?.headers ?? []).map(({ key, value }) => [key.toLowerCase(), value]),
    )
  }

  it("applies the baseline set to every path, not only proxy rewrite paths", async () => {
    // FGE-235: `applyWatchSecurityHeaders` in proxy.ts only runs on the two
    // rewrite call sites, so the basePath root `/watch` shipped with no CSP
    // and no Referrer-Policy at all. `/:path*` is the only source that also
    // covers the root.
    const rules = await headerRules()
    expect(rules.map((entry) => entry.source)).toContain("/:path*")
  })

  it("carries HSTS with preload, nosniff, referrer policy, COOP and CORP", async () => {
    const headers = await headersFor("/:path*")
    expect(headers["strict-transport-security"]).toBe(
      "max-age=63072000; includeSubDomains; preload",
    )
    expect(headers["x-content-type-options"]).toBe("nosniff")
    // Matches what proxy.ts already sent on rewrite paths; this change widens
    // the coverage, it does not change the policy.
    expect(headers["referrer-policy"]).toBe("strict-origin")
    expect(headers["cross-origin-opener-policy"]).toBe(
      "same-origin-allow-popups",
    )
    expect(headers["cross-origin-resource-policy"]).toBe("same-site")
    expect(headers["permissions-policy"]).toBeTypeOf("string")
  })

  it("keeps the player capabilities the Watch hero needs out of Permissions-Policy", async () => {
    const headers = await headersFor("/:path*")
    // Anti-vacuous companion to the assertion above: a policy that merely
    // exists is not safe. HeroPlayerControls calls requestFullscreen and the
    // hero autoplays muted, so denying these would break playback silently.
    for (const directive of [
      "fullscreen",
      "autoplay",
      "picture-in-picture",
      "encrypted-media",
    ]) {
      expect(headers["permissions-policy"]).not.toContain(`${directive}=`)
    }
    expect(headers["permissions-policy"]).toContain("camera=()")
    expect(headers["permissions-policy"]).toContain("microphone=()")
    expect(headers["permissions-policy"]).toContain("geolocation=()")
  })

  it("ships CSP report-only by default and never enforces the full policy in the same deploy", async () => {
    const headers = await headersFor("/:path*")
    const reportOnly = headers["content-security-policy-report-only"]
    expect(reportOnly).toBeTypeOf("string")
    for (const directive of [
      "default-src",
      "script-src",
      "object-src",
      "base-uri",
      "frame-ancestors",
    ]) {
      expect(reportOnly).toContain(`${directive} `)
    }
    // The enforced header stays the clickjacking-only policy proxy.ts already
    // shipped. Enforcing the full policy is a later env flip, never this PR.
    expect(headers["content-security-policy"]).toBe("frame-ancestors 'self'")
  })

  it("keeps the required Watch analytics hosts reachable under the report-only policy", async () => {
    // docs/analytics-and-recommendation-policy.md requires GA and Datadog RUM
    // to keep working. A report-only policy that excluded them would turn
    // into an outage the moment it is enforced.
    const headers = await headersFor("/:path*")
    const reportOnly = headers["content-security-policy-report-only"]
    expect(reportOnly).toContain("https://www.googletagmanager.com")
    expect(reportOnly).toContain("browser-intake-datadoghq.com")
    expect(reportOnly).toContain("https://stream.mux.com")
  })

  it("never publishes the server-only admin origin in connect-src", async () => {
    // ADMIN_GRAPHQL_URL is a Railway private-network host in production
    // (apps/web/CLAUDE.md). It is unreachable from a browser, so listing it
    // would leak an internal hostname for no benefit.
    const headers = await headersFor("/:path*")
    const reportOnly = headers["content-security-policy-report-only"]
    expect(reportOnly).not.toContain("railway.internal")
    expect(reportOnly).not.toContain(process.env.ADMIN_GRAPHQL_URL ?? "\u0000")
  })

  it("does not advertise the framework", async () => {
    expect(nextConfig.poweredByHeader).toBe(false)
  })
})

describe("Next.js image optimizer is not an open proxy", () => {
  it("scopes every remote pattern with a pathname", () => {
    for (const pattern of nextConfig.images.remotePatterns) {
      expect(
        pattern.pathname,
        `${pattern.hostname} has no pathname`,
      ).toBeTypeOf("string")
      expect(pattern.pathname.startsWith("/")).toBe(true)
    }
  })

  it("rejects the arbitrary Unsplash photo the audit proxied through /watch/_next/image", async () => {
    // FGE-235 evidence: this exact URL returned 200 image/jpeg 156826 for an
    // image the site never references. Matched against Next's own matcher so
    // the assertion tracks the real optimizer contract, not our reading of it.
    const { matchRemotePattern } =
      await import("next/dist/shared/lib/match-remote-pattern.js")
    const probe = new URL(
      "https://images.unsplash.com/photo-1506905925346-21bda4d32df4",
    )
    const matched = nextConfig.images.remotePatterns.some((pattern) =>
      matchRemotePattern(pattern, probe),
    )
    expect(matched).toBe(false)
  })

  it("still allows the fixed Unsplash placeholders the app actually renders", async () => {
    // Anti-vacuous companion: removing the host outright would also make the
    // probe above fail, while breaking DEFAULT_BLOCK_IMAGE_URL and the
    // BibleQuotesSection promo card.
    const { matchRemotePattern } =
      await import("next/dist/shared/lib/match-remote-pattern.js")
    for (const rendered of [
      "https://images.unsplash.com/photo-1488521787991-ed7bbaae773c",
      "https://images.unsplash.com/photo-1650658720644-e1588bd66de3",
    ]) {
      const matched = nextConfig.images.remotePatterns.some((pattern) =>
        matchRemotePattern(pattern, new URL(rendered)),
      )
      expect(matched, rendered).toBe(true)
    }
  })

  it("scopes the Mux and Cloudflare image CDNs to their real path shapes", async () => {
    const { matchRemotePattern } =
      await import("next/dist/shared/lib/match-remote-pattern.js")
    const matches = (url) =>
      nextConfig.images.remotePatterns.some((pattern) =>
        matchRemotePattern(pattern, new URL(url)),
      )

    expect(matches("https://image.mux.com/playback-1/thumbnail.jpg")).toBe(true)
    expect(matches("https://image.mux.com/playback-1/storyboard.json")).toBe(
      true,
    )
    expect(matches("https://image.mux.com/some/deeper/path.jpg")).toBe(false)

    expect(
      matches("https://imagedelivery.net/acct/image-id/f=jpg,w=1280,h=600"),
    ).toBe(true)
    expect(matches("https://imagedelivery.net/anything.png")).toBe(false)
  })
})
