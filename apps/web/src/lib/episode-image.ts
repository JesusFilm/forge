// Shared image-resolution helper for series-episode rendering.
//
// SeriesEpisodeCard thumbnails and SeriesPageClient's collection-download
// mapping use the same authored fallback chain:
// mobileCinematicHigh → thumbnail → mobileCinematicLow → url,
// then a Mux frame from the episode's own playback id.
// Keeping it here means a future image-priority change lands in one
// place instead of drifting between two files.
//
// The Mux tier is what keeps series whose episodes ship without curated
// artwork — the common shape for the newer vertical series — from rendering
// a grid of empty stone tiles. A frame is not a curated poster, but it is
// always available for anything playable.
//
// Every tier is gated on TRUTHINESS, not nullishness. Admin's `VideoImage`
// resolver passes stored column values through raw, so a blank-but-present
// `mobileCinematicHigh` is a real shape (admin's own inventory SQL defends
// against it with `NULLIF(BTRIM(...), '')`). Under `??` an empty string is a
// hit, which would both return `src=""` and suppress the Mux tier below it.
//
// Differs from `resolvePosterUrl` in src/lib/url.ts: that helper applies
// the watch-page poster priority (cinematic-high → cinematic-low →
// thumbnail, intentionally dropping `url` because Strapi's misshaped
// Cloudflare URL returns 400). The episode rendering used `url` as a
// final fallback historically, so this helper preserves that 4-tier
// chain rather than collapsing to resolvePosterUrl's shape.

import { resolveMuxFrameThumbnailUrl } from "@/lib/url"

type EpisodeImage = {
  url?: string | null
  thumbnail?: string | null
  mobileCinematicHigh?: string | null
  mobileCinematicLow?: string | null
}

type EpisodeImageShape = {
  images?: Array<EpisodeImage | null> | null
  muxPlaybackId?: string | null
  muxThumbnailBlurDataUrl?: string | null
}

export type EpisodeThumbnail = {
  url: string | null
  /**
   * Only ever set alongside a Mux frame. Admin generates this LQIP from the
   * exact same `WATCH_CHAPTER_CAROUSEL_RECIPE` the frame URL requests, so it
   * is meaningless for authored artwork.
   */
  blurDataUrl: string | null
}

function authoredEpisodeImageUrl(episode: EpisodeImageShape): string | null {
  const image = episode.images?.[0]
  if (!image) return null
  return (
    image.mobileCinematicHigh ||
    image.thumbnail ||
    image.mobileCinematicLow ||
    image.url ||
    null
  )
}

/**
 * Authored artwork first, then a frame from the episode's own dub. Callers
 * that render through `next/image` should prefer `resolveEpisodeThumbnail` so
 * the Mux tier also carries its matching blur placeholder.
 */
export function resolveEpisodeImageUrl(
  episode: EpisodeImageShape,
): string | null {
  return resolveEpisodeThumbnail(episode).url
}

export function resolveEpisodeThumbnail(
  episode: EpisodeImageShape,
): EpisodeThumbnail {
  const authored = authoredEpisodeImageUrl(episode)
  if (authored) return { url: authored, blurDataUrl: null }

  const frame = resolveMuxFrameThumbnailUrl(episode.muxPlaybackId)
  return {
    url: frame,
    blurDataUrl: frame ? (episode.muxThumbnailBlurDataUrl ?? null) : null,
  }
}
