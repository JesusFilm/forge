/**
 * Shared helpers used by BOTH `normalize-strapi.ts` and `normalize-admin.ts`.
 *
 * Keeping these in one place is load-bearing: a divergence between the
 * two normalizers' URL-key heuristics or absent-field rules would
 * produce silent one-sided value diffs — exactly the failure mode the
 * harness exists to detect.
 */

import { canonicalizeUrl } from "./canonicalize-url"

/** Shorthand for the source-side discriminator. */
export type Side = "strapi" | "admin"

/**
 * Map `null` / `undefined` / missing inputs to `null` so the differ's
 * structural-class equivalence rule applies post-normalization.
 */
export function nullify<T>(value: T | null | undefined): T | null {
  if (value === undefined || value === null) return null
  return value
}

/**
 * Strip a known set of meta-keys (`__typename`, `id`, `t`, ...) from a
 * block payload. Each normalizer passes its own skip-set since the
 * source-specific wrapper keys differ.
 */
export function stripBlockMeta(
  block: Record<string, unknown>,
  skipKeys: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(block)) {
    if (skipKeys.has(key)) continue
    out[key] = value
  }
  return out
}

/**
 * Heuristic: does this object key carry a URL-shaped value worth
 * canonicalizing? Conservative — only keys ending in known URL-shaped
 * suffixes match. Expand if a captured fixture surfaces a URL field
 * that doesn't match.
 */
export function looksLikeUrlKey(key: string): boolean {
  if (key === "url") return true
  return (
    key.endsWith("Url") ||
    key.endsWith("URL") ||
    key.endsWith("Link") ||
    key.endsWith("Href")
  )
}

/**
 * Walk a JSON-shaped payload and canonicalize any string field whose
 * key matches the URL-shape heuristic. Pure recursion — no async, no
 * mutation of the input. Records the raw → canonical map in `rawUrls`.
 *
 * Both normalizers route through this helper so the two sides
 * cannot drift on URL handling.
 */
export function canonicalizeNestedUrls(
  value: unknown,
  schema: Side,
  baseOrigin: string,
  rawUrls: Record<string, string>,
): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === "string") return value
  if (typeof value !== "object") return value
  if (Array.isArray(value)) {
    return value.map((v) =>
      canonicalizeNestedUrls(v, schema, baseOrigin, rawUrls),
    )
  }
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === "string" && looksLikeUrlKey(key) && child !== "") {
      const result = canonicalizeUrl(child, { schema, baseOrigin })
      if (result.canonical !== null) {
        out[key] = result.canonical
        rawUrls[result.canonical] = result.raw
      } else {
        out[key] = child
      }
    } else if (child === undefined || child === null) {
      out[key] = null
    } else {
      out[key] = canonicalizeNestedUrls(child, schema, baseOrigin, rawUrls)
    }
  }
  return out
}
