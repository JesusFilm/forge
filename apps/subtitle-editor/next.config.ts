import path from "node:path"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  typedRoutes: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ]
  },
  outputFileTracingRoot: path.join(__dirname, "../.."),
}

export default nextConfig
