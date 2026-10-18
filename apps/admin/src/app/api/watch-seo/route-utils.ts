import { incrementFixedWindow, rateLimitAuthRoute } from "@/auth/rate-limit"
import type { WatchSeoDenialReason } from "@/services/watch-seo/authorization"

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization, X-Watch-User-Authorization",
  "X-Content-Type-Options": "nosniff",
} as const

// The Web adapter is a single server-to-server caller, so this shared-IP limit
// is only a broad pre-auth abuse ceiling. Normal feature quotas are keyed by a
// digest of the verified user subject below.
export const WATCH_SEO_IP_RATE = { limit: 600, windowMs: 60_000 }
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
 * This broad ceiling fires before authentication so an unauthenticated flood
 * cannot reach the auth chain without bound. It is deliberately distinct from
 * the verified-subject feature quota.
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

export async function admitWatchSeoSubject(
  subject: string,
  route: string,
  rate: { limit: number; windowMs: number },
): Promise<boolean> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(subject),
  )
  const subjectKey = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
  const result = await incrementFixedWindow(
    `${route}:subject:${subjectKey}`,
    rate.limit,
    rate.windowMs,
  )
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
