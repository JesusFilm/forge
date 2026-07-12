import { deriveMuxThumbnailUrl } from "./muxThumbnail"
import { resolveImageUrl } from "./resolveImageUrl"

/**
 * Card thumbnail URL: prefer an already-picked thumbnail, else derive from a Mux
 * stream. Pass streamingUrl only where the Mux fallback is wanted (hero / video
 * cards); omit it for image-first cards so their resolution stays unchanged.
 */
export function resolveThumbnailUrl(
  thumb: string | null | undefined,
  streamingUrl?: string | null,
): string | null {
  return resolveImageUrl(thumb ?? deriveMuxThumbnailUrl(streamingUrl))
}
