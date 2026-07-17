/**
 * Reduce a published ExperienceLocale to a compact structure-and-voice
 * outline for use as an AI-generation exemplar.
 *
 * The output teaches the drafter two things — block layout/nesting/rhythm
 * (R6) and copy voice (R7) — while deliberately stripping every video
 * reference, asset id, url, and colour (R8). The model writes its own
 * copy in this voice and fills videos ONLY from the prompt's candidate
 * list, so the exemplar must never leak the reference page's video ids.
 *
 * Pure, no IO. The caller (U2 selection) hands in a row; the workflow
 * injection (U4) wraps the returned string with "reference only" framing.
 */

/**
 * Keys whose VALUES are stripped from the outline. Matches (case-
 * insensitively) any key ending in `url`, `link`, `id`, `color`, or
 * `src` — which covers `videoId`, `streamingUrl`, `imageOverrideUrl`,
 * `imageAssetId`, `ctaLink`, `contentId`, `backgroundColor`, etc. — plus
 * the exact `hls` / `dash` playback fields. The block discriminator `t`
 * is always kept (see `sanitizeObject`).
 */
const DROP_KEY = /(?:url|link|id|color|src)$/i
const DROP_KEY_EXACT = new Set(["hls", "dash"])

// Note: `contentId` (navigationCarousel item target) ends in `id`, so it is
// dropped. That is intentional — R8 forbids leaking the reference page's
// content references, and a navigationCarousel's `contentId` can point at a
// real video/experience. The navigation STRUCTURE is still conveyed (the
// block kind + item titles survive); only the concrete target id is removed.
// `sectionKey` ends in `Key`, so it is kept as a harmless layout anchor.

/** Bounds to keep the exemplar within a sane per-call token budget. */
const MAX_TOP_LEVEL_BLOCKS = 12
const MAX_ARRAY_ITEMS = 8
const MAX_STRING_LEN = 300
const MAX_DEPTH = 6
const MAX_SERIALIZED_LEN = 4000
const TRUNCATION_MARKER = "…(truncated)"

function shouldDropKey(key: string): boolean {
  if (key === "t") return false
  return DROP_KEY.test(key) || DROP_KEY_EXACT.has(key.toLowerCase())
}

function truncateString(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim()
  if (trimmed.length <= MAX_STRING_LEN) return trimmed
  return `${trimmed.slice(0, MAX_STRING_LEN)}…`
}

/**
 * Keep only structure (`t`, nested arrays/objects) and copy (strings).
 * Booleans and numbers are dropped as config noise — they convey neither
 * structure nor voice and only inflate the token budget.
 */
function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return undefined
  if (typeof value === "string") {
    const out = truncateString(value)
    return out.length > 0 ? out : undefined
  }
  if (Array.isArray(value)) {
    const items: unknown[] = []
    for (const item of value.slice(0, MAX_ARRAY_ITEMS)) {
      const sanitized = sanitizeValue(item, depth + 1)
      if (sanitized !== undefined) items.push(sanitized)
    }
    if (value.length > MAX_ARRAY_ITEMS)
      items.push(`…+${value.length - MAX_ARRAY_ITEMS} more`)
    return items.length > 0 ? items : undefined
  }
  if (value != null && typeof value === "object") {
    return sanitizeObject(value as Record<string, unknown>, depth)
  }
  // boolean | number | null | undefined → dropped
  return undefined
}

function sanitizeObject(
  obj: Record<string, unknown>,
  depth: number,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(obj)) {
    if (shouldDropKey(key)) continue
    const sanitized =
      key === "t" && typeof raw === "string"
        ? raw
        : sanitizeValue(raw, depth + 1)
    if (sanitized !== undefined) out[key] = sanitized
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export type ExemplarOutlineInput = {
  title?: string | null
  metaDescription?: string | null
  blocks: unknown
}

/**
 * Build the compact structure+copy outline string. Returns `null` when
 * the row has no usable structure or copy (e.g. an empty page), so the
 * caller can treat it the same as "no exemplar".
 */
export function buildExemplarOutline(row: ExemplarOutlineInput): string | null {
  const rawBlocks = Array.isArray(row.blocks) ? row.blocks : []
  const blocks: unknown[] = []
  for (const block of rawBlocks.slice(0, MAX_TOP_LEVEL_BLOCKS)) {
    const sanitized = sanitizeValue(block, 0)
    if (sanitized !== undefined) blocks.push(sanitized)
  }
  if (rawBlocks.length > MAX_TOP_LEVEL_BLOCKS) {
    blocks.push(`…+${rawBlocks.length - MAX_TOP_LEVEL_BLOCKS} more sections`)
  }

  const title = row.title ? truncateString(row.title) : undefined
  const metaDescription = row.metaDescription
    ? truncateString(row.metaDescription)
    : undefined

  if (blocks.length === 0 && !title && !metaDescription) {
    return null
  }

  const outline: Record<string, unknown> = {}
  if (title) outline.title = title
  if (metaDescription) outline.metaDescription = metaDescription
  outline.blocks = blocks

  const serialized = JSON.stringify(outline)
  if (serialized.length > MAX_SERIALIZED_LEN) {
    // Slice accounting for the marker so the FINAL string honors the cap
    // (the only token-budget guard before the prompt; nothing downstream
    // re-clamps it). The result is intentionally not valid JSON — it is a
    // structure/voice reference the model reads, not data it parses.
    return (
      serialized.slice(0, MAX_SERIALIZED_LEN - TRUNCATION_MARKER.length) +
      TRUNCATION_MARKER
    )
  }
  return serialized
}
