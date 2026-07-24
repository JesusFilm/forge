import type { MergedWatchBlock, WatchVideoRecord } from "@/lib/content"
import type { WatchVideoMetadataModel } from "@/lib/experience-metadata"
import {
  WATCH_BASE_PATH,
  WATCH_PUBLIC_METADATA_ORIGIN,
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchVideoPath,
} from "@/lib/routes"
import type { WatchHomeVisibleDestination } from "@/lib/watch-home-visible-content"
import {
  isWatchRouteAdmittedByManifest,
  type WatchRouteManifest,
} from "@/lib/watch-route-manifest"

export const WATCH_STRUCTURED_DATA_ITEM_LIMIT = 12

const WATCH_ROOT_URL = `${WATCH_PUBLIC_METADATA_ORIGIN}${WATCH_BASE_PATH}`
const PUBLISHER = {
  "@type": "Organization",
  "@id": "https://www.jesusfilm.org/#organization",
  name: "Jesus Film Project",
  url: "https://www.jesusfilm.org",
} as const

type CollectionItem = {
  name: string
  url: string
}

function jsonLd(payload: unknown): string {
  return JSON.stringify(payload).replace(/</g, "\\u003c")
}

function trimmed(value: string | null | undefined): string | null {
  const result = value?.trim()
  return result ? result : null
}

function httpsUrl(value: string | null | undefined): URL | null {
  const candidate = trimmed(value)
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    return url.protocol === "https:" ? url : null
  } catch {
    return null
  }
}

function stablePublicMediaUrl(
  value: string | null | undefined,
  extension: ".m3u8" | ".vtt",
): string | null {
  const url = httpsUrl(value)
  return url &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname.toLowerCase().endsWith(extension)
    ? url.toString()
    : null
}

function watchAbsoluteUrl(value: string | null | undefined): string | null {
  const candidate = trimmed(value)
  if (!candidate) return null
  try {
    const url = new URL(candidate, WATCH_PUBLIC_METADATA_ORIGIN)
    if (
      url.origin !== WATCH_PUBLIC_METADATA_ORIGIN ||
      (url.pathname !== WATCH_BASE_PATH &&
        !url.pathname.startsWith(`${WATCH_BASE_PATH}/`))
    ) {
      return null
    }
    return `${url.origin}${url.pathname}`
  } catch {
    return null
  }
}

function validBcp47(value: string | null | undefined): string | null {
  const candidate = trimmed(value)
  if (!candidate || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(candidate)) {
    return null
  }
  try {
    return Intl.getCanonicalLocales(candidate)[0] ?? null
  } catch {
    return null
  }
}

function secondsToIsoDuration(
  seconds: number | null | undefined,
): string | null {
  if (
    seconds == null ||
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    String(seconds).includes("e")
  ) {
    return null
  }
  return `PT${seconds}S`
}

function isoDate(value: string | null | undefined): string | null {
  const candidate = trimmed(value)
  if (!candidate) return null
  const timestamp = Date.parse(candidate)
  if (!Number.isFinite(timestamp)) return null
  return new Date(timestamp).toISOString()
}

function watchVideoAbsoluteUrl(
  slug: string | null | undefined,
  languageSlug: string | null | undefined,
): string | null {
  if (!slug || !languageSlug) return null
  const contentSlug = tryAsContentSlug(slug)
  const localeSlug = tryAsLocaleSlug(languageSlug)
  if (!contentSlug || !localeSlug) return null
  return `${WATCH_ROOT_URL}${watchVideoPath(contentSlug, localeSlug)}`
}

function uniqueCollectionItems(
  items: readonly CollectionItem[],
): CollectionItem[] {
  const seen = new Set<string>()
  const result: CollectionItem[] = []

  for (const item of items) {
    const name = trimmed(item.name)
    const url = watchAbsoluteUrl(item.url)
    if (!name || !url || seen.has(url)) continue
    seen.add(url)
    result.push({ name, url })
    if (result.length === WATCH_STRUCTURED_DATA_ITEM_LIMIT) break
  }

  return result
}

function collectionPageJson({
  canonicalUrl,
  name,
  description,
  inLanguage,
  items,
}: {
  canonicalUrl: string
  name: string
  description?: string | null
  inLanguage?: string | null
  items: readonly CollectionItem[]
}): string | null {
  const url = watchAbsoluteUrl(canonicalUrl)
  const pageName = trimmed(name)
  const listItems = uniqueCollectionItems(items)
  if (!url || !pageName || listItems.length === 0) return null

  const language = validBcp47(inLanguage)
  const pageDescription = trimmed(description)

  return jsonLd({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: pageName,
    url,
    ...(pageDescription && { description: pageDescription }),
    ...(language && { inLanguage: language }),
    publisher: PUBLISHER,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: listItems.length,
      itemListElement: listItems.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        url: item.url,
      })),
    },
  })
}

export function watchHomeCollectionStructuredDataJson({
  destinations,
  canonicalUrl,
  inLanguage,
  name,
  description,
}: {
  destinations: readonly WatchHomeVisibleDestination[]
  canonicalUrl: string
  inLanguage: string | null
  name: string
  description?: string | null
}): string | null {
  return collectionPageJson({
    canonicalUrl,
    name,
    description,
    inLanguage,
    items: destinations,
  })
}

export function watchSeriesCollectionStructuredDataJson({
  series,
  languageSlug,
  canonicalUrl,
  inLanguage,
  routeManifest,
}: {
  series: WatchVideoRecord
  languageSlug: string
  canonicalUrl: string
  inLanguage: string | null
  routeManifest: WatchRouteManifest | null
}): string | null {
  if (series.noIndex === true || !routeManifest) return null
  return collectionPageJson({
    canonicalUrl,
    name: series.title ?? "",
    description: series.description ?? series.snippet,
    inLanguage,
    items: series.children.flatMap((child) => {
      const contentSlug = tryAsContentSlug(child.slug ?? "")
      if (
        !contentSlug ||
        !isWatchRouteAdmittedByManifest(routeManifest, {
          kind: "video",
          contentSlug,
          audioLanguageSlug: languageSlug,
        })
      ) {
        return []
      }
      return [
        {
          name: child.title ?? "",
          url: watchVideoAbsoluteUrl(contentSlug, languageSlug) ?? "",
        },
      ]
    }),
  })
}

export function watchVideoStructuredDataJson(
  model: WatchVideoMetadataModel,
): string | null {
  const name = trimmed(model.structuredDataTitle)
  const description = trimmed(model.description)
  const canonicalUrl = watchAbsoluteUrl(model.canonicalUrl)
  const contentUrl = stablePublicMediaUrl(model.contentUrl, ".m3u8")
  const thumbnailUrl = httpsUrl(model.structuredDataThumbnailUrl)?.toString()
  const uploadDate = isoDate(model.uploadDate)
  const duration = secondsToIsoDuration(model.durationSeconds)
  const inLanguage = validBcp47(model.inLanguage)

  if (
    model.noIndex ||
    !name ||
    !description ||
    !canonicalUrl ||
    !contentUrl ||
    !thumbnailUrl ||
    !uploadDate ||
    !duration
  ) {
    return null
  }

  const captions = model.captions.flatMap((caption) => {
    const captionUrl = stablePublicMediaUrl(caption.contentUrl, ".vtt")
    const captionLanguage = validBcp47(caption.inLanguage)
    if (!captionUrl || !captionLanguage) return []
    return [
      {
        "@type": "MediaObject",
        contentUrl: captionUrl,
        encodingFormat: "text/vtt",
        inLanguage: captionLanguage,
      },
    ]
  })
  const seekTarget =
    model.durationSeconds != null && model.durationSeconds >= 30
      ? `${canonicalUrl}?t={seek_to_second_number}`
      : null

  return jsonLd({
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name,
    description,
    url: canonicalUrl,
    contentUrl,
    thumbnailUrl: [thumbnailUrl],
    ...(inLanguage && { inLanguage }),
    uploadDate,
    duration,
    publisher: PUBLISHER,
    ...(captions.length > 0 && { caption: captions }),
    ...(seekTarget && {
      potentialAction: {
        "@type": "SeekToAction",
        target: seekTarget,
        "startOffset-input": "required name=seek_to_second_number",
      },
    }),
  })
}

export function watchRelatedItemListStructuredDataJson({
  blocks,
  languageSlug,
}: {
  blocks: MergedWatchBlock[]
  languageSlug: string | null | undefined
}): string | null {
  const carousel = blocks.find(
    (block) => "kind" in block && block.kind === "SiblingCarousel",
  )
  if (!carousel || !("canonicalParent" in carousel)) return null

  const seen = new Set<string>()
  const items = []
  for (const child of carousel.canonicalParent.children) {
    const url = watchVideoAbsoluteUrl(child.slug, languageSlug)
    const name = trimmed(child.title)
    if (!url || !name || seen.has(url)) continue
    seen.add(url)
    items.push({
      "@type": "ListItem",
      position: items.length + 1,
      name,
      url,
    })
    if (items.length === WATCH_STRUCTURED_DATA_ITEM_LIMIT) break
  }

  if (items.length === 0) return null

  return jsonLd({
    "@context": "https://schema.org",
    "@type": "ItemList",
    numberOfItems: items.length,
    itemListElement: items,
  })
}
