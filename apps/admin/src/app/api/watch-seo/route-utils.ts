import { rateLimitAuthRoute } from "@/auth/rate-limit"
import type { WatchSeoDenialReason } from "@/services/watch-seo/authorization"

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization, X-Watch-User-Authorization",
  "X-Content-Type-Options": "nosniff",
} as const

// Web's adapter is a single server-to-server caller, so this per-IP bucket
// bounds the whole Admin population of the feature. Both limits sit far above
// human use (one capability probe per page view, one read per tab open) and
// exist to cap junk traffic before it reaches the auth chain.
export const WATCH_SEO_CAPABILITY_RATE = { limit: 120, windowMs: 60_000 }
export const WATCH_SEO_READ_RATE = { limit: 60, windowMs: 60_000 }

export function noStoreJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE_HEADERS })
}

export function rateLimited(): Response {
  return Response.json(
    { error: "rate_limited" },
    { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": "60" } },
  )
}

/**
 * Rate limiting fires BEFORE authentication so an unauthenticated flood cannot
 * reach the auth chain (and through it, Auth's introspection endpoint).
 */
export async function admitWatchSeoRequest(
  request: Request,
  route: string,
  rate: { limit: number; windowMs: number },
): Promise<boolean> {
  const result = await rateLimitAuthRoute({
    request,
    route,
    limit: rate.limit,
    windowMs: rate.windowMs,
  })
  return result.allowed
}

// Plain-string key=value per the Railway logsV2 rule; the reason is a closed
// enum and no token, subject, key, header, or email ever reaches the line.
export function logWatchSeoDenial(
  route: string,
  reason: WatchSeoDenialReason,
): void {
  console.warn(`[watch-seo] event=denied route=${route} reason=${reason}`)
}
