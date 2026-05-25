/** Shape of a single video image entry. */
export type VideoImage = {
  url?: string | null
  mobileCinematicHigh?: string | null
  videoStill?: string | null
}

/**
 * Pick the best thumbnail URL from a video's images.
 * Prefers mobileCinematicHigh, falls back to videoStill, then url.
 */
export function pickThumbnailUrl(
  images: VideoImage | VideoImage[] | null | undefined,
): string | null {
  if (!images) return null
  const list = Array.isArray(images) ? images : [images]
  if (list.length === 0) return null
  for (const img of list) {
    if (img.mobileCinematicHigh) return img.mobileCinematicHigh
  }
  for (const img of list) {
    if (img.videoStill) return img.videoStill
  }
  for (const img of list) {
    if (img.url) return img.url
  }
  return null
}
