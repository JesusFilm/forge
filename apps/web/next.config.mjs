/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/watch",
  experimental: {
    typedRoutes: true,
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/watch",
        permanent: false,
        basePath: false,
      },
    ]
  },
}

export default nextConfig
