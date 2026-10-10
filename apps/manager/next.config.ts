import type { NextConfig } from "next"
import { withWorkflow } from "workflow/next"

const nextConfig: NextConfig = {
  output: "standalone",
  typedRoutes: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
}

export default withWorkflow(nextConfig, {
  workflows: {
    dirs: ["src/workflows"],
  },
})
