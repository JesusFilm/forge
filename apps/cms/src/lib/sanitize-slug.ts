/**
 * Slug sanitization + reserved-word deny-list.
 *
 * A slug flows into three load-bearing places:
 *   1. the URL path segment (e.g. `/watch/<slug>`)
 *   2. the `pathSegment` column in the Experience table
 *   3. the Strapi admin UI identifier
 *
 * Because all three share the same string, a malformed or reserved slug can
 * collide with Next.js / Strapi routes (e.g. `/watch/admin`) or the admin
 * surface. This module is the single source of truth for what we accept.
 */

export type SanitizeResult =
  | { ok: true; slug: string }
  | {
      ok: false
      reason: "empty" | "too-short" | "too-long" | "invalid-chars" | "reserved"
    }

/**
 * Lowercased reserved words that must never be accepted as a slug. These
 * collide with Next.js / Strapi route prefixes or common admin/system paths.
 * Matching is case-insensitive.
 */
const RESERVED = new Set<string>([
  "admin",
  "api",
  "watch",
  "_next",
  // Post-normalization of `_next` (underscores -> hyphens, then trimmed)
  // collapses to `next`, so reserve both forms so neither survives.
  "next",
  ".well-known",
  // `.well-known` normalizes to `well-known` after the leading dot is
  // stripped, so reserve that form too.
  "well-known",
  "default",
  "home",
  "index",
  "new",
  "edit",
  "public",
  "robots",
  "sitemap",
])

/** Well-formed slug: lowercase alnum tokens joined by single hyphens. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const MIN_LEN = 2
const MAX_LEN = 80

/**
 * Coerce, normalize, and validate a slug candidate.
 *
 * Normalization rules (in order):
 *   - trim
 *   - lowercase
 *   - replace whitespace and underscores with a single hyphen
 *   - strip any character outside [a-z0-9-]
 *   - collapse consecutive hyphens
 *   - strip leading/trailing hyphens
 *
 * Rejections (first failure wins):
 *   - empty after trim                -> "empty"
 *   - pre-normalization under 2 chars -> "too-short"
 *   - pre-normalization over 80 chars -> "too-long"
 *   - post-normalization does not match SLUG_RE -> "invalid-chars"
 *   - post-normalization under 2 chars -> "too-short"
 *   - post-normalization in RESERVED  -> "reserved"
 */
export function sanitizeSlug(input: unknown): SanitizeResult {
  const raw = typeof input === "string" ? input : String(input ?? "")
  const trimmed = raw.trim()

  if (trimmed.length === 0) {
    return { ok: false, reason: "empty" }
  }
  if (trimmed.length < MIN_LEN) {
    return { ok: false, reason: "too-short" }
  }
  if (trimmed.length > MAX_LEN) {
    return { ok: false, reason: "too-long" }
  }

  // Replace any run of non [a-z0-9] with a single hyphen, then collapse
  // consecutive hyphens and trim. This preserves word boundaries when the
  // caller pastes prose with unicode punctuation (e.g. `café—story`) which
  // is friendlier than stripping non-alnum silently.
  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")

  if (normalized.length < MIN_LEN) {
    // Either all characters were stripped or only 1 survived — treat both as
    // too-short so the caller can message the user consistently.
    return { ok: false, reason: "too-short" }
  }

  if (!SLUG_RE.test(normalized)) {
    return { ok: false, reason: "invalid-chars" }
  }

  if (RESERVED.has(normalized)) {
    return { ok: false, reason: "reserved" }
  }

  return { ok: true, slug: normalized }
}

/**
 * Given a desired slug and the list of already-taken slugs, return up to
 * three non-colliding alternatives.
 *
 * If `slug` itself is free, it is returned first so callers can offer it as
 * a one-click suggestion; otherwise the suggestions are `slug-2`, `slug-3`,
 * `slug-4`, … skipping any taken ones, up to 3 results.
 */
export function suggestAlternativeSlugs(
  slug: string,
  takenSlugs: string[],
): string[] {
  const taken = new Set(takenSlugs)
  const out: string[] = []

  if (!taken.has(slug)) {
    out.push(slug)
  }

  let suffix = 2
  while (out.length < 3 && suffix < 100) {
    const candidate = `${slug}-${suffix}`
    if (!taken.has(candidate)) {
      out.push(candidate)
    }
    suffix += 1
  }

  return out
}
