type MediaItem = {
  id: string
  titleOverride: string | null
  subtitleOverride: string | null
  labelOverride: string | null
  collectionSize: string | null
  imageUrl: string | null
  imageOverride?: { url: string | null } | null
  video: {
    title: string | null
    slug: string | null
    images: ({ url: string | null } | null)[] | null
  } | null
}

export type EnrichedMediaItem = {
  id: string
  title: string
  subtitle: string
  label: string
  collectionSize: string
  imageUrl: string | null
  videoSlug: string
}

export function enrichMediaItem(item: MediaItem): EnrichedMediaItem {
  const title = item.titleOverride ?? item.video?.title ?? ""
  const subtitle = item.subtitleOverride ?? ""
  const label = typeof item.labelOverride === "string" ? item.labelOverride : ""
  const collectionSize = item.collectionSize ?? ""
  const externalImageUrl =
    typeof item.imageUrl === "string" ? item.imageUrl : null
  const imageUrl =
    externalImageUrl ??
    item.imageOverride?.url ??
    item.video?.images?.[0]?.url ??
    null
  const videoSlug = item.video?.slug ?? ""
  return {
    id: item.id,
    title,
    subtitle,
    label,
    collectionSize,
    imageUrl,
    videoSlug,
  }
}
