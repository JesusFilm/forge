import type { NextConfig } from "next"
import { withWorkflow } from "workflow/next"

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    typedRoutes: true,
  },
}

// withWorkflow enables `"use workflow"` / `"use step"` directives.
// `dirs` restricted to `src/workflows` to avoid the documented OOM risk
// from the default wide directory scan (scans all of app/, pages/, src/).
export default withWorkflow(nextConfig, {
  workflows: {
    dirs: ["src/workflows"],
  },
})
