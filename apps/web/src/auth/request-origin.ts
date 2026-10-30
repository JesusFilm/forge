import {
  getDefaultWatchCallbackOrigins,
  normalizeOrigin,
} from "@forge/watch-url-policy/callbacks"

import { env } from "@/env"

/**
 * Origin Watch auth URLs are built from.
 *
 * The inbound host is untrusted: behind Cloudflare and Railway it can be an
 * internal origin alias (FGE-175). It is only honoured when it exactly matches
 * an approved origin; everything else resolves to
 * `NEXT_PUBLIC_CANONICAL_ORIGIN`. Approved origins are the canonical origin,
 * `WEB_BASE_URL`, the shared Watch callback origins, and, outside production
 * only, any loopback origin so local dev and preview proxies can use any port.
 * The scheme always comes from the approved origin, never from
 * `x-forwarded-proto`.
 */
export function getRequestOrigin(request: Request) {
  const canonicalOrigin = new URL(env.NEXT_PUBLIC_CANONICAL_ORIGIN).origin
  const host = readRequestHost(request)
  if (!host) return canonicalOrigin

  const forwardedProto = request.headers.get("x-forwarded-proto")
  const matches = approvedOrigins().filter(
    (origin) => new URL(origin).host === host,
  )
  const match =
    matches.find((origin) => origin.startsWith(`${forwardedProto}:`)) ??
    matches[0] ??
    (isLoopbackHost(host) && process.env.NODE_ENV !== "production"
      ? loopbackOrigin(host, request)
      : undefined)

  return match ?? canonicalOrigin
}

function approvedOrigins() {
  return [
    env.NEXT_PUBLIC_CANONICAL_ORIGIN,
    env.WEB_BASE_URL,
    ...getDefaultWatchCallbackOrigins(process.env.NODE_ENV),
  ]
    .map(normalizeOrigin)
    .filter((origin): origin is string => origin != null)
}

// `x-forwarded-host` may be a proxy chain; the first entry is the client-facing
// host. Without it, fall back to the Host header, then the request URL.
function readRequestHost(request: Request) {
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim()
  const host =
    forwardedHost ||
    request.headers.get("host")?.trim() ||
    new URL(request.url).host
  return host.toLowerCase()
}

function isLoopbackHost(host: string) {
  const hostname = host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1)
    : host.split(":")[0]
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  )
}

function loopbackOrigin(host: string, request: Request) {
  const protocol = request.headers.get("x-forwarded-proto")
  const scheme =
    protocol === "https" || protocol === "http"
      ? protocol
      : new URL(request.url).protocol.replace(":", "")
  return normalizeOrigin(`${scheme}://${host}`) ?? undefined
}
