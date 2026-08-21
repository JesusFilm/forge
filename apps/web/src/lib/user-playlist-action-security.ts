import { createHmac } from "node:crypto"
import { isIP } from "node:net"

export type UserPlaylistTrustedViewerContext = {
  countryCode: string | null
  viewerIp: string | null
}

type ActionAdmission =
  | { ok: true; context: UserPlaylistTrustedViewerContext }
  | { ok: false; code: "FORBIDDEN" }

const NEXT_ACTION_PATTERN = /^[A-Za-z0-9_-]{1,256}$/
const CLOUDFLARE_RAY_PATTERN = /^[A-Fa-f0-9]{16,32}(?:-[A-Za-z0-9]{2,10})?$/

function normalizedOrigin(value: string | null | undefined): string | null {
  if (!value || value === "null") return null
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    if (url.username || url.password) return null
    if (url.pathname !== "/" || url.search || url.hash) return null
    return url.origin
  } catch {
    return null
  }
}

function normalizedHost(value: string | null, protocol: string): string | null {
  if (!value || value !== value.trim() || /[,\s/\\]/.test(value)) return null
  try {
    const url = new URL(`${protocol}//${value}`)
    return url.host
  } catch {
    return null
  }
}

function trustedCloudflareContext(
  requestHeaders: Headers,
): UserPlaylistTrustedViewerContext {
  const ray = requestHeaders.get("cf-ray")
  if (!ray || !CLOUDFLARE_RAY_PATTERN.test(ray)) {
    return { countryCode: null, viewerIp: null }
  }

  const rawCountry = requestHeaders.get("cf-ipcountry")
  const country = rawCountry?.toUpperCase() ?? ""
  const countryCode =
    /^[A-Z]{2}$/.test(country) && country !== "XX" && country !== "T1"
      ? country
      : null

  const rawIp = requestHeaders.get("cf-connecting-ip")
  const viewerIp = rawIp && rawIp === rawIp.trim() && isIP(rawIp) ? rawIp : null

  return { countryCode, viewerIp }
}

/**
 * Browser CSRF admission for authenticated Server Actions. Origin and Fetch
 * Metadata protect the browser boundary; the encrypted user session remains
 * the authorization boundary. Raw-origin blocking still depends on the
 * deployment's authenticated-origin/edge controls.
 */
export function authorizeUserPlaylistActionRequest(
  requestHeaders: Headers,
  options: { allowedOrigins: readonly string[] },
): ActionAdmission {
  if (requestHeaders.get("x-http-method-override") != null) {
    return { ok: false, code: "FORBIDDEN" }
  }

  const actionId = requestHeaders.get("next-action")
  if (!actionId || !NEXT_ACTION_PATTERN.test(actionId)) {
    return { ok: false, code: "FORBIDDEN" }
  }

  const fetchSite = requestHeaders.get("sec-fetch-site")
  if (fetchSite != null && fetchSite !== "same-origin") {
    return { ok: false, code: "FORBIDDEN" }
  }

  const origin = normalizedOrigin(requestHeaders.get("origin"))
  const allowed = new Set(
    options.allowedOrigins
      .map((candidate) => normalizedOrigin(candidate))
      .filter((candidate): candidate is string => candidate != null),
  )
  if (!origin || !allowed.has(origin)) {
    return { ok: false, code: "FORBIDDEN" }
  }

  const originUrl = new URL(origin)
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")
  if (
    forwardedProtocol != null &&
    (forwardedProtocol.includes(",") ||
      `${forwardedProtocol}:` !== originUrl.protocol)
  ) {
    return { ok: false, code: "FORBIDDEN" }
  }

  const forwardedHost = requestHeaders.get("x-forwarded-host")
  const effectiveHost = normalizedHost(
    forwardedHost ?? requestHeaders.get("host"),
    originUrl.protocol,
  )
  if (!effectiveHost || effectiveHost !== originUrl.host) {
    return { ok: false, code: "FORBIDDEN" }
  }

  return { ok: true, context: trustedCloudflareContext(requestHeaders) }
}

/** Host admission for server-only RSC loaders, which execute during GET and
 * therefore do not carry a browser Origin or Next-Action marker. */
export function authorizeUserPlaylistServerRenderRequest(
  requestHeaders: Headers,
  options: { allowedOrigins: readonly string[] },
): ActionAdmission {
  const allowed = options.allowedOrigins
    .map((candidate) => normalizedOrigin(candidate))
    .filter((candidate): candidate is string => candidate != null)
    .map((candidate) => new URL(candidate))
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")
  if (
    forwardedProtocol != null &&
    forwardedProtocol !== "http" &&
    forwardedProtocol !== "https"
  ) {
    return { ok: false, code: "FORBIDDEN" }
  }
  const hostValue =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")
  const matchingOrigin = allowed.find((candidate) => {
    const host = normalizedHost(hostValue, candidate.protocol)
    return (
      host === candidate.host &&
      (forwardedProtocol == null ||
        `${forwardedProtocol}:` === candidate.protocol)
    )
  })
  if (!matchingOrigin) return { ok: false, code: "FORBIDDEN" }
  return { ok: true, context: trustedCloudflareContext(requestHeaders) }
}

export function signUserPlaylistViewerContext(
  context: UserPlaylistTrustedViewerContext,
  options: { secret?: string; now?: Date } = {},
): Record<
  "x-forge-viewer-context" | "x-forge-viewer-context-signature",
  string
> {
  const secret = options.secret
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("User Playlist trusted context is not configured")
  }
  const encoded = Buffer.from(
    JSON.stringify({
      countryCode: context.countryCode,
      viewerIp: context.viewerIp,
      issuedAt: (options.now ?? new Date()).getTime(),
    }),
    "utf8",
  ).toString("base64url")

  return {
    "x-forge-viewer-context": encoded,
    "x-forge-viewer-context-signature": createHmac("sha256", secret)
      .update(encoded, "ascii")
      .digest("base64url"),
  }
}
