import { env } from "@/env"

export function getRequestOrigin(request: Request) {
  const canonicalOrigin = new URL(env.NEXT_PUBLIC_CANONICAL_ORIGIN)
  const allowedHosts = new Set([
    canonicalOrigin.host.toLowerCase(),
    new URL(env.WEB_BASE_URL).host.toLowerCase(),
  ])
  const forwardedHost = request.headers.get("x-forwarded-host")
  const host = forwardedHost?.trim().toLowerCase()
  if (!host || !allowedHosts.has(host)) return canonicalOrigin.origin

  const forwardedProto = request.headers.get("x-forwarded-proto")
  const protocol =
    forwardedProto === "https" || forwardedProto === "http"
      ? `${forwardedProto}:`
      : canonicalOrigin.protocol

  return `${protocol}//${host}`
}
