import { matchRemotePattern } from "next/dist/shared/lib/match-remote-pattern.js"
import { afterEach, describe, expect, it, vi } from "vitest"
import { getAllowedDevOrigins, nextConfig } from "../next.config.mjs"
import { datadogIntakeHost } from "../watch-security-headers.mjs"

/**
 * `nextConfig` is captured at module load, so an env var only reaches it
 * through a fresh import. Everything env-dependent in this file goes through
 * here; asserting on the statically imported `nextConfig` would silently test
 * the unset-env branch instead.
 */
async function configWithEnv(env) {
  vi.resetModules()
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value)
  }
  const mod = await import("../next.config.mjs")
  return mod.nextConfig
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

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

  const directive = (policy, name) =>
    policy
      .split("; ")
      .find((part) => part.startsWith(`${name} `))
      ?.slice(name.length + 1) ?? ""

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

  it("leaves DNS prefetching enabled for the image CDN hint in the layout", async () => {
    // app/[locale]/[htmlLang]/layout.tsx emits a dns-prefetch for
    // imagedelivery.net. `X-DNS-Prefetch-Control: off` would silently cancel it.
    const headers = await headersFor("/:path*")
    expect(headers["x-dns-prefetch-control"]).toBe("on")
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

  it("admits the media hosts playback actually uses, not just the ones it starts at", async () => {
    // Observed in a real browser run: stream.mux.com hands HLS off to
    // regional `*.fastly.mux.com` CDN hosts, and subtitles come from
    // api-media-core.jesusfilm.org. A policy naming only stream.mux.com
    // reports on every segment and would break playback once enforced.
    const headers = await headersFor("/:path*")
    const reportOnly = headers["content-security-policy-report-only"]
    const mediaSrc = directive(reportOnly, "media-src")
    const connectSrc = directive(reportOnly, "connect-src")

    for (const source of [
      "https://*.mux.com",
      "https://api-media-core.jesusfilm.org",
    ]) {
      expect(mediaSrc, source).toContain(source)
      expect(connectSrc, source).toContain(source)
    }
    // Anti-vacuous companion: the bare host would satisfy a naive
    // `toContain("mux.com")` while still excluding every segment host.
    expect(mediaSrc).not.toBe("'self' blob: https://stream.mux.com")
  })

  it("keeps the required Watch analytics hosts reachable under the report-only policy", async () => {
    // docs/analytics-and-recommendation-policy.md requires GA and Datadog RUM
    // to keep working. A report-only policy that excluded them would turn
    // into an outage the moment it is enforced.
    const headers = await headersFor("/:path*")
    const reportOnly = headers["content-security-policy-report-only"]
    expect(reportOnly).toContain("https://www.googletagmanager.com")
    expect(reportOnly).toContain("browser-intake-datadoghq.com")
    expect(reportOnly).toContain("https://*.mux.com")
  })

  it("omits directives a report-only policy cannot honour", async () => {
    // Chrome logs `upgrade-insecure-requests is ignored when delivered in a
    // report-only policy`, and shipping it would mean promotion silently
    // turns on request rewriting that was never exercised in report mode.
    const headers = await headersFor("/:path*")
    expect(headers["content-security-policy-report-only"]).not.toContain(
      "upgrade-insecure-requests",
    )
  })

  const connectSrcFor = async (env) => {
    const config = await configWithEnv(env)
    const rule = (await config.headers()).find(
      (entry) => entry.source === "/:path*",
    )
    const policy = rule.headers.find(
      (header) => header.key === "Content-Security-Policy-Report-Only",
    ).value
    return directive(policy, "connect-src")
  }

  it("admits the browser-facing admin origin", async () => {
    // Anti-vacuous companion to the leak test below. Neither
    // NEXT_PUBLIC_ADMIN_GRAPHQL_URL nor ADMIN_GRAPHQL_URL is set in the test
    // environment, so without stubbing, `adminGraphqlUrl` is always undefined
    // and a "does not contain the private host" assertion passes no matter
    // which var the config reads.
    const connectSrc = await connectSrcFor({
      NEXT_PUBLIC_ADMIN_GRAPHQL_URL: "https://admin.example.test/api/graphql",
    })
    expect(connectSrc).toContain("https://admin.example.test")
  })

  it("never publishes the server-only admin origin in connect-src", async () => {
    // ADMIN_GRAPHQL_URL is a Railway private-network host in production
    // (apps/web/CLAUDE.md). It is unreachable from a browser, so listing it
    // would leak an internal hostname for no benefit. Asserted on the ORIGIN,
    // because that is what the policy emits — matching the full URL (with its
    // path) would pass even while the host leaked.
    const connectSrc = await connectSrcFor({
      ADMIN_GRAPHQL_URL: "http://forgeadmin.railway.internal:8080/api/graphql",
    })
    expect(connectSrc).not.toContain("railway.internal")
    expect(connectSrc).not.toContain("http://forgeadmin.railway.internal:8080")
  })

  it("promotes the full policy to enforced only when the env flag says so", async () => {
    // The one branch the report-only-first design exists to make safe, and the
    // one no other test reaches: the day an operator flips the flag.
    const config = await configWithEnv({ WATCH_CSP_ENFORCE: "true" })
    const rule = (await config.headers()).find(
      (entry) => entry.source === "/:path*",
    )
    const keys = rule.headers.map((header) => header.key)

    expect(keys).not.toContain("Content-Security-Policy-Report-Only")
    expect(
      keys.filter((key) => key === "Content-Security-Policy"),
    ).toHaveLength(1)
    const enforced = rule.headers.find(
      (header) => header.key === "Content-Security-Policy",
    ).value
    // The promoted header is the FULL policy, not the narrow clickjacking one.
    expect(enforced).toContain("default-src 'self'")
    expect(enforced).toContain("frame-ancestors 'self'")
    expect(enforced).not.toBe("frame-ancestors 'self'")
  })

  it("treats the common truthy spellings of the enforce flag as enforcement", async () => {
    // A case-sensitive `=== "true"` would leave WATCH_CSP_ENFORCE=True in
    // report-only mode with no error, which reads as "the flip did nothing".
    for (const value of ["True", "1", " yes "]) {
      const config = await configWithEnv({ WATCH_CSP_ENFORCE: value })
      const rule = (await config.headers()).find(
        (entry) => entry.source === "/:path*",
      )
      expect(
        rule.headers.map((header) => header.key),
        value,
      ).not.toContain("Content-Security-Policy-Report-Only")
    }
  })

  it("derives the Datadog intake host for every configured site", () => {
    // The intake host is not a subdomain of the site: `us3.datadoghq.com`
    // posts to `browser-intake-us3-datadoghq.com` and `datadoghq.eu` to
    // `browser-intake-datadoghq.eu`, so `*.datadoghq.com` covers neither.
    // Sites are the DATADOG_SITE_VALUES union in src/env.ts.
    expect(
      Object.fromEntries(
        [
          "datadoghq.com",
          "us3.datadoghq.com",
          "us5.datadoghq.com",
          "datadoghq.eu",
          "ddog-gov.com",
          "ap1.datadoghq.com",
          "ap2.datadoghq.com",
        ].map((site) => [site, datadogIntakeHost(site)]),
      ),
    ).toEqual({
      "datadoghq.com": "browser-intake-datadoghq.com",
      "us3.datadoghq.com": "browser-intake-us3-datadoghq.com",
      "us5.datadoghq.com": "browser-intake-us5-datadoghq.com",
      "datadoghq.eu": "browser-intake-datadoghq.eu",
      "ddog-gov.com": "browser-intake-ddog-gov.com",
      "ap1.datadoghq.com": "browser-intake-ap1-datadoghq.com",
      "ap2.datadoghq.com": "browser-intake-ap2-datadoghq.com",
    })
    expect(datadogIntakeHost(undefined)).toBe("browser-intake-datadoghq.com")
  })

  it("admits the configured Datadog region's intake host, not just the default", async () => {
    const connectSrc = await connectSrcFor({
      NEXT_PUBLIC_DATADOG_SITE: "datadoghq.eu",
    })
    expect(connectSrc).toContain("https://browser-intake-datadoghq.eu")
    // Anti-vacuous: the old `*.datadoghq.com` wildcard would not have matched.
    expect(connectSrc).not.toContain("https://browser-intake-datadoghq.com ")
  })

  it("falls back to the env-schema admin default when the public var is unset", async () => {
    // src/env.ts defaults NEXT_PUBLIC_ADMIN_GRAPHQL_URL in production, so an
    // environment that never sets it still makes browser-direct Admin calls.
    // A connect-src built from the raw var alone would block them once
    // enforced.
    const connectSrc = await connectSrcFor({ NODE_ENV: "production" })
    expect(connectSrc).toContain("https://admin.jesusfilm.org")
  })

  it("does not advertise the framework", async () => {
    expect(nextConfig.poweredByHeader).toBe(false)
  })
})

describe("Next.js image optimizer is not an open proxy", () => {
  const matchesAnyPattern = (url) =>
    nextConfig.images.remotePatterns.some((pattern) =>
      matchRemotePattern(pattern, new URL(url)),
    )

  it("scopes an operator-configured additional image host too", async () => {
    // NEXT_PUBLIC_ADDITIONAL_IMAGE_HOSTS is unset in the test environment, so
    // the generic sweep below never reaches this branch: it would stay green
    // if the `pathname` were dropped from the operator-host mapping.
    const config = await configWithEnv({
      NEXT_PUBLIC_ADDITIONAL_IMAGE_HOSTS: "cdn.example.test",
    })
    const pattern = config.images.remotePatterns.find(
      (entry) => entry.hostname === "cdn.example.test",
    )
    expect(pattern).toBeDefined()
    expect(pattern.pathname).toBe("/**")
  })

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
    expect(
      matchesAnyPattern(
        "https://images.unsplash.com/photo-1506905925346-21bda4d32df4",
      ),
    ).toBe(false)
  })

  it("still allows the fixed Unsplash placeholders the app actually renders", async () => {
    // Anti-vacuous companion: removing the host outright would also make the
    // probe above fail, while breaking DEFAULT_BLOCK_IMAGE_URL and the
    // BibleQuotesSection promo card.
    for (const rendered of [
      "https://images.unsplash.com/photo-1488521787991-ed7bbaae773c",
      "https://images.unsplash.com/photo-1650658720644-e1588bd66de3",
    ]) {
      expect(matchesAnyPattern(rendered), rendered).toBe(true)
    }
  })

  // NOTE: these two assert path SHAPE only. Both CDNs are multitenant and use
  // that shape for every customer, so — unlike the Unsplash pin above — they do
  // not restrict whose account hash or playback id may be proxied. Do not read
  // a passing test here as "the open image proxy is closed for these hosts".
  it("scopes the Mux and Cloudflare image CDNs to their real path shapes", async () => {
    expect(
      matchesAnyPattern("https://image.mux.com/playback-1/thumbnail.jpg"),
    ).toBe(true)
    expect(
      matchesAnyPattern("https://image.mux.com/playback-1/storyboard.json"),
    ).toBe(true)
    expect(
      matchesAnyPattern("https://image.mux.com/some/deeper/path.jpg"),
    ).toBe(false)

    expect(
      matchesAnyPattern(
        "https://imagedelivery.net/acct/image-id/f=jpg,w=1280,h=600",
      ),
    ).toBe(true)
    expect(matchesAnyPattern("https://imagedelivery.net/anything.png")).toBe(
      false,
    )
  })
})
