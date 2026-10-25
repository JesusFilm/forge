import type { NextConfig } from "next"

/**
 * Nothing this app serves may ever be rendered inside a frame.
 *
 * Every interactive page here is one click away from an authorization:
 * `/oauth/consent` grants an app access, and `/device` approves a TV holding a
 * code that somebody else may have minted — `/api/auth/device/code` is
 * unauthenticated, so an attacker can obtain a user code and the matching PKCE
 * verifier before the victim ever sees the page. Framed, every anti-phishing
 * affordance on those screens (the code to compare, the deny button, the
 * "approving as" line) sits under an attacker's overlay and one disguised click
 * completes the grant.
 *
 * Same-origin checks do not help here: inside the frame the request genuinely
 * is same-origin and same-site, so better-auth's origin check and a Lax cookie
 * are both satisfied. `frame-ancestors` is the control that actually stops it.
 *
 * Applied to every route rather than just those two pages, so the next page
 * added here does not have to remember to opt in.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
]

const nextConfig: NextConfig = {
  output: "standalone",
  typedRoutes: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }]
  },
}

export default nextConfig
