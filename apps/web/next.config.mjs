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
    ],
  },
}

export default nextConfig
