import type { NextConfig } from "next"

const config: NextConfig = {
  agentRules: false,
  output: "standalone",
  allowedDevOrigins:
    process.env.NODE_ENV === "development" && process.env.FEEDBACK_BASE_URL
      ? [new URL(process.env.FEEDBACK_BASE_URL).hostname]
      : [],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      ...(process.env.NODE_ENV === "development"
        ? [
            {
              source: "/tv/preview/frame",
              headers: [
                {
                  key: "Content-Security-Policy",
                  value: "frame-ancestors 'self'",
                },
                { key: "X-Frame-Options", value: "SAMEORIGIN" },
              ],
            },
          ]
        : []),
    ]
  },
}

export default config
