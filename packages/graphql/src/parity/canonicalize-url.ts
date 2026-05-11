/**
 * URL canonicalization for parity diffing.
 *
 * The differ requires both Strapi and admin URLs to be in a single
 * canonical form before comparison; otherwise every image field
 * produces a false-positive value diff (Strapi serves root-relative
 * paths like `/images/foo.jpg`; admin serves absolute URLs from a CDN).
 *
 * Both sides pass through `canonicalizeUrl` before reaching the differ.
 * The raw input is preserved alongside the canonical form so the diff
 * record can show reviewers what each side actually returned.
 *
 * Per the URL-handling learning at
 * docs/solutions/integration-issues/mobile-relative-image-url-no-base-origin-20260408.md.
 */

/**
 * Tracking-style query parameters stripped during canonicalization.
 * Conservative — only well-known marketing/analytics keys; do not add
 * keys that might be load-bearing on a content URL.
 */
const STRIPPED_QUERY_KEYS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
])

export type CanonicalizeUrlConfig = {
  readonly schema: "strapi" | "admin"
  /**
   * Origin used to resolve Strapi root-relative paths to absolute URLs.
   * Required for the strapi schema; ignored when admin URLs are already absolute.
   * Format: `https://example.com` (no trailing slash).
   */
  readonly baseOrigin: string
}

export type CanonicalUrl = {
  readonly canonical: string
  readonly raw: string
}

export type CanonicalUrlFailure = {
  readonly canonical: null
  readonly raw: string
  readonly reason: "empty" | "malformed"
}

export class CanonicalizeUrlError extends Error {
  override readonly name = "CanonicalizeUrlError"
}

/**
 * Canonicalize a URL string into the form the differ compares.
 *
 * Throws `CanonicalizeUrlError` for empty input — the parity contract
 * requires URL fields to be non-empty strings or `null`; an empty
 * non-null URL is a producer-side bug worth surfacing immediately.
 *
 * Returns a structured `CanonicalUrlFailure` for malformed URLs so the
 * differ can flag the value as a mismatch without the call site having
 * to handle a thrown exception.
 */
export function canonicalizeUrl(
  raw: string,
  config: CanonicalizeUrlConfig,
): CanonicalUrl | CanonicalUrlFailure {
  if (raw === "") {
    throw new CanonicalizeUrlError(
      "canonicalizeUrl: input must be non-empty; pass null when a URL field is absent",
    )
  }

  let parsed: URL
  try {
    if (config.schema === "strapi" && raw.startsWith("/")) {
      parsed = new URL(raw, config.baseOrigin)
    } else {
      parsed = new URL(raw)
    }
  } catch {
    return { canonical: null, raw, reason: "malformed" }
  }

  // Strip tracking query keys.
  const params = parsed.searchParams
  const trackedKeys: string[] = []
  for (const key of params.keys()) {
    if (STRIPPED_QUERY_KEYS.has(key)) trackedKeys.push(key)
  }
  for (const key of trackedKeys) params.delete(key)

  // Lowercase host (origin canonicalization).
  parsed.host = parsed.host.toLowerCase()

  // Strip trailing slash on the pathname unless it IS the root path.
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "")
  }

  // Drop any explicit port matching the protocol's default (`new URL`
  // already handles this, but call it out — `:443` on https never appears
  // in canonical output).

  return { canonical: parsed.toString(), raw }
}
