// SYNC: keep in sync with apps/mobile-v2/src/lib/types.ts

/** Shape of a single video image entry from the CMS. */
export type VideoImage = {
  url?: string | null
  mobileCinematicHigh?: string | null
  videoStill?: string | null
}

/** Shared shape for a video reference resolved from CMS data. */
export type VideoRef = {
  documentId?: string
  title?: string
  slug?: string
  imageAlt?: string
  images?: VideoImage[]
}

/**
 * Pick the best thumbnail URL from a video's images.
 * Accepts either an array (runtime shape from GraphQL) or a single object
 * (gql.tada inferred shape), since Strapi returns images as a collection.
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
