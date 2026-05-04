// Shared URL helpers for share-intent fallbacks.
//
// Facebook's URL scraper rejects localhost / private hosts, which empties the
// composer when share buttons fire from a dev build. The public canonical is
// what end users would actually see for the page anyway, so we substitute it
// whenever the configured origin is unreachable from the public internet.
// Twitter/X is more permissive but still benefits from a real URL preview.

export const PUBLIC_SHARE_FALLBACK_ORIGIN = "https://jesusfilm.org"

// Mirrors RFC1918 ranges plus link-local. We accept a small false-positive risk
// (e.g. legitimate 10.0.0.0/8 deployments) in exchange for never sending FB a
// URL its scraper can't reach.
const PRIVATE_IPV4_PATTERN = /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/

export function isPublicShareableOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin)
    if (hostname === "localhost" || hostname === "127.0.0.1") return false
    if (hostname.endsWith(".local")) return false
    if (hostname === "0.0.0.0") return false
    // IPv6 loopback: URL("http://[::1]:3000").hostname returns "[::1]" in
    // browsers and Node, but bare "::1" can also appear if the URL was
    // pre-stripped — treat both as non-public.
    if (hostname === "[::1]" || hostname === "::1") return false
    if (PRIVATE_IPV4_PATTERN.test(hostname)) return false
    return true
  } catch {
    return false
  }
}
