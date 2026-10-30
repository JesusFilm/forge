import type { NextConfig } from "next"
import { withWorkflow } from "workflow/next"

const nextConfig: NextConfig = {
  allowedDevOrigins:
    process.env.NODE_ENV === "development" && process.env.MANAGER_BASE_URL
      ? [new URL(process.env.MANAGER_BASE_URL).hostname]
      : undefined,
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
