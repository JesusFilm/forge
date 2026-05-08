/**
 * RFC6901 JSON Pointer encoding + numeric-aware sort comparator.
 *
 * The parity differ uses JSON Pointer paths to identify diff entries
 * (e.g., `/blocks/3/items/0/url`). Numeric-aware sort ensures
 * `/blocks/2` precedes `/blocks/10` rather than the lexicographic
 * inverse — review ergonomics for diff reports depend on this.
 *
 * https://www.rfc-editor.org/rfc/rfc6901
 */

/**
 * Encode an array of segments as an RFC6901 JSON Pointer.
 *
 * Each segment's `~` becomes `~0` and `/` becomes `~1` per the spec.
 * Numeric segments are emitted as their decimal string form; the
 * reader recovers them by parseInt-ing during sort.
 */
export function encodePointer(
  segments: ReadonlyArray<string | number>,
): string {
  if (segments.length === 0) return ""
  const parts = segments.map((s) => {
    if (typeof s === "number") return String(s)
    return s.replace(/~/g, "~0").replace(/\//g, "~1")
  })
  return "/" + parts.join("/")
}

/**
 * Compare two JSON Pointer paths with numeric-aware segment ordering.
 *
 * - Splits both paths on `/` and walks segments in lockstep.
 * - When BOTH segments at the same position parse cleanly as
 *   non-negative integers, compares numerically.
 * - Otherwise falls back to byte-wise string comparison.
 * - Shorter paths sort before longer paths sharing the same prefix.
 *
 * Empty string ("") is the root pointer per RFC6901 and sorts first.
 */
export function comparePointer(a: string, b: string): number {
  if (a === b) return 0
  const aSegs = a === "" ? [] : a.slice(1).split("/")
  const bSegs = b === "" ? [] : b.slice(1).split("/")
  const len = Math.min(aSegs.length, bSegs.length)
  for (let i = 0; i < len; i++) {
    const aSeg = aSegs[i]!
    const bSeg = bSegs[i]!
    const cmp = compareSegment(aSeg, bSeg)
    if (cmp !== 0) return cmp
  }
  return aSegs.length - bSegs.length
}

function compareSegment(a: string, b: string): number {
  const aNum = parseNonNegativeInt(a)
  const bNum = parseNonNegativeInt(b)
  if (aNum !== null && bNum !== null) {
    return aNum - bNum
  }
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function parseNonNegativeInt(s: string): number | null {
  if (s === "") return null
  if (!/^[0-9]+$/.test(s)) return null
  const n = Number(s)
  if (!Number.isSafeInteger(n) || n < 0) return null
  return n
}
