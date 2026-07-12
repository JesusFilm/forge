import { deriveMuxThumbnailUrl } from "./muxThumbnail"
import { resolveImageUrl } from "./resolveImageUrl"

/**
 * Resolve a card thumbnail to a displayable URL: prefer an already-picked
 * thumbnail, else derive one from a Mux stream. Pass streamingUrl only where the
 * Mux fallback is wanted (hero / video cards); omit it for image-first cards so
 * their resolution stays unchanged.
 */
export function resolveThumbnailUrl(
  thumb: string | null | undefined,
  streamingUrl?: string | null,
): string | null {
  return resolveImageUrl(thumb ?? deriveMuxThumbnailUrl(streamingUrl))
}
