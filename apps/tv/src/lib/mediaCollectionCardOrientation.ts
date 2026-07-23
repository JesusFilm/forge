export type MediaCollectionCardOrientation = "horizontal" | "vertical"

export function resolveMediaCollectionCardOrientation(
  authoredOrientation: unknown,
  legacyOrientation: MediaCollectionCardOrientation,
): MediaCollectionCardOrientation {
  return authoredOrientation === "horizontal" ||
    authoredOrientation === "vertical"
    ? authoredOrientation
    : legacyOrientation
}
