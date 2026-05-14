// Admin's `MediaCollectionBlock.items[]` is FLAT — every item carries
// `videoId` + `imageUrl` directly, with no nested `video { ... }` or
// `imageOverride { url }` join. The renderer
// (`apps/web/src/components/sections/index.tsx:53-70`) ALREADY tolerates
// the missing video join via the `titleOverride` + `imageUrl` fallback
// path, so this helper does NOT hydrate the missing video record. A
// videoId → slug + title hydrator is a deferred concern.
//
// Inputs only require the fields the function actually reads. Extra
// fields on the passed object (e.g. a legacy `video` join or admin-only
// `imageOverrideUrl`) are ignored without complaint — keeps the helper
// compatible with both the runtime admin payload and any in-flight
// fixtures still carrying the old shape.

type MediaItem = {
  videoId?: string | null
  titleOverride: string | null
  subtitleOverride: string | null
  labelOverride: string | null
  collectionSize: string | null
  imageUrl: string | null
}

type RouteRelatedVideo = {
  documentId: string
  title: string | null
  slug: string | null
  label: string | null
  images: ({ url: string | null } | null)[] | null
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
  const title = item.titleOverride ?? ""
  const subtitle = item.subtitleOverride ?? ""
  const label = typeof item.labelOverride === "string" ? item.labelOverride : ""
  const collectionSize = item.collectionSize ?? ""
  const imageUrl = typeof item.imageUrl === "string" ? item.imageUrl : null
  // Admin items carry no slug — the videoId → slug hydration is deferred.
  // Renderer skips the `<a href>` when videoSlug is empty (see
  // MediaCollection.tsx `const href = item.videoSlug ? ...`).
  const videoSlug = ""
  // Fall back to videoId (or empty string) when no upstream id is present.
  // React keys against an empty string repeat-collide across items, so the
  // consumer also keys by array index where this matters.
  const id = item.videoId ?? ""
  return {
    id,
    title,
    subtitle,
    label,
    collectionSize,
    imageUrl,
    videoSlug,
  }
}

export function enrichRouteRelatedVideo(
  video: RouteRelatedVideo,
): EnrichedMediaItem | null {
  const videoSlug = video.slug ?? ""
  if (!videoSlug) return null

  return {
    id: video.documentId,
    title: video.title ?? videoSlug,
    subtitle: "",
    label: video.label ?? "",
    collectionSize: "",
    imageUrl: video.images?.[0]?.url ?? null,
    videoSlug,
  }
}
