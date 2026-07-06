// Admin's `MediaCollectionBlock.items[]` is FLAT — every item carries
// `videoId`, `imageUrl`, and `imageOverrideUrl` directly, with no nested
// `video { ... }` join. The renderer
// (`apps/web/src/components/sections/index.tsx:53-70`) tolerates a
// missing video join via the `titleOverride` + image fallback path. Authored
// items may also carry a route slug snapshot for linking, but this helper does
// NOT hydrate the missing video record. A live videoId → title/image hydrator is
// a deferred concern.

type MediaItem = {
  videoId?: string | null
  videoSlug?: string | null
  titleOverride: string | null
  subtitleOverride: string | null
  labelOverride: string | null
  collectionSize: string | null
  imageUrl: string | null
  // Optional because the caller's TS prop type derives from the legacy
  // Strapi fragment (nested `imageOverride { url }`), while the admin
  // runtime payload carries this flat field. The `as unknown as` cast
  // at the renderer level bridges the gap; at runtime this is always
  // present on admin data.
  imageOverrideUrl?: string | null
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
  // Explicit per-item override wins over the image inherited from the
  // linked video, matching the seed's authoring intent for collection
  // cards that point at external poster artwork rather than the video's
  // own thumbnail. Admin writes an empty string (not null) when an
  // editor clears the override, so the truthiness check below is what
  // routes empty strings back to the fallback — `??` would let `""`
  // shadow a valid imageUrl and produce a blank tile.
  const overrideUrl =
    typeof item.imageOverrideUrl === "string" &&
    item.imageOverrideUrl.length > 0
      ? item.imageOverrideUrl
      : null
  const fallbackUrl =
    typeof item.imageUrl === "string" && item.imageUrl.length > 0
      ? item.imageUrl
      : null
  const imageUrl = overrideUrl ?? fallbackUrl
  // Admin-authored items carry a route slug snapshot when seeded from videos.
  // Renderer skips the `<a href>` when videoSlug is empty (see
  // MediaCollection.tsx `const href = item.videoSlug ? ...`).
  const videoSlug = typeof item.videoSlug === "string" ? item.videoSlug : ""
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
