/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/watch",
  experimental: {
    typedRoutes: true,
  },
  images: {
    remotePatterns: [
      { hostname: "localhost", pathname: "/uploads/**" },
      { hostname: "127.0.0.1", pathname: "/uploads/**" },
    ],
  },
}

export default nextConfig
