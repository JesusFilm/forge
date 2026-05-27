/** @type {import('next').NextConfig} */

const additionalImageHosts = (
  process.env.NEXT_PUBLIC_ADDITIONAL_IMAGE_HOSTS ?? ""
)
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean)
  .map((hostname) => ({ protocol: "https", hostname }))

const nextConfig = {
  basePath: "/watch",
  allowedDevOrigins: ["127.0.0.1"],
  // Self-hosted prod (Railway) doesn't always sit behind a compressing
  // proxy. Without this the JS chunks ship at their raw ~1.8 MB size,
  // dominating the simulated-mobile LCP budget. compress:true wires
  // Next's built-in gzip middleware on every text/* response.
  compress: true,
  experimental: {
    typedRoutes: true,
    optimizePackageImports: [
      "lucide-react",
      "@mux/mux-player-react",
      "@mux/mux-video-react",
    ],
  },
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "localhost", pathname: "/uploads/**" },
      { protocol: "http", hostname: "127.0.0.1", pathname: "/uploads/**" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "imagedelivery.net" },
      { protocol: "https", hostname: "image.mux.com" },
      ...additionalImageHosts,
      ...(process.env.NEXT_PUBLIC_CMS_HOSTNAME
        ? [
            {
              protocol: process.env.NEXT_PUBLIC_CMS_PROTOCOL || "https",
              hostname: process.env.NEXT_PUBLIC_CMS_HOSTNAME,
              pathname: "/uploads/**",
            },
          ]
        : []),
    ],
  },
}

export default nextConfig
