import type { NextConfig } from "next"
import { withWorkflow } from "workflow/next"

const nextConfig: NextConfig = {
  typedRoutes: true,
  // Railway's dedicated worker uses a smaller build container than the Admin
  // web service. CI runs the package typecheck over production and test source
  // before the production build, so do not make Next construct a second large
  // TypeScript program during `next build`.
  typescript: {
    ignoreBuildErrors: true,
  },
  // Required for Datadog RUM stack traces to resolve to original sources after
  // `pnpm --filter @forge/admin datadog:sourcemaps` uploads release artifacts.
  productionBrowserSourceMaps: true,
  webpack(config, { dev, isServer }) {
    // Browser sourcemaps are uploaded to Datadog; server maps stay with the
    // deployed bundle so Node can remap backend APM stack traces.
    if (isServer && !dev) config.devtool = "source-map"

    return config
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
  // Consume the raw-source `@forge/experience-schema` workspace package
  // (its `exports` point at `./src/index.ts`); Next must transpile it as
  // first-party code rather than treat it as a prebuilt node_modules dep.
  transpilePackages: ["@forge/experience-schema"],
}

// withWorkflow enables `"use workflow"` / `"use step"` directives.
// `dirs` restricted to `src/workflows` to avoid the documented OOM risk
// from the default wide directory scan (scans all of app/, pages/, src/).
export default withWorkflow(nextConfig, {
  workflows: {
    dirs: ["src/workflows"],
  },
})
