/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/watch",
  experimental: {
    typedRoutes: true,
  },
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "localhost", pathname: "/uploads/**" },
      { protocol: "http", hostname: "127.0.0.1", pathname: "/uploads/**" },
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
