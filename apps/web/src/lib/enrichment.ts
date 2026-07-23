// Admin's `MediaCollectionBlock.items[]` is flat. Computed fields such as
// `resolvedTitle` and `videoDub` are projected alongside the linked video's
// image and route metadata so the renderer does not need a second request or
// client-side join.

type MediaItem = {
  videoId?: string | null
  coreId?: string | null
  videoSlug?: string | null
  videoDub?: {
    language?: {
      slug?: string | null
    } | null
    muxVideo?: {
      playbackId?: string | null
    } | null
  } | null
  muxPlaybackId?: string | null
  languageSlug?: string | null
  videoImageBlurDataUrl?: string | null
  videoImageDominantColor?: string | null
  resolvedTitle?: string | null
  titleOverride: string | null
  subtitleOverride: string | null
  labelOverride: string | null
  collectionSize: string | null
  imageAsset?: {
    previewUrl?: string | null
    blurDataUrl?: string | null
    dominantColor?: string | null
  } | null
}

const WATCH_HOME_LOCAL_THUMBNAILS: Record<string, string> = {
  "1_jf-0-0": "/watch/images/thumbnails/1_jf-0-0-vertical.png",
  "2_GOJ-0-0": "/watch/images/thumbnails/2_GOJ-0-0-vertical.png",
  GOJohnCollection: "/watch/images/thumbnails/GOJohnCollection-vertical.png",
  GOLukeCollection: "/watch/images/thumbnails/GOLukeCollection-vertical.png",
  GOMarkCollection: "/watch/images/thumbnails/GOMarkCollection-vertical.png",
  GOMattCollection: "/watch/images/thumbnails/GOMattCollection-vertical.png",
}

const WATCH_HOME_LOCAL_BLURS: Record<string, string> = {
  "1_jf-0-0":
    "data:image/jpeg;base64,/9j/2wBDABcXFxcYFxocHBokJiImJDUwLCwwNVA5PTk9OVB5S1hLS1hLeWuBaWJpgWvAl4WFl8DeurC63v/w8P//////////2wBDARcXFxcYFxocHBokJiImJDUwLCwwNVA5PTk9OVB5S1hLS1hLeWuBaWJpgWvAl4WFl8DeurC63v/w8P//////////wgARCAAkABgDASIAAhEBAxEB/8QAGQABAAMBAQAAAAAAAAAAAAAAAAIEBQEG/8QAFgEBAQEAAAAAAAAAAAAAAAAAAQIA/9oADAMBAAIQAxAAAADz2rj6MXQQMyn2+OakSNozSCf/xAAjEAABAwMCBwAAAAAAAAAAAAABAAIRAwQSBSIQExQhMkFR/9oACAEBAAE/ADJKNvZm3kZB/wB4FxBBQ1F435DxjFTKNMuPpdI+JkLlPAmFQO8KQBKqvyeVS7OTicSiv//EABYRAQEBAAAAAAAAAAAAAAAAAAEQEf/aAAgBAgEBPwB2Kxn/xAAWEQEBAQAAAAAAAAAAAAAAAAABEBH/2gAIAQMBAT8AMhkJ/9k=",
  "2_GOJ-0-0":
    "data:image/jpeg;base64,/9j/2wBDABcXFxcYFxocHBokJiImJDUwLCwwNVA5PTk9OVB5S1hLS1hLeWuBaWJpgWvAl4WFl8DeurC63v/w8P//////////2wBDARcXFxcYFxocHBokJiImJDUwLCwwNVA5PTk9OVB5S1hLS1hLeWuBaWJpgWvAl4WFl8DeurC63v/w8P//////////wgARCAAjABgDASIAAhEBAxEB/8QAGQABAAMBAQAAAAAAAAAAAAAAAAECAwQF/8QAFgEBAQEAAAAAAAAAAAAAAAAAAQAC/9oADAMBAAIQAxAAAADw4ZmtwlIz3w2Qbm6Qgn//xAAiEAABAwMEAwEAAAAAAAAAAAAAAQIRAxIhIjEyUWFxgZH/2gAIAQEAAT8AVRFlt1uPZBVRbFGVNDktnBT4Nnoc/NqDZTCCaWwvY1ZeM5z4K2P0buM3Qr7/AE//xAAYEQEBAAMAAAAAAAAAAAAAAAABAAIQEf/aAAgBAgEBPwB7rKGYv//EABcRAQEBAQAAAAAAAAAAAAAAAAEAEBH/2gAIAQMBAT8AOYTE3//Z",
  GOJohnCollection:
    "data:image/jpeg;base64,/9j/2wBDABcXFxcYFxocHBokJiImJDUwLCwwNVA5PTk9OVB5S1hLS1hLeWuBaWJpgWvAl4WFl8DeurC63v/w8P//////////2wBDARcXFxcYFxocHBokJiImJDUwLCwwNVA5PTk9OVB5S1hLS1hLeWuBaWJpgWvAl4WFl8DeurC63v/w8P//////////wgARCAAfABgDASIAAhEBAxEB/8QAGQAAAgMBAAAAAAAAAAAAAAAAAAUBAgQD/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAEC/9oADAMBAAIQAxAAAADrmF2dOShTdLqmWxmD/8QAIRAAAgICAwACAwAAAAAAAAAAAQIAEQMSBCExFEEkgaH/2gAIAQEAAT8A2FX1Ubl4VZbB1boN9QsQbCzl4/x31FtORmR0ZAGuurmAs+DHfVoLr2KMWrBVF+XG4w+Qzda1/Zj08KjbwGY8k+zGanT9z//EABQRAQAAAAAAAAAAAAAAAAAAACD/2gAIAQIBAT8AH//EABQRAQAAAAAAAAAAAAAAAAAAACD/2gAIAQMBAT8AH//Z",
  GOLukeCollection:
    "data:image/jpeg;base64,/9j/2wBDABcXFxcYFxocHBokJiImJDUwLCwwNVA5PTk9OVB5S1hLS1hLeWuBaWJpgWvAl4WFl8DeurC63v/w8P//////////2wBDARcXFxcYFxocHBokJiImJDUwLCwwNVA5PTk9OVB5S1hLS1hLeWuBaWJpgWvAl4WFl8DeurC63v/w8P//////////wgARCAAhABgDASIAAhEBAxEB/8QAGQABAAMBAQAAAAAAAAAAAAAAAAIDBAUB/8QAFwEAAwEAAAAAAAAAAAAAAAAAAAECA//aAAwDAQACEAMQAAAA0Yo0QaUTXV5u6la2gn3EFWAf/8QAJRAAAQMDAwMFAAAAAAAAAAAAAQACAwQREgUhMkFyghMiMTQ1/9oACAEBAAE/ANgLnYDclOrKZ5tc2upIsOPwtRc9tKWjryKdLSOp8C47M29oVIS6lizUMMMr8HgP6m6ZSxnUXRekMMipqYRDGPi3otN5zOKpX5am7zVfLhNbtWncZ+5UP6Q81qf2W+K//8QAFREBAQAAAAAAAAAAAAAAAAAAASD/2gAIAQIBAT8AK//EABsRAAICAwEAAAAAAAAAAAAAAAABETEQElJx/9oACAEDAQE/AEpxF+Gp0Kj/2Q==",
  GOMarkCollection:
    "data:image/jpeg;base64,/9j/2wBDABcXFxcYFxocHBokJiImJDUwLCwwNVA5PTk9OVB5S1hLS1hLeWuBaWJpgWvAl4WFl8DeurC63v/w8P//////////2wBDARcXFxcYFxocHBokJiImJDUwLCwwNVA5PTk9OVB5S1hLS1hLeWuBaWJpgWvAl4WFl8DeurC63v/w8P//////////wgARCAAiABgDASIAAhEBAxEB/8QAGAAAAwEBAAAAAAAAAAAAAAAAAAQFAwL/xAAWAQEBAQAAAAAAAAAAAAAAAAAAAQL/2gAMAwEAAhADEAAAAO1G5udvGoYq7x82+LAzACqIEf/EACUQAAIBAgUDBQAAAAAAAAAAAAECAAMREhMhMXEEMoEUIzNRsv/aAAgBAQABPwAvUO7GeoY47U3KoTc3+pYmWuCZmE9Rl5QOI7x0w8R2NrrKfV0sWoIJO0FU4iD5EclHF+1o2lXh4ze63Ag1RuDH+RuY3e3j8z//xAAUEQEAAAAAAAAAAAAAAAAAAAAg/9oACAECAQE/AF//xAAUEQEAAAAAAAAAAAAAAAAAAAAg/9oACAEDAQE/AF//2Q==",
  GOMattCollection:
    "data:image/jpeg;base64,/9j/2wBDABcXFxcYFxocHBokJiImJDUwLCwwNVA5PTk9OVB5S1hLS1hLeWuBaWJpgWvAl4WFl8DeurC63v/w8P//////////2wBDARcXFxcYFxocHBokJiImJDUwLCwwNVA5PTk9OVB5S1hLS1hLeWuBaWJpgWvAl4WFl8DeurC63v/w8P//////////wgARCAAhABgDASIAAhEBAxEB/8QAGAABAAMBAAAAAAAAAAAAAAAAAAMEBQL/xAAXAQEBAQEAAAAAAAAAAAAAAAABAAMC/9oADAMBAAIQAxAAAADvPmyM9N9TFoUppeid0jNsA2An/8QAJRAAAgIBAgQHAAAAAAAAAAAAAQIAAxEEEiExcXITIzIzQVGR/9oACAEBAAE/AGbEfX1qxAUsBzIlbq6hlOQZqifBsx9Si1KwVZWyRxE0CulADjHGDYgGRlmH4DLNOM1MB84M2LswegMsbzoOKVd0sO1OhEs9yvoZX6U7hL+S96z/xAAUEQEAAAAAAAAAAAAAAAAAAAAg/9oACAECAQE/AF//xAAUEQEAAAAAAAAAAAAAAAAAAAAg/9oACAEDAQE/AF//2Q==",
}

function muxThumbnailUrl(playbackId: string | null | undefined): string | null {
  const id = playbackId?.trim()
  return id
    ? `https://image.mux.com/${encodeURIComponent(id)}/thumbnail.jpg`
    : null
}

function localWatchHomeThumbnailUrl(coreId: string | null | undefined) {
  const id = coreId?.trim()
  return id ? (WATCH_HOME_LOCAL_THUMBNAILS[id] ?? null) : null
}

export function localWatchHomeBlurDataUrl(coreId: string | null | undefined) {
  const id = coreId?.trim()
  return id ? (WATCH_HOME_LOCAL_BLURS[id] ?? null) : null
}

function meaningfulBlurDataUrl(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return null

  // Existing local fixtures can carry the generic fallback generated by
  // image-metadata.service before the source bytes are available. Prefer a
  // real video/local blur over that flat square.
  if (
    value ===
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiIHZpZXdCb3g9IjAgMCA4IDgiPjxyZWN0IHdpZHRoPSI4IiBoZWlnaHQ9IjgiIGZpbGw9IiMxMTE4MjciLz48L3N2Zz4="
  ) {
    return null
  }

  return value
}

function meaningfulColor(value: unknown) {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    return null
  }

  // This is the generic fallback from image metadata generation, not a useful
  // image-derived dominant color for visual theming.
  if (value.toLowerCase() === "#111827") return null

  return value
}

function demoBlurDataUrl(seed: string) {
  const hash = [...seed].reduce(
    (value, char) => (value * 31 + char.charCodeAt(0)) >>> 0,
    0,
  )
  const hue = hash % 360
  const hue2 = (hue + 34) % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16" viewBox="0 0 24 16"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="hsl(${hue} 48% 22%)"/><stop offset=".55" stop-color="hsl(${hue2} 42% 34%)"/><stop offset="1" stop-color="hsl(${hue} 38% 12%)"/></linearGradient><filter id="b"><feGaussianBlur stdDeviation="2"/></filter></defs><rect width="24" height="16" fill="url(#g)" filter="url(#b)"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

type RouteRelatedVideo = {
  documentId: string
  title: string | null
  slug: string | null
  label: string | null
  muxPlaybackId: string | null
  images:
    | ({
        url: string | null
        blurDataUrl?: string | null
        dominantColor?: string | null
      } | null)[]
    | null
}

export type EnrichedMediaItem = {
  id: string
  title: string
  subtitle: string
  label: string
  collectionSize: string
  imageUrl: string | null
  blurDataUrl: string | null
  dominantColor: string | null
  videoSlug: string
  languageSlug: string | null
  muxPlaybackId: string | null
}

export function enrichMediaItem(item: MediaItem): EnrichedMediaItem {
  const title = item.resolvedTitle?.trim() ?? ""
  const subtitle = item.subtitleOverride ?? ""
  const label = typeof item.labelOverride === "string" ? item.labelOverride : ""
  const collectionSize = item.collectionSize ?? ""
  const authoredUrl =
    typeof item.imageAsset?.previewUrl === "string" &&
    item.imageAsset.previewUrl.length > 0
      ? item.imageAsset.previewUrl
      : null
  const imageUrl =
    authoredUrl ??
    localWatchHomeThumbnailUrl(item.coreId) ??
    muxThumbnailUrl(item.videoDub?.muxVideo?.playbackId)
  const videoImageBlurDataUrl = meaningfulBlurDataUrl(
    item.videoImageBlurDataUrl,
  )
  const assetBlurDataUrl = meaningfulBlurDataUrl(item.imageAsset?.blurDataUrl)
  const videoDominantColor = meaningfulColor(item.videoImageDominantColor)
  const assetDominantColor = meaningfulColor(item.imageAsset?.dominantColor)
  // Admin-authored items carry a route slug snapshot when seeded from videos.
  // Renderer skips the `<a href>` when videoSlug is empty (see
  // MediaCollection.tsx `const href = item.videoSlug ? ...`).
  const videoSlug = typeof item.videoSlug === "string" ? item.videoSlug : ""
  const languageSlug =
    typeof item.languageSlug === "string"
      ? item.languageSlug
      : typeof item.videoDub?.language?.slug === "string"
        ? item.videoDub.language.slug
        : null
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
    blurDataUrl:
      authoredUrl != null
        ? assetBlurDataUrl
        : (videoImageBlurDataUrl ??
          localWatchHomeBlurDataUrl(item.coreId) ??
          demoBlurDataUrl(
            item.coreId ??
              item.videoDub?.muxVideo?.playbackId ??
              item.videoId ??
              item.titleOverride ??
              imageUrl ??
              "media-collection",
          )),
    dominantColor:
      authoredUrl != null ? assetDominantColor : videoDominantColor,
    videoSlug,
    languageSlug,
    muxPlaybackId: item.videoDub?.muxVideo?.playbackId ?? null,
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
    blurDataUrl: meaningfulBlurDataUrl(video.images?.[0]?.blurDataUrl),
    dominantColor: meaningfulColor(video.images?.[0]?.dominantColor),
    videoSlug,
    languageSlug: null,
    muxPlaybackId: video.muxPlaybackId ?? null,
  }
}
