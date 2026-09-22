import createNextIntlPlugin from "next-intl/plugin"
import { fileURLToPath } from "node:url"
import { WATCH_BASE_PATH } from "./watch-base-path.mjs"
import { buildWatchSecurityHeaders } from "./watch-security-headers.mjs"

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts")

/** @type {import('next').NextConfig} */

const datadogServerExternalPackages = [
  "@datadog/native-appsec",
  "@datadog/native-iast-rewriter",
  "@datadog/native-iast-taint-tracking",
  "@datadog/native-metrics",
  "@datadog/pprof",
  "@datadog/wasm-js-rewriter",
  "dd-trace",
]

const additionalImageHosts = (
  process.env.NEXT_PUBLIC_ADDITIONAL_IMAGE_HOSTS ?? ""
)
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean)
  // Operator-configured hosts. `/**` is the widest scope we can give an
  // arbitrary allowlist entry, but it still keeps every pattern explicitly
  // path-scoped so a future entry cannot silently omit one.
  .map((hostname) => ({ protocol: "https", hostname, pathname: "/**" }))

const adminMediaImageHost = (() => {
  try {
    const url = new URL(process.env.ADMIN_GRAPHQL_URL ?? "")
    return [
      {
        protocol: url.protocol.replace(":", ""),
        hostname: url.hostname,
        port: url.port,
        pathname: "/api/media-assets/**",
      },
      {
        protocol: url.protocol.replace(":", ""),
        hostname: url.hostname,
        port: url.port,
        pathname: "/api/public/media-assets/**",
      },
    ]
  } catch {
    return []
  }
})()

export function getAllowedDevOrigins(canonicalOrigin) {
  const origins = new Set(["127.0.0.1"])

  if (!canonicalOrigin) return [...origins]

  try {
    origins.add(new globalThis.URL(canonicalOrigin).hostname)
  } catch {
    // Keep local development bootable when an optional override is malformed.
  }

  return [...origins]
}

const allowedDevOrigins = getAllowedDevOrigins(
  process.env.NEXT_PUBLIC_CANONICAL_ORIGIN,
)

export const nextConfig = {
  basePath: WATCH_BASE_PATH,
  allowedDevOrigins,
  // `X-Powered-By: Next.js` told every scanner which framework and therefore
  // which CVE set to try, for no benefit.
  poweredByHeader: false,
  // Self-hosted prod (Railway) doesn't always sit behind a compressing
  // proxy. Without this the JS chunks ship at their raw ~1.8 MB size,
  // dominating the simulated-mobile LCP budget. compress:true wires
  // Next's built-in gzip middleware on every text/* response.
  compress: true,
  // Next hashes every cached HTML/RSC response synchronously for its ETag.
  // Multi-megabyte language catalogs block the shared request thread long
  // enough to expire recommendation admission. Keep ISR/Cache-Control, but
  // avoid repeating that full-body hash on every cache hit.
  generateEtags: false,
  // typedRoutes moved to top-level in Next 16 (stable).
  typedRoutes: true,
  cacheHandler: fileURLToPath(new URL("./cache-handler.mjs", import.meta.url)),
  cacheMaxMemorySize: 0,
  // Datadog RUM source-map uploads need production browser maps available
  // after `next build`; uploads stay opt-in via `pnpm datadog:sourcemaps`.
  productionBrowserSourceMaps: true,
  serverExternalPackages: datadogServerExternalPackages,
  webpack(config, { dev, isServer }) {
    if (isServer) {
      // Next's browser sourcemap flag does not cover server bundles. Generate
      // Node maps for production APM stack traces while keeping dev defaults.
      if (!dev) config.devtool = "source-map"
      config.externals.push(...datadogServerExternalPackages)
    } else {
      config.resolve.alias = {
        ...config.resolve.alias,
        "@/observability/datadog": false,
        "@/observability/datadog-logs": false,
        "dd-trace": false,
      }
    }

    return config
  },
  async headers() {
    return [
      {
        // `/:path*` also matches the basePath root, which `proxy()` never
        // sees. That root is precisely where the old proxy-only header set
        // was missing (FGE-235).
        source: "/:path*",
        headers: buildWatchSecurityHeaders({
          // Only the NEXT_PUBLIC_ URL: that is the origin the browser
          // actually connects to (src/lib/watch-search-client.ts). The
          // server-only ADMIN_GRAPHQL_URL is a Railway private-network host in
          // production, and echoing it in a public header would publish an
          // internal hostname the browser can never reach anyway.
          adminGraphqlUrl: process.env.NEXT_PUBLIC_ADMIN_GRAPHQL_URL,
          // Report-only by default. Promoting the policy is a deliberate env
          // flip plus a redeploy, never a code change bundled with the change
          // that introduced the policy.
          enforceContentSecurityPolicy:
            process.env.WATCH_CSP_ENFORCE === "true",
        }),
      },
    ]
  },
  async rewrites() {
    return {
      beforeFiles: [
        // Next does not run proxy() for the exact basePath root in dev/prod
        // routing, so /watch needs a config-level internal rewrite to reach
        // the static locale tree. Visible /watch/en/en is still guarded by
        // proxy.ts's direct-prefix policy.
        { source: "/", destination: "/en/en" },
      ],
    }
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "@mux/mux-video-react"],
    serverActions: {
      // Core's canonical Watch proxy preserves the public Origin, while
      // Railway replaces x-forwarded-host with its upstream hostname.
      allowedOrigins: ["develop.jesusfilm.org", "www.jesusfilm.org"],
    },
  },
  images: {
    // Next re-encodes on the way out and defaults to 75, which smears the
    // text in UI screenshots. Non-default qualities must be allowlisted
    // since Next 15.4 or the optimizer returns an error, not an image.
    qualities: [75, 94],
    dangerouslyAllowLocalIP: process.env.NODE_ENV !== "production",
    remotePatterns: [
      { protocol: "http", hostname: "localhost", pathname: "/uploads/**" },
      {
        protocol: "http",
        hostname: "localhost",
        port: "3003",
        pathname: "/api/media-assets/**",
      },
      {
        protocol: "http",
        hostname: "localhost",
        port: "3003",
        pathname: "/api/public/media-assets/**",
      },
      { protocol: "http", hostname: "127.0.0.1", pathname: "/uploads/**" },
      {
        protocol: "http",
        hostname: "127.0.0.1",
        port: "3003",
        pathname: "/api/media-assets/**",
      },
      {
        protocol: "http",
        hostname: "127.0.0.1",
        port: "3003",
        pathname: "/api/public/media-assets/**",
      },
      ...adminMediaImageHost,
      // Pinned to the two fixed placeholder photos the app renders
      // (DEFAULT_BLOCK_IMAGE_URL in components/sections/block-types.ts and
      // PROMO_IMAGE_URL in components/watch/BibleQuotesSection.tsx). A bare
      // hostname entry made /watch/_next/image a working open proxy for every
      // photo on the Unsplash CDN.
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/photo-1488521787991-ed7bbaae773c",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/photo-1650658720644-e1588bd66de3",
      },
      // Editorial photography hot-linked from the main jesusfilm.org
      // WordPress library (same org, deliberately not vendored into this
      // repo). Scoped to the uploads path so the allowlist cannot widen to
      // arbitrary jesusfilm.org routes.
      {
        protocol: "https",
        hostname: "www.jesusfilm.org",
        pathname: "/wp-content/uploads/**",
      },
      {
        protocol: "https",
        hostname: "admin.jesusfilm.org",
        pathname: "/api/public/media-assets/**",
      },
      // Cloudflare Images serves `/<account-hash>/<image-id>/<variant>`; web
      // appends the `public` variant when admin stored the URL without one,
      // so three segments is the real shape.
      {
        protocol: "https",
        hostname: "imagedelivery.net",
        pathname: "/*/*/**",
      },
      // Mux image derivatives are always `/<playbackId>/<asset>`.
      { protocol: "https", hostname: "image.mux.com", pathname: "/*/*" },
      ...additionalImageHosts,
      ...(process.env.NEXT_PUBLIC_CMS_HOSTNAME
        ? [
            {
              protocol: process.env.NEXT_PUBLIC_CMS_PROTOCOL || "https",
              hostname: process.env.NEXT_PUBLIC_CMS_HOSTNAME,
              pathname: "/uploads/**",
            },
          ]
        : []),
    ],
  },
}

export default withNextIntl(nextConfig)
