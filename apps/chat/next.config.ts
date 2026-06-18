import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Next.js dev blocks hydration when the page origin differs from the dev
  // server's origin. The monorepo convention is to navigate via 127.0.0.1
  // (e.g. apps/admin runs on 127.0.0.1:3003), so allow it here or the chat UI
  // renders dead — SSR HTML, no interactivity, only a single stdout warning.
  // Dev-only; production ignores this. See
  // docs/solutions/runtime-errors/nextjs-alloweddevorigins-hydration-dead-127-0-0-1-20260520.md
  allowedDevOrigins: ["127.0.0.1"],
}

export default nextConfig
