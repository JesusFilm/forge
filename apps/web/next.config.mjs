/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/watch",
  typedRoutes: true,
  experimental: {
    useCache: true,
  },
}

export default nextConfig
