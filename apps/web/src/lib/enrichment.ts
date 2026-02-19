type MediaItem = {
  id: string
  titleOverride?: string | null
  subtitleOverride?: string | null
  imageOverride?: { url: string } | null
  video?: {
    title: string
    slug: string
    image?: { url: string } | null
  } | null
}

export type EnrichedMediaItem = {
  id: string
  title: string
  subtitle: string
  imageUrl: string | null
  videoSlug: string
}

export function enrichMediaItem(item: MediaItem): EnrichedMediaItem {
  const title = item.titleOverride ?? item.video?.title ?? ""
  const subtitle = item.subtitleOverride ?? ""
  const imageUrl = item.imageOverride?.url ?? item.video?.image?.url ?? null
  const videoSlug = item.video?.slug ?? ""
  return { id: item.id, title, subtitle, imageUrl, videoSlug }
}
