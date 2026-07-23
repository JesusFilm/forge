export type MediaCollectionThumbnailOrientation = "horizontal" | "vertical"

export function resolveMediaCollectionThumbnailOrientation(
  authoredOrientation: unknown,
  legacyOrientation: MediaCollectionThumbnailOrientation,
): MediaCollectionThumbnailOrientation {
  return authoredOrientation === "horizontal" ||
    authoredOrientation === "vertical"
    ? authoredOrientation
    : legacyOrientation
}
