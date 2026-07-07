import createNextIntlPlugin from "next-intl/plugin"
import { WATCH_BASE_PATH } from "./watch-base-path.mjs"

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
  .map((hostname) => ({ protocol: "https", hostname }))

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
    ]
  } catch {
    return []
  }
})()

const nextConfig = {
  basePath: WATCH_BASE_PATH,
  allowedDevOrigins: ["127.0.0.1"],
  // Self-hosted prod (Railway) doesn't always sit behind a compressing
  // proxy. Without this the JS chunks ship at their raw ~1.8 MB size,
  // dominating the simulated-mobile LCP budget. compress:true wires
  // Next's built-in gzip middleware on every text/* response.
  compress: true,
  // typedRoutes moved to top-level in Next 16 (stable).
  typedRoutes: true,
  // Datadog RUM source-map uploads need production browser maps available
  // after `next build`; uploads stay opt-in via `pnpm datadog:sourcemaps`.
  productionBrowserSourceMaps: true,
  serverExternalPackages: datadogServerExternalPackages,
  webpack(config, { isServer }) {
    if (isServer) {
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
  },
  images: {
    dangerouslyAllowLocalIP: process.env.NODE_ENV !== "production",
    remotePatterns: [
      { protocol: "http", hostname: "localhost", pathname: "/uploads/**" },
      {
        protocol: "http",
        hostname: "localhost",
        port: "3003",
        pathname: "/api/media-assets/**",
      },
      { protocol: "http", hostname: "127.0.0.1", pathname: "/uploads/**" },
      {
        protocol: "http",
        hostname: "127.0.0.1",
        port: "3003",
        pathname: "/api/media-assets/**",
      },
      ...adminMediaImageHost,
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "imagedelivery.net" },
      { protocol: "https", hostname: "image.mux.com" },
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
