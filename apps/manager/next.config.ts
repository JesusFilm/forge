import type { NextConfig } from "next"
import { withWorkflow } from "workflow/next"

const nextConfig: NextConfig = {
  output: "standalone",
  typedRoutes: true,
}

export default withWorkflow(nextConfig, {
  workflows: {
    dirs: ["src/workflows"],
  },
})
