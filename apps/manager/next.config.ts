import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Validate env at build time
  experimental: {
    typedRoutes: true,
  },
}

export default nextConfig
