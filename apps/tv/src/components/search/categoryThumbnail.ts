// Diverged from apps/mobile/src/lib/categoryThumbnail.ts: that one still unwraps
// the retired `{ search: { results } }` envelope. Not interchangeable.
import { resolveImageUrl } from "../../lib/resolveImageUrl"

/** Only the field this scan needs — callers pass mapped watchSearch results. */
type ThumbnailCandidate = { readonly imageUrl?: string | null }

/**
 * First result WITH usable art, or null. Scans rather than taking results[0]
 * because the top hit is often imageless ("christmas" -> "The Hope of
 * Christmas"), which would leave the card on its bare gradient.
 */
export function pickThumbnailUrl(
  results:
    | readonly (ThumbnailCandidate | null | undefined)[]
    | null
    | undefined,
): string | null {
  if (!results) return null
  for (const result of results) {
    const url = resolveImageUrl(result?.imageUrl ?? null)
    if (url) return url
  }
  return null
}
