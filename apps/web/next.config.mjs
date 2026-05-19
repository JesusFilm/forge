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
  experimental: {
    typedRoutes: true,
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
