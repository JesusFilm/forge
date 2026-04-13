import type { NextConfig } from "next"

// NOTE: `withWorkflow` from `workflow/next` will wrap this config in Unit 11,
// with `workflows: { dirs: ['src/workflows'] }` to avoid the documented OOM
// risk from the default wide directory scan.
const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    typedRoutes: true,
  },
}

export default nextConfig
