import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/:path*.md",
        destination: "/api/md/:path*",
      },
    ]
  },
}

export default nextConfig
