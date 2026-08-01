// Shared image-resolution helper for series-episode rendering.
//
// SeriesEpisodeCard thumbnails and SeriesPageClient's collection-download
// mapping use the same 4-tier fallback chain:
// mobileCinematicHigh → thumbnail → mobileCinematicLow → url → null.
// Keeping it here means a future image-priority change lands in one
// place instead of drifting between two files.
//
// Differs from `resolvePosterUrl` in src/lib/url.ts: that helper applies
// the watch-page poster priority (cinematic-high → cinematic-low →
// thumbnail, intentionally dropping `url` because Strapi's misshaped
// Cloudflare URL returns 400). The episode rendering used `url` as a
// final fallback historically, so this helper preserves that 4-tier
// chain rather than collapsing to resolvePosterUrl's shape.

type EpisodeImage = {
  url?: string | null
  thumbnail?: string | null
  mobileCinematicHigh?: string | null
  mobileCinematicLow?: string | null
}

type EpisodeImageShape = {
  images?: Array<EpisodeImage | null> | null
}

export function resolveEpisodeImageUrl(
  episode: EpisodeImageShape,
): string | null {
  const image = episode.images?.[0]
  if (!image) return null
  return (
    image.mobileCinematicHigh ??
    image.thumbnail ??
    image.mobileCinematicLow ??
    image.url ??
    null
  )
}
