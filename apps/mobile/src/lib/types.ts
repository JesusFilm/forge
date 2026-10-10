import { pickCardImage, type CardImageSource } from "./cardImage"

/** Shape of a single video image entry. */
export type VideoImage = CardImageSource

/** Pick the best thumbnail URL from a video's images — see ./cardImage.ts. */
export function pickThumbnailUrl(
  images: VideoImage | VideoImage[] | null | undefined,
): string | null {
  if (!images) return null
  return pickCardImage(Array.isArray(images) ? images : [images], "card")
}
